fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .plugin("auth", tauri_build::InlinedPlugin::new().commands(&["login", "create_user", "get_password_hint", "change_password"]))
            .plugin("kanban", tauri_build::InlinedPlugin::new().commands(&["get_task_count", "get_tasks", "add_task", "update_task_status", "update_task", "delete_task", "get_deleted_tasks", "restore_task", "hard_delete_task_cmd"]))
            .plugin("minutes", tauri_build::InlinedPlugin::new().commands(&["get_meeting_count", "get_meetings", "save_meeting", "export_meeting_md"]))
            .plugin("pm", tauri_build::InlinedPlugin::new().commands(&["get_project_count", "get_projects", "get_status_logs", "add_status_log"]))
            .plugin("gateway", tauri_build::InlinedPlugin::new().commands(&["get_ai_ready_tasks", "process_ai_response"]))
            .plugin("engine", tauri_build::InlinedPlugin::new().commands(&["manual_backup", "import_db", "open_backup_folder", "initialize_data", "get_enabled_features", "seed_demo_data_cmd", "clear_demo_data_cmd"]))
    ).expect("failed to run tauri-build");
}
