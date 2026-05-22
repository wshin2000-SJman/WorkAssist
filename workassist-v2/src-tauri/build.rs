fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .plugin("auth", tauri_build::InlinedPlugin::new().commands(&["login", "create_user", "get_password_hint", "change_password"]))
            .plugin("kanban", tauri_build::InlinedPlugin::new().commands(&["get_task_count", "get_tasks", "add_task", "update_task_status", "update_task", "delete_task", "get_deleted_tasks", "restore_task", "hard_delete_task_cmd"]))
            .plugin("minutes", tauri_build::InlinedPlugin::new().commands(&["get_meeting_count", "get_meetings", "save_meeting", "export_meeting_md", "export_minutes_md_bulk", "import_minutes_md_bulk", "import_minutes_md_single", "save_text_file", "delete_meeting", "get_deleted_meetings", "restore_meeting", "hard_delete_meeting_cmd", "get_categories", "save_category", "delete_category"]))
            .plugin("pm", tauri_build::InlinedPlugin::new().commands(&["get_project_count", "get_projects", "get_status_logs", "add_status_log", "update_status_log", "delete_status_log_permanent", "update_status_log_status", "update_status_log_deleted", "add_project", "get_milestones", "save_milestone", "delete_project", "get_deleted_projects", "restore_project", "hard_delete_project_cmd", "complete_project", "get_completed_projects", "reactivate_project", "export_project_db", "import_project_db"]))
            .plugin("gateway", tauri_build::InlinedPlugin::new().commands(&["get_ai_ready_tasks", "process_ai_response"]))
            .plugin("engine", tauri_build::InlinedPlugin::new().commands(&["manual_backup", "import_db", "open_backup_folder", "initialize_data", "get_enabled_features", "seed_demo_data_cmd", "clear_demo_data_cmd", "get_db_last_modified", "get_oxigraph_last_modified", "manual_backup_oxigraph", "import_oxigraph", "open_oxigraph_backup_folder", "initialize_oxigraph_data"]))
            .plugin("rag", tauri_build::InlinedPlugin::new().commands(&["invoke_sidecar_test", "index_parsed_specs", "search_specs", "generate_embeddings_test", "parse_excel", "get_pdf_files_in_folder", "preview_json_folder", "ingest_reviewed_specs", "search_hybrid_specs", "get_unique_metadata"]))
            .plugin("knowledge", tauri_build::InlinedPlugin::new().commands(&["register_project", "ingest_bom", "ingest_project_document", "query_knowledge", "get_graph_data", "delete_knowledge_entity", "get_all_projects"]))
    ).expect("failed to run tauri-build");
}
