//! `stat_paths`, the verbatim prefix and the machine label (R102–R103, WP-20b).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use super::tests::Scratch;
use super::*;

#[test]
fn stat_reports_found_missing_and_what_may_open() {
    let scratch = Scratch::new("stat");
    let pdf = scratch.file("brief.pdf");
    let exe = scratch.file("tool.exe");
    let missing = scratch.0.join("gone.docx").to_string_lossy().into_owned();
    let results = stat_all(
        &[
            pdf.clone(),
            exe.clone(),
            missing.clone(),
            "C:\\x\\..\\y.pdf".to_owned(),
        ],
        NETWORK_TIMEOUT,
    );
    assert_eq!(
        results[0],
        PathStat {
            path: pdf,
            status: "OK",
            openable: true,
            reason: None
        }
    );
    assert_eq!(
        results[1],
        PathStat {
            path: exe,
            status: "OK",
            openable: false,
            reason: Some(Refusal::BlockedType)
        }
    );
    assert_eq!(results[2].status, "MISSING");
    assert_eq!(results[2].reason, Some(Refusal::NotFound));
    assert_eq!(results[3].reason, Some(Refusal::Traversal));
}

#[test]
fn a_path_that_does_not_answer_in_time_is_unreachable() {
    let slow = Arc::new(|path: &str| {
        std::thread::sleep(Duration::from_millis(400));
        stat_one(path, &Disk)
    });
    let results = stat_all_with(
        &["\\\\LAB-NAS\\share\\brief.pdf".to_owned()],
        Duration::from_millis(50),
        slow,
    );
    assert_eq!(results[0].status, "UNREACHABLE");
    assert!(!results[0].openable);
}

#[test]
fn the_verbatim_prefix_is_stripped_for_the_os() {
    assert_eq!(
        strip_verbatim(Path::new("\\\\?\\C:\\Team\\x.pdf")),
        PathBuf::from("C:\\Team\\x.pdf")
    );
    assert_eq!(
        strip_verbatim(Path::new("\\\\?\\UNC\\nas\\share\\x.pdf")),
        PathBuf::from("\\\\nas\\share\\x.pdf")
    );
    assert_eq!(
        strip_verbatim(Path::new("C:\\Team\\x.pdf")),
        PathBuf::from("C:\\Team\\x.pdf")
    );
}

#[test]
fn the_machine_label_is_never_empty() {
    assert!(!machine_label().trim().is_empty());
}

#[test]
fn refusals_serialize_as_the_contract_names_them() {
    assert_eq!(
        serde_json::to_string(&Refusal::TrailingDotOrSpace).expect("json"),
        "\"TRAILING_DOT_OR_SPACE\""
    );
    assert_eq!(
        serde_json::to_string(&Refusal::BlockedType).expect("json"),
        "\"BLOCKED_TYPE\""
    );
}
