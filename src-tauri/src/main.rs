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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![file_exists, reveal_in_explorer])
        .plugin(tauri_plugin_window_state::Builder::default().build()) // Add this line
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}