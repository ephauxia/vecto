#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let win_path = path.replace('/', "\\");
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&win_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        let parent = std::path::Path::new(&path)
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or("/")
            .to_string();
        std::process::Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        // 1. The Plugin (Handles saving/restoring window size and position)
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // 2. Your existing handlers
        .invoke_handler(tauri::generate_handler![file_exists, reveal_in_explorer])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}