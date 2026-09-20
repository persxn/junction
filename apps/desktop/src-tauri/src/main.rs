// Windows: no console window for the release build. The dev build keeps one, so
// panics and the backend's own stderr are visible while working.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    compintel_lib::run();
}
