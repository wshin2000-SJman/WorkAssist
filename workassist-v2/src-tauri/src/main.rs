// WorkAssist v2.0 - Core Engine (Tauri + Rust)
// Refactored to Plugin Architecture

mod api;
mod models;
mod modules;
mod storage;

use api::Api;
use std::sync::Arc;
use storage::Storage;
use tauri::{State, Manager, AppHandle};

// --- Core Engine Commands (Stay in main for now) ---

#[tauri::command]
async fn get_enabled_features() -> Vec<String> {
    let mut features = Vec::new();
    #[cfg(feature = "kanban")]
    features.push("kanban".to_string());
    #[cfg(feature = "minutes")]
    features.push("minutes".to_string());
    #[cfg(feature = "pm")]
    features.push("pm".to_string());
    features
}

#[tauri::command]
async fn manual_backup(storage: State<'_, Arc<Storage>>, path: Option<String>) -> Result<String, String> {
    if let Some(dest_path) = path {
        let response_msg = format!("Backup saved to: {}", dest_path);
        storage.inner().manual_backup(dest_path.into())?;
        Ok(response_msg)
    } else {
        storage.inner().perform_backup()?;
        Ok("Default backup created successfully".to_string())
    }
}

#[tauri::command]
async fn import_db(storage: State<'_, Arc<Storage>>, path: String, user: Option<crate::models::User>) -> Result<(), String> {
    storage.inner().import_database(path.into(), user)
}

#[tauri::command]
async fn open_backup_folder<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    path.push("backups");
    if !path.exists() {
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    open::that(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn initialize_data(storage: State<'_, Arc<Storage>>, user: Option<crate::models::User>) -> Result<(), String> {
    storage.inner().initialize_all_data(user).map_err(|e| e.to_string())
}

#[tauri::command]
async fn seed_demo_data_cmd(storage: State<'_, Arc<Storage>>) -> Result<(), String> {
    storage.inner().seed_demo_data().map_err(|e| e.to_string())
}

#[tauri::command]
async fn clear_demo_data_cmd(storage: State<'_, Arc<Storage>>) -> Result<(), String> {
    storage.inner().clear_demo_data().map_err(|e| e.to_string())
}

// --- Core Engine Plugin ---

pub fn init_engine<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("engine")
        .invoke_handler(tauri::generate_handler![
            manual_backup,
            import_db,
            open_backup_folder,
            initialize_data,
            get_enabled_features,
            seed_demo_data_cmd,
            clear_demo_data_cmd
        ])
        .build()
}

fn main() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(init_engine()) // Register Engine Plugin
        .setup(|app| {
            // Initialize Storage in setup to get access to app paths
            let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            if !app_data_dir.exists() {
                std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data dir");
            }
            let db_path = app_data_dir.join("workassist.db");
            
            let storage = Arc::new(Storage::new(db_path).expect("Failed to initialize database"));
            let api = Api::new(storage.clone());
            
            app.manage(storage);
            app.manage(api);
            
            Ok(())
        });

    // Register Business Plugins
    builder = builder.plugin(crate::modules::auth::init());
    builder = builder.plugin(crate::modules::gateway::init());

    #[cfg(feature = "kanban")]
    {
        builder = builder.plugin(crate::modules::kanban::init());
    }

    #[cfg(feature = "minutes")]
    {
        builder = builder.plugin(crate::modules::minutes::init());
    }

    #[cfg(feature = "pm")]
    {
        builder = builder.plugin(crate::modules::pm::init());
    }

    builder
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let api = window.state::<api::Api>();
                println!("Window closing... performing final backup.");
                if let Err(e) = api.backup() {
                    eprintln!("Failed to perform exit backup: {}", e);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
