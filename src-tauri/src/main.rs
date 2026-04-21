#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    // Normalise to Windows backslashes
    let win_path = path.replace('/', "\\");
    // /select highlights the specific file in Explorer rather than just opening the folder
    std::process::Command::new("explorer")
        .arg(format!("/select,\"{}\"", win_path))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![file_exists, reveal_in_explorer])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}