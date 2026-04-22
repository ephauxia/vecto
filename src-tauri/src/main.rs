#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let win_path = path.replace('/', "\\");
    
    // THE FIX: Separate the flag and the path
    std::process::Command::new("explorer")
        .arg("/select,")
        .arg(&win_path)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        // 1. The Setup Block (Handles the background color/flashbang fix)
        .setup(|app| {
            let window = app.get_window("main").unwrap();
            // Sets the color to #07070f (RGB: 7, 7, 15)
            window.set_background_color(Some(tauri::Color(7, 7, 15, 255))).unwrap();
            Ok(())
        })
        // 2. The Plugin (Handles saving/restoring window size and position)
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // 3. Your existing handlers
        .invoke_handler(tauri::generate_handler![file_exists, reveal_in_explorer])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}