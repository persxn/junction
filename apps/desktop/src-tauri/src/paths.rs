//! Where the shell finds the backend and where it tells it to keep its data.
//!
//! Packaged, both answers come from the layout ruling A20 fixes
//! (`resources\node\node.exe`, `resources\backend\main.mjs`). In a dev run there
//! is no `resources` directory, so the repository's own esbuild bundle and the
//! system Node are used instead, and the data directory is
//! `%LOCALAPPDATA%\CompIntel-dev` - never `%LOCALAPPDATA%\JunctionData`, so a
//! developer can never point a debug build at pilot data (CLAUDE.md).

use std::path::{Path, PathBuf};

/// Overrides, in order of precedence over everything below.
pub const ENV_DATA_DIR: &str = "COMPINTEL_DATA_DIR";
pub const ENV_NODE: &str = "COMPINTEL_BACKEND_NODE";
pub const ENV_ENTRY: &str = "COMPINTEL_BACKEND_ENTRY";

/// `%LOCALAPPDATA%\JunctionData` in a packaged run (§4.13). Not `Junction`: that is
/// where the per-user installer puts the program, and the two must never share a
/// folder an uninstaller removes.
pub const DATA_DIR_NAME: &str = "JunctionData";

/// `%LOCALAPPDATA%\CompIntel-dev` in a dev run (CLAUDE.md).
pub const DEV_DATA_DIR_NAME: &str = "CompIntel-dev";

/// Everything the supervisor needs to spawn the backend.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellPaths {
    /// Passed as `--data-dir`; the backend creates it and its sub-directories.
    pub data_dir: PathBuf,
    /// The Node executable: the pinned one from `resources`, or `node` on PATH.
    pub node: PathBuf,
    /// The backend bundle's entry point.
    pub entry: PathBuf,
}

impl ShellPaths {
    /// `<dataDir>\logs`, what "Open logs" reveals.
    pub fn logs_dir(&self) -> PathBuf {
        self.data_dir.join("logs")
    }
}

/// What `resolve` needs from the outside world, so tests can supply their own.
pub struct PathInputs<'a> {
    /// Looks up an environment variable.
    pub env: &'a dyn Fn(&str) -> Option<String>,
    /// Tauri's resource directory, when this is a packaged run.
    pub resource_dir: Option<PathBuf>,
    /// The crate directory, used to find the repository in a dev run.
    pub manifest_dir: PathBuf,
    /// True for a debug build; decides which data directory is the default.
    pub dev: bool,
    /// Answers "does this file exist?"; injected for the same reason.
    pub exists: &'a dyn Fn(&Path) -> bool,
}

/// Resolves the three paths, preferring an explicit environment variable, then the
/// packaged layout, then the development fallbacks.
pub fn resolve(inputs: &PathInputs<'_>) -> ShellPaths {
    let data_dir = match non_empty((inputs.env)(ENV_DATA_DIR)) {
        Some(value) => PathBuf::from(value),
        None => default_data_dir(inputs),
    };

    let packaged_node = inputs
        .resource_dir
        .as_ref()
        .map(|dir| dir.join("node").join("node.exe"));
    let node = match non_empty((inputs.env)(ENV_NODE)) {
        Some(value) => PathBuf::from(value),
        None => match packaged_node.filter(|path| (inputs.exists)(path)) {
            Some(path) => path,
            // Not packaged: whatever `node` the developer's PATH resolves to,
            // which WP-03a pinned at 24.19.0.
            None => PathBuf::from("node"),
        },
    };

    let packaged_entry = inputs
        .resource_dir
        .as_ref()
        .map(|dir| dir.join("backend").join("main.mjs"));
    let entry = match non_empty((inputs.env)(ENV_ENTRY)) {
        Some(value) => PathBuf::from(value),
        None => match packaged_entry.filter(|path| (inputs.exists)(path)) {
            Some(path) => path,
            None => dev_entry(&inputs.manifest_dir),
        },
    };

    ShellPaths {
        data_dir,
        node,
        entry,
    }
}

/// `apps/desktop/src-tauri` → `apps/backend/dist-bundle/main.mjs`.
fn dev_entry(manifest_dir: &Path) -> PathBuf {
    manifest_dir
        .join("..")
        .join("..")
        .join("backend")
        .join("dist-bundle")
        .join("main.mjs")
}

fn default_data_dir(inputs: &PathInputs<'_>) -> PathBuf {
    let name = if inputs.dev {
        DEV_DATA_DIR_NAME
    } else {
        DATA_DIR_NAME
    };
    let base = non_empty((inputs.env)("LOCALAPPDATA"))
        .map(PathBuf::from)
        .or_else(|| {
            non_empty((inputs.env)("USERPROFILE"))
                .map(|home| PathBuf::from(home).join("AppData").join("Local"))
        })
        .unwrap_or_else(|| PathBuf::from("."));
    base.join(name)
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|text| !text.trim().is_empty())
}

/// Windows' verbatim prefix, `\\?\`, and its UNC form, `\\?\UNC\`.
const VERBATIM: &str = r"\\?\";
const VERBATIM_UNC: &str = r"\\?\UNC\";

/// Drops Windows' verbatim prefix (`\\?\C:\...`, `\\?\UNC\server\...`) that
/// Tauri's resource directory carries. Node cannot start from such a path: its
/// module loader calls `realpath` on it and fails on `C:` ("EISDIR"), so a
/// packaged backend would exit before printing READY.
pub fn without_verbatim_prefix(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(VERBATIM_UNC) {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = text.strip_prefix(VERBATIM) {
        PathBuf::from(rest)
    } else {
        path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn strips_the_verbatim_prefix_node_cannot_load_from() {
        // Spelled out character by character, so no editor or shell can quietly
        // collapse the doubled backslash the test is about.
        let verbatim = format!("{0}{0}?{0}", '\\');
        assert_eq!(VERBATIM, verbatim);
        assert_eq!(
            without_verbatim_prefix(PathBuf::from(format!(
                r"{verbatim}C:\Users\x\AppData\Local\Junction"
            ))),
            PathBuf::from(r"C:\Users\x\AppData\Local\Junction")
        );
        assert_eq!(
            without_verbatim_prefix(PathBuf::from(format!(
                r"{verbatim}UNC\server\share\Junction"
            ))),
            PathBuf::from(format!("{0}{0}server{0}share{0}Junction", '\\'))
        );
        assert_eq!(
            without_verbatim_prefix(PathBuf::from(r"C:\Program Files\Junction")),
            PathBuf::from(r"C:\Program Files\Junction")
        );
    }

    fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect()
    }

    const MANIFEST: &str = r"C:\repo\apps\desktop\src-tauri";

    #[test]
    fn a_dev_run_uses_the_dev_data_dir_and_the_repo_bundle() {
        let vars = env(&[("LOCALAPPDATA", r"C:\Users\x\AppData\Local")]);
        let lookup = |key: &str| vars.get(key).cloned();
        let exists = |_: &Path| false;
        let paths = resolve(&PathInputs {
            env: &lookup,
            resource_dir: None,
            manifest_dir: PathBuf::from(MANIFEST),
            dev: true,
            exists: &exists,
        });

        assert_eq!(
            paths.data_dir,
            PathBuf::from(r"C:\Users\x\AppData\Local\CompIntel-dev")
        );
        assert_eq!(paths.node, PathBuf::from("node"));
        assert!(paths.entry.ends_with(r"backend\dist-bundle\main.mjs"));
    }

    #[test]
    fn a_packaged_run_uses_the_a20_layout() {
        let vars = env(&[("LOCALAPPDATA", r"C:\Users\x\AppData\Local")]);
        let lookup = |key: &str| vars.get(key).cloned();
        let exists = |_: &Path| true;
        let paths = resolve(&PathInputs {
            env: &lookup,
            resource_dir: Some(PathBuf::from(r"C:\app\resources")),
            manifest_dir: PathBuf::from(MANIFEST),
            dev: false,
            exists: &exists,
        });

        assert_eq!(
            paths.data_dir,
            PathBuf::from(r"C:\Users\x\AppData\Local\JunctionData")
        );
        assert_eq!(paths.node, PathBuf::from(r"C:\app\resources\node\node.exe"));
        assert_eq!(
            paths.entry,
            PathBuf::from(r"C:\app\resources\backend\main.mjs")
        );
        assert_eq!(
            paths.logs_dir(),
            PathBuf::from(r"C:\Users\x\AppData\Local\JunctionData\logs")
        );
    }

    #[test]
    fn the_environment_wins_over_everything() {
        let vars = env(&[
            ("LOCALAPPDATA", r"C:\Users\x\AppData\Local"),
            (ENV_DATA_DIR, r"D:\Junction"),
            (ENV_NODE, r"D:\node\node.exe"),
            (ENV_ENTRY, r"D:\fake\main.mjs"),
        ]);
        let lookup = |key: &str| vars.get(key).cloned();
        let exists = |_: &Path| true;
        let paths = resolve(&PathInputs {
            env: &lookup,
            resource_dir: Some(PathBuf::from(r"C:\app\resources")),
            manifest_dir: PathBuf::from(MANIFEST),
            dev: false,
            exists: &exists,
        });

        assert_eq!(paths.data_dir, PathBuf::from(r"D:\Junction"));
        assert_eq!(paths.node, PathBuf::from(r"D:\node\node.exe"));
        assert_eq!(paths.entry, PathBuf::from(r"D:\fake\main.mjs"));
    }

    #[test]
    fn a_blank_override_is_ignored_rather_than_obeyed() {
        let vars = env(&[
            ("LOCALAPPDATA", r"C:\Users\x\AppData\Local"),
            (ENV_DATA_DIR, "   "),
        ]);
        let lookup = |key: &str| vars.get(key).cloned();
        let exists = |_: &Path| false;
        let paths = resolve(&PathInputs {
            env: &lookup,
            resource_dir: None,
            manifest_dir: PathBuf::from(MANIFEST),
            dev: true,
            exists: &exists,
        });

        assert_eq!(
            paths.data_dir,
            PathBuf::from(r"C:\Users\x\AppData\Local\CompIntel-dev")
        );
    }

    #[test]
    fn falls_back_to_the_dev_bundle_when_resources_are_missing() {
        let vars = env(&[("LOCALAPPDATA", r"C:\Users\x\AppData\Local")]);
        let lookup = |key: &str| vars.get(key).cloned();
        let exists = |_: &Path| false;
        let paths = resolve(&PathInputs {
            env: &lookup,
            resource_dir: Some(PathBuf::from(r"C:\app\resources")),
            manifest_dir: PathBuf::from(MANIFEST),
            dev: false,
            exists: &exists,
        });

        assert_eq!(paths.node, PathBuf::from("node"));
        assert!(paths.entry.ends_with(r"backend\dist-bundle\main.mjs"));
    }

    #[test]
    fn without_localappdata_it_still_produces_an_absolute_looking_path() {
        let vars = env(&[("USERPROFILE", r"C:\Users\x")]);
        let lookup = |key: &str| vars.get(key).cloned();
        let exists = |_: &Path| false;
        let paths = resolve(&PathInputs {
            env: &lookup,
            resource_dir: None,
            manifest_dir: PathBuf::from(MANIFEST),
            dev: false,
            exists: &exists,
        });

        assert_eq!(
            paths.data_dir,
            PathBuf::from(r"C:\Users\x\AppData\Local\JunctionData")
        );
    }
}
