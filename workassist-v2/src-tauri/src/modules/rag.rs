use tauri::{plugin::{Builder, TauriPlugin}, Runtime};
use tokio::process::Command;
use serde_json::Value;

/// Invokes the sidecar script (opendataloader-pdf.py) asynchronously.
/// This mimics the architecture of calling an actual Rust sidecar binary.
#[tauri::command]
async fn invoke_sidecar_test(file_path: String) -> Result<Value, String> {
    // Determine the absolute path to the script relative to the current working directory
    // For development, assuming we run from src-tauri, the scripts folder is ../scripts
    let script_path = std::env::current_dir()
        .unwrap_or_default()
        .parent()
        .unwrap()
        .join("scripts")
        .join("opendataloader-pdf.py");

    let script_path_str = script_path.to_string_lossy().to_string();

    println!("Executing sidecar at: {}", script_path_str);
    println!("Target file: {}", file_path);

    // Spawn the subprocess asynchronously using tokio
    let output = Command::new("python")
        .arg(&script_path_str)
        .arg(&file_path)
        .output()
        .await
        .map_err(|e| format!("Failed to execute sidecar process: {}", e))?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Sidecar failed with error: {}", err_msg));
    }

    // Capture Stdout
    let stdout_str = String::from_utf8_lossy(&output.stdout);

    // Parse the JSON output
    match serde_json::from_str::<Value>(&stdout_str) {
        Ok(json_data) => Ok(json_data),
        Err(e) => Err(format!("Failed to parse JSON from sidecar: {}. Output was: {}", e, stdout_str)),
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("rag")
        .invoke_handler(tauri::generate_handler![
            invoke_sidecar_test
        ])
        .build()
}
