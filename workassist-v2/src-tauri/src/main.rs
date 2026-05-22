// WorkAssist v2.0 - Core Engine (Tauri + Rust)
// Refactored to Plugin Architecture

mod api;
mod models;
mod modules;
mod storage;

use api::Api;
use std::sync::Arc;
use storage::Storage;
use tauri::{State, Manager};

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
    #[cfg(feature = "rag")]
    features.push("rag".to_string());
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

#[tauri::command]
async fn get_db_last_modified(storage: State<'_, Arc<Storage>>) -> Result<String, String> {
    let db_path = &storage.inner().path;
    if !db_path.exists() {
        return Err("Database file does not exist".to_string());
    }
    
    let metadata = std::fs::metadata(db_path).map_err(|e| e.to_string())?;
    let modified = metadata.modified().map_err(|e| e.to_string())?;
    
    let datetime: chrono::DateTime<chrono::Local> = modified.into();
    Ok(datetime.format("%y%m%d-%H%M%S").to_string())
}

#[tauri::command]
async fn get_oxigraph_last_modified() -> Result<String, String> {
    let mut db_path = if cfg!(windows) {
        std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into()))
    } else {
        std::path::PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()))
    };
    db_path.push("SJ_WorkAssist");
    db_path.push("oxigraph_data");
    
    if !db_path.exists() {
        return Ok("N/A".to_string());
    }
    
    // Find the latest modified time among all files in the directory
    let mut latest_time = None;
    if let Ok(entries) = std::fs::read_dir(&db_path) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    if let Ok(modified) = metadata.modified() {
                        if latest_time.is_none() || Some(modified) > latest_time {
                            latest_time = Some(modified);
                        }
                    }
                }
            }
        }
    }
    
    let time_to_use = match latest_time {
        Some(t) => t,
        None => {
            let metadata = std::fs::metadata(&db_path).map_err(|e| e.to_string())?;
            metadata.modified().map_err(|e| e.to_string())?
        }
    };
    
    let datetime: chrono::DateTime<chrono::Local> = time_to_use.into();
    Ok(datetime.format("%y%m%d-%H%M%S").to_string())
}

fn copy_dir_all(src: impl AsRef<std::path::Path>, dst: impl AsRef<std::path::Path>) -> std::io::Result<()> {
    std::fs::create_dir_all(&dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(entry.path(), dst.as_ref().join(entry.file_name()))?;
        } else {
            std::fs::copy(entry.path(), dst.as_ref().join(entry.file_name()))?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn manual_backup_oxigraph(path: String) -> Result<String, String> {
    let mut db_path = if cfg!(windows) {
        std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into()))
    } else {
        std::path::PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()))
    };
    db_path.push("SJ_WorkAssist");
    db_path.push("oxigraph_data");
    
    if !db_path.exists() {
        return Err("Oxigraph 데이터베이스가 아직 생성되지 않았습니다.".to_string());
    }
    
    let dest_path = std::path::PathBuf::from(&path);
    copy_dir_all(&db_path, &dest_path).map_err(|e| format!("백업 실패: {}", e))?;
    
    Ok(format!("Oxigraph 데이터베이스 백업 완료: {}", path))
}

#[tauri::command]
async fn import_oxigraph(
    #[cfg(feature = "rag")] state: tauri::State<'_, Arc<std::sync::Mutex<crate::modules::knowledge::KnowledgeStore>>>,
    path: String,
) -> Result<(), String> {
    let mut db_path = if cfg!(windows) {
        std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into()))
    } else {
        std::path::PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()))
    };
    db_path.push("SJ_WorkAssist");
    db_path.push("oxigraph_data");
    
    let backup_src = std::path::PathBuf::from(&path);
    if !backup_src.exists() {
        return Err("지정한 백업 경로가 존재하지 않습니다.".to_string());
    }
    
    #[cfg(feature = "rag")]
    {
        let mut store_guard = state.lock().map_err(|e| e.to_string())?;
        
        // Temporarily clear storage instance to release RocksDB locks
        let temp_store = oxigraph::store::Store::new().map_err(|e| e.to_string())?;
        store_guard.store = temp_store;
        
        if db_path.exists() {
            std::fs::remove_dir_all(&db_path).map_err(|e| format!("기존 DB 폴더 삭제 실패: {}", e))?;
        }
        
        copy_dir_all(&backup_src, &db_path).map_err(|e| format!("백업 데이터 복사 실패: {}", e))?;
        
        let restored_store = oxigraph::store::Store::open(&db_path).map_err(|e| format!("복구된 스토어 오픈 실패: {}", e))?;
        store_guard.store = restored_store;
        
        Ok(())
    }
    
    #[cfg(not(feature = "rag"))]
    {
        Err("Oxigraph RAG 피처가 활성화되어 있지 않습니다.".to_string())
    }
}

#[tauri::command]
async fn open_oxigraph_backup_folder<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    path.push("oxigraph_backups");
    if !path.exists() {
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    open::that(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn initialize_oxigraph_data(
    #[cfg(feature = "rag")] state: tauri::State<'_, Arc<std::sync::Mutex<crate::modules::knowledge::KnowledgeStore>>>,
) -> Result<(), String> {
    let mut db_path = if cfg!(windows) {
        std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into()))
    } else {
        std::path::PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()))
    };
    db_path.push("SJ_WorkAssist");
    db_path.push("oxigraph_data");
    
    #[cfg(feature = "rag")]
    {
        let mut store_guard = state.lock().map_err(|e| e.to_string())?;
        
        let temp_store = oxigraph::store::Store::new().map_err(|e| e.to_string())?;
        store_guard.store = temp_store;
        
        if db_path.exists() {
            std::fs::remove_dir_all(&db_path).map_err(|e| format!("기존 DB 폴더 삭제 실패: {}", e))?;
        }
        std::fs::create_dir_all(&db_path).map_err(|e| format!("폴더 재생성 실패: {}", e))?;
        
        let new_store = oxigraph::store::Store::open(&db_path).map_err(|e| format!("새 스토어 생성 실패: {}", e))?;
        store_guard.store = new_store;
        
        Ok(())
    }
    
    #[cfg(not(feature = "rag"))]
    {
        Err("Oxigraph RAG 피처가 활성화되어 있지 않습니다.".to_string())
    }
}

// --- Core Engine Commands (Stay in main for now) ---

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
            clear_demo_data_cmd,
            get_db_last_modified,
            get_oxigraph_last_modified,
            manual_backup_oxigraph,
            import_oxigraph,
            open_oxigraph_backup_folder,
            initialize_oxigraph_data
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
            let db_path = app_data_dir.join("sjworkassist_v2.db");
            
            let storage = Arc::new(Storage::new(db_path).expect("Failed to initialize database"));
            let api = Api::new(storage.clone());
            
            app.manage(storage);
            app.manage(api);
            
            #[cfg(feature = "rag")]
            {
                let knowledge_store = Arc::new(std::sync::Mutex::new(
                    crate::modules::knowledge::KnowledgeStore::new().expect("Failed to initialize Oxigraph Store")
                ));
                app.manage(knowledge_store);
            }
            
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

    #[cfg(feature = "rag")]
    {
        builder = builder.plugin(crate::modules::rag::init());
        builder = builder.plugin(crate::modules::knowledge::init());
    }

    builder
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let api = window.state::<api::Api>();
                let _ = api.backup();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
