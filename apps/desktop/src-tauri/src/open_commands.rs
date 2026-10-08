//! The resource commands (ruling R102–R103, WP-20b): open a stored path, show
//! it in Explorer, check many at once, and name this PC. Every decision is
//! `open`'s; these only move the work off the main thread and shape the answer.

use crate::{external, open};
/// What `open_local_path` and `reveal_path` answer (the contract's `PathActionResult`).
#[derive(serde::Serialize)]
#[serde(untagged)]
pub enum PathAction {
    Done { done: bool },
    Refused { done: bool, reason: open::Refusal },
}

fn path_action(result: Result<(), open::Refusal>) -> PathAction {
    match result {
        Ok(()) => PathAction::Done { done: true },
        Err(reason) => PathAction::Refused {
            done: false,
            reason,
        },
    }
}

/// Opens a stored path with its default program — only a document type that
/// exists on this PC, handed over as its canonical path (R102).
#[tauri::command]
pub async fn open_local_path(path: String) -> Result<PathAction, String> {
    tauri::async_runtime::spawn_blocking(move || {
        open::open_with(&path, &open::Disk, &|target| {
            external::shell_open(&target.to_string_lossy())
        })
        .map(path_action)
    })
    .await
    .map_err(|cause| format!("the open check did not finish: {cause}"))?
}

/// Selects a stored path in its folder (files and folders alike); runs nothing (R102).
#[tauri::command]
pub async fn reveal_path(path: String) -> Result<PathAction, String> {
    tauri::async_runtime::spawn_blocking(move || {
        open::reveal_with(&path, &open::Disk, &open::reveal_in_explorer).map(path_action)
    })
    .await
    .map_err(|cause| format!("the reveal check did not finish: {cause}"))?
}

/// What `stat_paths` answers (the contract's `StatPathsResult`).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatPaths {
    pub machine_label: String,
    pub results: Vec<open::PathStat>,
}

/// Checks up to 200 stored paths on this PC, each with the 3 s network timeout (R103).
#[tauri::command]
pub async fn stat_paths(paths: Vec<String>) -> Result<StatPaths, String> {
    if paths.len() > 200 {
        return Err("At most 200 paths are checked at once.".to_owned());
    }
    let results =
        tauri::async_runtime::spawn_blocking(move || open::stat_all(&paths, open::NETWORK_TIMEOUT))
            .await
            .map_err(|cause| format!("the path check did not finish: {cause}"))?;
    Ok(StatPaths {
        machine_label: open::machine_label(),
        results,
    })
}

/// This PC's name, for a resource added here ("On LAB-PC-07").
#[tauri::command]
pub fn machine_label() -> String {
    open::machine_label()
}
