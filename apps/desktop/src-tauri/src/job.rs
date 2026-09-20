//! The Windows Job Object that guarantees nothing outlives the shell
//! (ARCHITECTURE.md §3.2, finding F7, ruling A17).
//!
//! Tauri has no kill-tree, so the shell creates the job itself with
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: when the last handle to the job closes -
//! including when the shell is killed from Task Manager - Windows terminates every
//! process in it. `llama-server` and any headless Edge inherit the job because the
//! backend spawns them, so one handle covers the whole tree.
//!
//! The stdin lifeline is the polite path and this is the hard one; both exist on
//! purpose.

use std::process::Child;

/// A job object children are assigned to, closed when this value is dropped.
pub struct ProcessJob {
    #[cfg(windows)]
    handle: imp::JobHandle,
}

impl ProcessJob {
    /// Creates the job. An error here is fatal for the shell: without it a crash
    /// could leave an orphaned backend holding the data-directory lock.
    pub fn create() -> Result<Self, String> {
        #[cfg(windows)]
        {
            Ok(Self {
                handle: imp::create()?,
            })
        }
        #[cfg(not(windows))]
        {
            Ok(Self {})
        }
    }

    /// Puts a freshly spawned child in the job. Called before anything else is
    /// done with the child, so a failure to start cannot escape supervision.
    pub fn assign(&self, child: &Child) -> Result<(), String> {
        #[cfg(windows)]
        {
            imp::assign(&self.handle, child)
        }
        #[cfg(not(windows))]
        {
            let _ = child;
            Ok(())
        }
    }
}

#[cfg(windows)]
mod imp {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };

    /// Owns the job handle. The raw handle is not `Send` on its own, but a job
    /// handle is just a kernel object reference: it is safe to move between
    /// threads, and the supervisor thread needs it.
    pub struct JobHandle(HANDLE);

    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}

    impl Drop for JobHandle {
        fn drop(&mut self) {
            // Closing the last handle is what kills the tree; ignoring the result
            // is deliberate, there is nothing left to do about a failure here.
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    pub fn create() -> Result<JobHandle, String> {
        // SAFETY: an unnamed job object with default security; the handle is owned
        // by JobHandle from here on and closed exactly once, in its Drop.
        let handle = unsafe { CreateJobObjectW(None, None) }
            .map_err(|cause| format!("CreateJobObjectW failed: {cause}"))?;
        let job = JobHandle(handle);

        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: the pointer and length describe the struct the information class
        // requires, and it outlives the call.
        unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&limits).cast(),
                u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>())
                    .map_err(|_| "job limit struct is impossibly large".to_owned())?,
            )
        }
        .map_err(|cause| format!("SetInformationJobObject failed: {cause}"))?;

        Ok(job)
    }

    pub fn assign(job: &JobHandle, child: &Child) -> Result<(), String> {
        let process = HANDLE(child.as_raw_handle().cast());
        // SAFETY: both handles are open for the duration of the call - the child
        // is still owned by the caller, and the job by `job`.
        unsafe { AssignProcessToJobObject(job.0, process) }
            .map_err(|cause| format!("AssignProcessToJobObject failed: {cause}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    #[test]
    fn creating_the_job_succeeds_on_this_machine() {
        ProcessJob::create().expect("a job object can be created");
    }

    #[cfg(windows)]
    fn is_running(pid: u32) -> bool {
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .expect("tasklist runs on Windows");
        String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
    }

    /// The guarantee this whole file exists for (finding F7, ruling A17): when the
    /// last handle to the job closes - which is what happens when the shell dies,
    /// however it dies - Windows terminates everything inside it.
    #[cfg(windows)]
    #[test]
    fn closing_the_job_kills_everything_in_it() {
        let mut child = {
            let job = ProcessJob::create().expect("job");
            // 30 pings is about 30 seconds, far longer than this test takes.
            let child = Command::new("cmd")
                .args(["/C", "ping -n 30 127.0.0.1"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("cmd.exe should start");
            job.assign(&child).expect("the child joins the job");
            assert!(is_running(child.id()), "the child should be running");
            child
            // `job` is dropped here, and CloseHandle fires KILL_ON_JOB_CLOSE.
        };

        let pid = child.id();
        let deadline = Instant::now() + Duration::from_secs(5);
        while is_running(pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(!is_running(pid), "pid {pid} survived the job closing");
        let _ = child.wait();
    }

    #[cfg(windows)]
    #[test]
    fn a_child_can_be_assigned_and_still_runs() {
        let job = ProcessJob::create().expect("job");
        let mut child = Command::new("cmd")
            .args(["/C", "exit 7"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("cmd.exe should start");

        job.assign(&child).expect("the child joins the job");

        let status = child.wait().expect("wait");
        assert_eq!(status.code(), Some(7));
    }
}
