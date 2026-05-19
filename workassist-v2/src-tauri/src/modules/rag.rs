use tauri::{plugin::{Builder, TauriPlugin}, Runtime, AppHandle, Manager};
use tokio::process::Command;
use serde_json::Value;
use std::path::PathBuf;

/// Resolves the path to the bundled JRE's java.exe.
///
/// In development mode, looks relative to the Cargo project root (src-tauri/bin/jre/bin/java.exe).
/// In production (bundled app), looks relative to the Tauri resource directory.
fn resolve_java_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    // Try production path first (resource_dir/bin/jre/bin/java.exe)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let prod_path = resource_dir.join("bin").join("jre").join("bin").join("java.exe");
        if prod_path.exists() {
            return Ok(prod_path);
        }
    }

    // Fallback to development path (src-tauri/bin/jre/bin/java.exe)
    let dev_path = std::env::current_dir()
        .map_err(|e| format!("Failed to get current dir: {}", e))?
        .join("bin")
        .join("jre")
        .join("bin")
        .join("java.exe");

    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err("Bundled JRE (java.exe) not found in either production or development paths.".into())
}

/// Resolves the path to the bundled opendataloader-pdf-cli.jar.
fn resolve_jar_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    // Try production path first
    if let Ok(resource_dir) = app.path().resource_dir() {
        let prod_path = resource_dir.join("bin").join("opendataloader-pdf-cli.jar");
        if prod_path.exists() {
            return Ok(prod_path);
        }
    }

    // Fallback to development path
    let dev_path = std::env::current_dir()
        .map_err(|e| format!("Failed to get current dir: {}", e))?
        .join("bin")
        .join("opendataloader-pdf-cli.jar");

    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err("opendataloader-pdf-cli.jar not found in either production or development paths.".into())
}

/// Invokes the bundled opendataloader-pdf sidecar asynchronously.
///
/// Spawns a subprocess using the bundled JRE to execute the JAR file,
/// parses the input PDF at the given path, and returns structured JSON output.
///
/// # Arguments
/// * `app` - Tauri AppHandle for resolving resource paths
/// * `file_path` - Absolute path to the PDF file to parse
/// * `format` - Output format (json, markdown, text, html). Defaults to "json".
/// * `output_dir` - Optional output directory. Defaults to same directory as input file.
#[tauri::command]
async fn invoke_sidecar_test<R: Runtime>(
    app: AppHandle<R>,
    file_path: String,
    format: Option<String>,
    output_dir: Option<String>,
) -> Result<Value, String> {
    let java_path = resolve_java_path(&app)?;
    let jar_path = resolve_jar_path(&app)?;

    let output_format = format.unwrap_or_else(|| "json".to_string());

    println!("[RAG] Java path: {}", java_path.display());
    println!("[RAG] JAR path: {}", jar_path.display());
    println!("[RAG] Target file: {}", file_path);
    println!("[RAG] Format: {}", output_format);

    let mut cmd = Command::new(java_path.to_string_lossy().to_string());
    // JDK 17+ module system requires explicit opens for PDFBox memory mapping
    cmd.arg("--add-opens").arg("java.base/java.nio=ALL-UNNAMED")
        .arg("--add-opens").arg("java.base/sun.nio.ch=ALL-UNNAMED")
        .arg("--add-opens").arg("java.base/jdk.internal.ref=ALL-UNNAMED")
        .arg("--add-opens").arg("java.base/java.lang=ALL-UNNAMED")
        .arg("--add-opens").arg("java.base/java.lang.invoke=ALL-UNNAMED")
        .arg("--add-opens").arg("java.base/java.lang.reflect=ALL-UNNAMED")
        .arg("-jar")
        .arg(jar_path.to_string_lossy().to_string())
        .arg("--format")
        .arg(&output_format);

    if let Some(ref dir) = output_dir {
        cmd.arg("--output-dir").arg(dir);
    }

    cmd.arg(&file_path);

    // Spawn the subprocess asynchronously — non-blocking for the main Tauri thread
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute opendataloader-pdf sidecar: {}", e))?;

    let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!(
            "opendataloader-pdf exited with error (code: {:?}).\nStderr: {}\nStdout: {}",
            output.status.code(),
            stderr_str,
            stdout_str
        ));
    }

    // Build a structured result
    let result = serde_json::json!({
        "status": "success",
        "exit_code": output.status.code().unwrap_or(0),
        "stdout": stdout_str.trim(),
        "stderr": stderr_str.trim(),
        "file_processed": file_path,
        "format": output_format
    });

    Ok(result)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("rag")
        .invoke_handler(tauri::generate_handler![
            invoke_sidecar_test
        ])
        .build()
}
