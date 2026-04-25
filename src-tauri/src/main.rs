#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

// This trait is MANDATORY to use .raw_arg() on Windows
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Fix for spaces: use a single set of quotes inside the /select command
        let win_path = path.replace('/', "\\");
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", win_path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        
        let _ = std::process::Command::new("nautilus").arg(&path).spawn()
            .or_else(|_| std::process::Command::new("xdg-open").arg(&parent).spawn());
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // Flashbang fix: Sets the window background to dark immediately
        .setup(|app| {
            let window = app.get_window("main").unwrap();
            window.set_background_color(Some(tauri::Color(7, 7, 15, 255))).unwrap();
            Ok(())
        })
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![file_exists, reveal_in_explorer])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}