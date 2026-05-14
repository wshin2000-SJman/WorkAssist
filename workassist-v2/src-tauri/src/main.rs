mod models;
mod storage;
mod modules;
mod api;

use std::sync::Arc;
use tauri::{State, Manager};
use crate::api::Api;
use crate::storage::Storage;
use crate::models::{Task, Meeting, Project, StatusLog, Milestone, User};

// --- Tauri Commands ---

#[tauri::command]
async fn get_task_count(api: State<'_, Api>) -> Result<usize, String> {
    let owner_id = 1; 
    api.kanban().get_all_tasks(owner_id).map(|t| t.len()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_meeting_count(api: State<'_, Api>) -> Result<usize, String> {
    let owner_id = 1;
    api.minutes().get_all_meetings(owner_id).map(|m| m.len()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_project_count(api: State<'_, Api>) -> Result<usize, String> {
    let owner_id = 1;
    api.pm().get_active_projects(owner_id).map(|p| p.len()).map_err(|e| e.to_string())
}

// --- Auth Commands ---

#[tauri::command]
async fn login(api: State<'_, Api>, username: String, password_hash: String) -> Result<Option<User>, String> {
    api.auth().login(&username, &password_hash).map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_user(api: State<'_, Api>, username: String, password_hash: String, hint: String) -> Result<(), String> {
    api.auth().create_user(&username, &password_hash, &hint).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_password_hint(api: State<'_, Api>, username: String) -> Result<Option<String>, String> {
    api.auth().get_hint(&username).map_err(|e| e.to_string())
}

#[tauri::command]
async fn change_password(api: State<'_, Api>, username: String, old_hash: String, new_hash: String, new_hint: String) -> Result<bool, String> {
    api.auth().change_password(&username, &old_hash, &new_hash, &new_hint).map_err(|e| e.to_string())
}

// --- Kanban Commands ---

#[tauri::command]
async fn get_tasks(api: State<'_, Api>) -> Result<Vec<Task>, String> {
    let owner_id = 1;
    api.kanban().get_all_tasks(owner_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_task(api: State<'_, Api>, task: Task) -> Result<i64, String> {
    api.kanban().add_task(task)
}

#[tauri::command]
async fn update_task_status(api: State<'_, Api>, task_id: i64, new_status: String) -> Result<(), String> {
    api.kanban().update_status(task_id, &new_status).map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_task(api: State<'_, Api>, task: Task) -> Result<(), String> {
    api.kanban().update_task(task).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_task(api: State<'_, Api>, task_id: i64) -> Result<(), String> {
    api.kanban().delete_task(task_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_deleted_tasks(api: State<'_, Api>) -> Result<Vec<Task>, String> {
    let owner_id = 1;
    api.kanban().get_deleted_tasks(owner_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn restore_task(api: State<'_, Api>, task_id: i64) -> Result<(), String> {
    api.kanban().restore_task(task_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn hard_delete_task(api: State<'_, Api>, task_id: i64) -> Result<(), String> {
    api.kanban().hard_delete_task(task_id).map_err(|e| e.to_string())
}

// --- Minutes Commands ---

#[tauri::command]
async fn get_meetings(api: State<'_, Api>) -> Result<Vec<Meeting>, String> {
    let owner_id = 1;
    api.minutes().get_all_meetings(owner_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_meeting(api: State<'_, Api>, meeting: Meeting) -> Result<i64, String> {
    api.minutes().save_meeting(meeting).map_err(|e| e.to_string())
}

#[tauri::command]
async fn export_meeting_md(api: State<'_, Api>, meeting: Meeting) -> Result<String, String> {
    Ok(api.minutes().export_to_markdown(&meeting))
}

// --- PM Commands ---

#[tauri::command]
async fn get_projects(api: State<'_, Api>) -> Result<Vec<Project>, String> {
    let owner_id = 1;
    api.pm().get_active_projects(owner_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_status_logs(api: State<'_, Api>, project_id: i64) -> Result<Vec<StatusLog>, String> {
    api.pm().get_status_logs(project_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn manual_backup(api: State<'_, Api>, path: String) -> Result<(), String> {
    api.manual_backup(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn import_db(api: State<'_, Api>, path: String) -> Result<(), String> {
    api.import_db(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_backup_folder(api: State<'_, Api>) -> Result<(), String> {
    let path = api.get_backup_path();
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        // For other OS, could use 'open' or 'xdg-open'
        println!("Open folder not implemented for this OS: {}", path);
    }
    Ok(())
}

#[tauri::command]
async fn initialize_data(api: State<'_, Api>) -> Result<(), String> {
    let user_id = 1; // For now, hardcoded as 1
    api.initialize_data(user_id)
}

// --- Main Entry ---

fn main() {
    let db_path = Storage::get_default_path();
    let storage = Arc::new(Storage::new(db_path).expect("Failed to initialize database"));
    let api = Api::new(storage);
    let api_for_thread = api.clone();

    // 15-minute background backup thread
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(15 * 60));
            println!("Performing scheduled 15-minute backup...");
            if let Err(e) = api_for_thread.backup() {
                eprintln!("Background backup failed: {}", e);
            }
        }
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(api)
        .invoke_handler(tauri::generate_handler![
            login,
            create_user,
            get_password_hint,
            change_password,
            get_task_count,
            get_meeting_count,
            get_project_count,
            get_tasks,
            add_task,
            update_task_status,
            update_task,
            delete_task,
            get_deleted_tasks,
            restore_task,
            hard_delete_task,
            get_meetings,
            save_meeting,
            export_meeting_md,
            get_projects,
            get_status_logs,
            manual_backup,
            import_db,
            open_backup_folder,
            initialize_data
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let api = window.state::<Api>();
                println!("Program exiting, performing final backup...");
                if let Err(e) = api.backup() {
                    eprintln!("Final backup failed: {}", e);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
