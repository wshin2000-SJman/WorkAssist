use crate::api::Api;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize)]
pub struct InvokePayload {
    pub cmd: String,
    pub args: Value,
}

#[derive(Serialize)]
pub struct InvokeResponse {
    pub result: Option<Value>,
    pub error: Option<String>,
}

impl InvokeResponse {
    pub fn ok<T: Serialize>(val: T) -> Self {
        match serde_json::to_value(val) {
            Ok(v) => Self {
                result: Some(v),
                error: None,
            },
            Err(e) => Self {
                result: None,
                error: Some(e.to_string()),
            },
        }
    }

    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            result: None,
            error: Some(msg.into()),
        }
    }
}

pub fn dispatch_command(api: &Api, payload: InvokePayload) -> InvokeResponse {
    let cmd = payload.cmd.as_str();
    let args = payload.args;

    match cmd {
        // --- Engine Commands ---
        "plugin:engine|get_app_version" => InvokeResponse::ok(env!("CARGO_PKG_VERSION")),
        "plugin:engine|get_enabled_features" => {
            let features = vec!["kanban".to_string(), "minutes".to_string(), "pm".to_string()];
            InvokeResponse::ok(features)
        }
        "plugin:engine|get_db_last_modified" => {
            let db_path = &api.storage.path;
            if !db_path.exists() {
                return InvokeResponse::err("Database file does not exist");
            }
            match std::fs::metadata(db_path) {
                Ok(meta) => match meta.modified() {
                    Ok(modified) => {
                        let datetime: chrono::DateTime<chrono::Local> = modified.into();
                        InvokeResponse::ok(datetime.format("%y%m%d-%H%M%S").to_string())
                    }
                    Err(e) => InvokeResponse::err(e.to_string()),
                },
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:engine|manual_backup" => {
            let path: Option<String> = args.get("path").and_then(|v| v.as_str().map(|s| s.to_string()));
            if let Some(dest_path) = path {
                match api.manual_backup(dest_path.clone()) {
                    Ok(_) => InvokeResponse::ok(format!("Backup saved to: {}", dest_path)),
                    Err(e) => InvokeResponse::err(e),
                }
            } else {
                match api.backup() {
                    Ok(_) => InvokeResponse::ok("Default backup created successfully"),
                    Err(e) => InvokeResponse::err(e),
                }
            }
        }
        "plugin:engine|import_db" => {
            let path = match args.get("path").and_then(|v| v.as_str()) {
                Some(p) => p.to_string(),
                None => return InvokeResponse::err("Missing path argument"),
            };
            let user = args.get("user").and_then(|v| serde_json::from_value(v.clone()).ok());
            match api.import_db(path, user) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e),
            }
        }
        "plugin:engine|open_backup_folder" => {
            let backup_dir = api.storage.get_backup_dir();
            if !backup_dir.exists() {
                let _ = std::fs::create_dir_all(&backup_dir);
            }
            match open::that(backup_dir) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:engine|initialize_data" => {
            let user = args.get("user").and_then(|v| serde_json::from_value(v.clone()).ok());
            match api.initialize_data(user) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e),
            }
        }

        // --- Auth Commands ---
        "plugin:auth|login" => {
            let username = args.get("username").and_then(|v| v.as_str()).unwrap_or_default();
            let password_hash = args.get("password_hash").and_then(|v| v.as_str()).unwrap_or_default();
            match api.auth().login(username, password_hash) {
                Ok(user) => InvokeResponse::ok(user),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:auth|create_user" => {
            let username = args.get("username").and_then(|v| v.as_str()).unwrap_or_default();
            let password_hash = args.get("password_hash").and_then(|v| v.as_str()).unwrap_or_default();
            let hint = args.get("hint").and_then(|v| v.as_str()).unwrap_or_default();
            match api.auth().create_user(username, password_hash, hint) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:auth|get_password_hint" => {
            let username = args.get("username").and_then(|v| v.as_str()).unwrap_or_default();
            match api.auth().get_hint(username) {
                Ok(hint) => InvokeResponse::ok(hint),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:auth|change_password" => {
            let username = args.get("username").and_then(|v| v.as_str()).unwrap_or_default();
            let old_hash = args.get("old_hash").and_then(|v| v.as_str()).unwrap_or_default();
            let new_hash = args.get("new_hash").and_then(|v| v.as_str()).unwrap_or_default();
            let new_hint = args.get("new_hint").and_then(|v| v.as_str()).unwrap_or_default();
            match api.auth().change_password(username, old_hash, new_hash, new_hint) {
                Ok(success) => InvokeResponse::ok(success),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }

        // --- Kanban Commands ---
        "plugin:kanban|get_tasks" => {
            let owner_id = args.get("owner_id").and_then(|v| v.as_i64()).unwrap_or(1);
            match api.kanban().get_all_tasks(owner_id) {
                Ok(tasks) => InvokeResponse::ok(tasks),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:kanban|add_task" => {
            let task_val = match args.get("task") {
                Some(v) => v,
                None => return InvokeResponse::err("Missing task param"),
            };
            match serde_json::from_value(task_val.clone()) {
                Ok(task) => match api.kanban().add_task(task) {
                    Ok(id) => InvokeResponse::ok(id),
                    Err(e) => InvokeResponse::err(e),
                },
                Err(e) => InvokeResponse::err(format!("Invalid task format: {}", e)),
            }
        }
        "plugin:kanban|update_task_status" => {
            let task_id = args.get("task_id").and_then(|v| v.as_i64()).unwrap_or(0);
            let new_status = args.get("new_status").and_then(|v| v.as_str()).unwrap_or_default();
            match api.kanban().update_status(task_id, new_status) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:kanban|update_task" => {
            let task_val = match args.get("task") {
                Some(v) => v,
                None => return InvokeResponse::err("Missing task param"),
            };
            match serde_json::from_value(task_val.clone()) {
                Ok(task) => match api.kanban().update_task(task) {
                    Ok(_) => InvokeResponse::ok(()),
                    Err(e) => InvokeResponse::err(e.to_string()),
                },
                Err(e) => InvokeResponse::err(format!("Invalid task format: {}", e)),
            }
        }
        "plugin:kanban|delete_task" => {
            let task_id = args.get("task_id").and_then(|v| v.as_i64()).unwrap_or(0);
            match api.kanban().delete_task(task_id) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:kanban|get_deleted_tasks" => {
            let owner_id = args.get("owner_id").and_then(|v| v.as_i64()).unwrap_or(1);
            match api.kanban().get_deleted_tasks(owner_id) {
                Ok(tasks) => InvokeResponse::ok(tasks),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:kanban|restore_task" => {
            let task_id = args.get("task_id").and_then(|v| v.as_i64()).unwrap_or(0);
            match api.kanban().restore_task(task_id) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:kanban|hard_delete_task_cmd" => {
            let task_id = args.get("task_id").and_then(|v| v.as_i64()).unwrap_or(0);
            match api.kanban().hard_delete_task(task_id) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }

        // --- Minutes Commands ---
        "plugin:minutes|get_meetings" => {
            let owner_id = args.get("owner_id").and_then(|v| v.as_i64()).unwrap_or(1);
            match api.minutes().get_all_meetings(owner_id) {
                Ok(meetings) => InvokeResponse::ok(meetings),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:minutes|get_meeting_count" => {
            let owner_id = args.get("owner_id").and_then(|v| v.as_i64()).unwrap_or(1);
            match api.minutes().get_all_meetings(owner_id) {
                Ok(meetings) => InvokeResponse::ok(meetings.len()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:minutes|save_meeting" => {
            let m_val = match args.get("meeting") {
                Some(v) => v,
                None => return InvokeResponse::err("Missing meeting param"),
            };
            match serde_json::from_value(m_val.clone()) {
                Ok(meeting) => match api.minutes().save_meeting(meeting) {
                    Ok(id) => InvokeResponse::ok(id),
                    Err(e) => InvokeResponse::err(e.to_string()),
                },
                Err(e) => InvokeResponse::err(format!("Invalid meeting format: {}", e)),
            }
        }
        "plugin:minutes|delete_meeting" => {
            let id = args.get("meeting_id").and_then(|v| v.as_i64()).unwrap_or(0);
            match api.minutes().delete_meeting(id) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:minutes|get_deleted_meetings" => {
            let owner_id = args.get("owner_id").and_then(|v| v.as_i64()).unwrap_or(1);
            match api.minutes().get_deleted_meetings(owner_id) {
                Ok(meetings) => InvokeResponse::ok(meetings),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:minutes|restore_meeting" => {
            let id = args.get("meeting_id").and_then(|v| v.as_i64()).unwrap_or(0);
            match api.minutes().restore_meeting(id) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:minutes|hard_delete_meeting_cmd" => {
            let id = args.get("meeting_id").and_then(|v| v.as_i64()).unwrap_or(0);
            match api.minutes().hard_delete_meeting(id) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:minutes|get_categories" => {
            let owner_id = args.get("owner_id").and_then(|v| v.as_i64()).unwrap_or(1);
            match api.minutes().get_categories(owner_id) {
                Ok(cats) => InvokeResponse::ok(cats),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:minutes|save_category" => {
            let cat_val = match args.get("category") {
                Some(v) => v,
                None => return InvokeResponse::err("Missing category param"),
            };
            match serde_json::from_value(cat_val.clone()) {
                Ok(cat) => match api.minutes().save_category(cat) {
                    Ok(id) => InvokeResponse::ok(id),
                    Err(e) => InvokeResponse::err(e.to_string()),
                },
                Err(e) => InvokeResponse::err(format!("Invalid category format: {}", e)),
            }
        }
        "plugin:minutes|delete_category" => {
            let id = args.get("category_id").and_then(|v| v.as_i64()).unwrap_or(0);
            match api.minutes().delete_category(id) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:minutes|export_meeting_md" => {
            let m_val = match args.get("meeting") {
                Some(v) => v,
                None => return InvokeResponse::err("Missing meeting param"),
            };
            match serde_json::from_value(m_val.clone()) {
                Ok(meeting) => InvokeResponse::ok(api.minutes().export_to_markdown(&meeting)),
                Err(e) => InvokeResponse::err(format!("Invalid meeting format: {}", e)),
            }
        }
        "plugin:minutes|save_text_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or_default();
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or_default();
            match std::fs::write(path, content) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }

        // --- Motor Commands ---
        "plugin:motor|calculate_torque" => {
            let inertia = args.get("inertia").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let acceleration = args.get("acceleration").and_then(|v| v.as_f64()).unwrap_or(0.0);
            match api.motor().calculate_torque(inertia, acceleration) {
                Ok(res) => InvokeResponse::ok(res),
                Err(e) => InvokeResponse::err(e),
            }
        }
        "plugin:motor|calculate_inertia" => {
            let shape_type = args.get("shape_type").and_then(|v| v.as_str()).unwrap_or_default();
            let mass = args.get("mass").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let radius = args.get("radius").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let length = args.get("length").and_then(|v| v.as_f64()).unwrap_or(0.0);
            match api.motor().calculate_inertia(shape_type, mass, radius, length) {
                Ok(res) => InvokeResponse::ok(res),
                Err(e) => InvokeResponse::err(e),
            }
        }
        "plugin:motor|convert_speed" => {
            let value = args.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let from_unit = args.get("from_unit").and_then(|v| v.as_str()).unwrap_or_default();
            let to_unit = args.get("to_unit").and_then(|v| v.as_str()).unwrap_or_default();
            match api.motor().convert_speed(value, from_unit, to_unit) {
                Ok(res) => InvokeResponse::ok(res),
                Err(e) => InvokeResponse::err(e),
            }
        }
        "plugin:motor|calculate_angular_acceleration" => {
            let initial_speed = args.get("initial_speed").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let final_speed = args.get("final_speed").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let time = args.get("time").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let unit = args.get("unit").and_then(|v| v.as_str()).unwrap_or_default();
            match api.motor().calculate_angular_acceleration(initial_speed, final_speed, time, unit) {
                Ok(res) => InvokeResponse::ok(res),
                Err(e) => InvokeResponse::err(e),
            }
        }
        "plugin:motor|calculate_combined_torque" => {
            let mass = args.get("mass").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let arm_length = args.get("arm_length").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let angle_deg = args.get("angle_deg").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let acceleration = args.get("acceleration").and_then(|v| v.as_f64()).unwrap_or(0.0);
            match api.motor().calculate_combined_torque(mass, arm_length, angle_deg, acceleration) {
                Ok(res) => InvokeResponse::ok(res),
                Err(e) => InvokeResponse::err(e),
            }
        }
        "plugin:motor|calculate_motor_specs" => {
            let voltage_in = args.get("voltageIn").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let kb_v_krpm = args.get("kbVKrpm").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let torque_required = args.get("torqueRequired").and_then(|v| v.as_f64()).unwrap_or(0.0);
            match api.motor().calculate_motor_specs(voltage_in, kb_v_krpm, torque_required) {
                Ok(res) => InvokeResponse::ok(res),
                Err(e) => InvokeResponse::err(e),
            }
        }
        "plugin:motor|calculate_rms_cycle" => {
            let stages_val = match args.get("stages") {
                Some(v) => v,
                None => return InvokeResponse::err("Missing stages param"),
            };
            match serde_json::from_value(stages_val.clone()) {
                Ok(stages) => match api.motor().calculate_rms_cycle(stages) {
                    Ok(res) => InvokeResponse::ok(res),
                    Err(e) => InvokeResponse::err(e),
                },
                Err(e) => InvokeResponse::err(format!("Invalid stages format: {}", e)),
            }
        }

        // --- PM Commands ---
        "plugin:pm|get_projects" => {
            let owner_id = args.get("owner_id").and_then(|v| v.as_i64()).unwrap_or(1);
            match api.pm().get_active_projects(owner_id) {
                Ok(projects) => InvokeResponse::ok(projects),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:pm|get_project_count" => {
            let owner_id = args.get("owner_id").and_then(|v| v.as_i64()).unwrap_or(1);
            match api.pm().get_active_projects(owner_id) {
                Ok(projects) => InvokeResponse::ok(projects.len()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:pm|add_project" => {
            let p_val = match args.get("project") {
                Some(v) => v,
                None => return InvokeResponse::err("Missing project param"),
            };
            match serde_json::from_value(p_val.clone()) {
                Ok(project) => match api.pm().add_project(project) {
                    Ok(id) => InvokeResponse::ok(id),
                    Err(e) => InvokeResponse::err(e.to_string()),
                },
                Err(e) => InvokeResponse::err(format!("Invalid project format: {}", e)),
            }
        }
        "plugin:pm|delete_project" => {
            let id = args.get("project_id").and_then(|v| v.as_i64()).unwrap_or(0);
            match api.pm().delete_project(id) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:pm|get_deleted_projects" => {
            let owner_id = args.get("owner_id").and_then(|v| v.as_i64()).unwrap_or(1);
            match api.pm().get_deleted_projects(owner_id) {
                Ok(projects) => InvokeResponse::ok(projects),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:pm|restore_project" => {
            let id = args.get("project_id").and_then(|v| v.as_i64()).unwrap_or(0);
            match api.pm().restore_project(id) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:pm|hard_delete_project_cmd" => {
            let id = args.get("project_id").and_then(|v| v.as_i64()).unwrap_or(0);
            match api.pm().hard_delete_project(id) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:pm|get_status_logs" => {
            let project_id = args.get("project_id").and_then(|v| v.as_i64()).unwrap_or(0);
            match api.pm().get_status_logs(project_id) {
                Ok(logs) => InvokeResponse::ok(logs),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:pm|add_status_log" => {
            let log_val = match args.get("log") {
                Some(v) => v,
                None => return InvokeResponse::err("Missing log param"),
            };
            match serde_json::from_value(log_val.clone()) {
                Ok(log) => match api.pm().add_status_log(log) {
                    Ok(id) => InvokeResponse::ok(id),
                    Err(e) => InvokeResponse::err(e.to_string()),
                },
                Err(e) => InvokeResponse::err(format!("Invalid status log format: {}", e)),
            }
        }
        "plugin:pm|update_status_log" => {
            let log_val = match args.get("log") {
                Some(v) => v,
                None => return InvokeResponse::err("Missing log param"),
            };
            match serde_json::from_value(log_val.clone()) {
                Ok(log) => match api.pm().update_status_log(log) {
                    Ok(_) => InvokeResponse::ok(()),
                    Err(e) => InvokeResponse::err(e.to_string()),
                },
                Err(e) => InvokeResponse::err(format!("Invalid status log format: {}", e)),
            }
        }
        "plugin:pm|delete_status_log_permanent" => {
            let log_id = args.get("log_id").and_then(|v| v.as_i64()).unwrap_or(0);
            match api.pm().delete_status_log_permanent(log_id) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:pm|update_status_log_status" => {
            let log_id = args.get("log_id").and_then(|v| v.as_i64()).unwrap_or(0);
            let status = args.get("status").and_then(|v| v.as_str()).unwrap_or_default();
            match api.pm().update_status_log_status(log_id, status.to_string()) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:pm|update_status_log_deleted" => {
            let log_id = args.get("log_id").and_then(|v| v.as_i64()).unwrap_or(0);
            let is_deleted = args.get("is_deleted").and_then(|v| v.as_bool()).unwrap_or(false);
            match api.pm().update_status_log_deleted(log_id, is_deleted) {
                Ok(_) => InvokeResponse::ok(()),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:pm|get_milestones" => {
            let project_id = args.get("project_id").and_then(|v| v.as_i64()).unwrap_or(0);
            match api.pm().get_milestones(project_id) {
                Ok(milestones) => InvokeResponse::ok(milestones),
                Err(e) => InvokeResponse::err(e.to_string()),
            }
        }
        "plugin:pm|save_milestone" => {
            let m_val = match args.get("milestone") {
                Some(v) => v,
                None => return InvokeResponse::err("Missing milestone param"),
            };
            match serde_json::from_value(m_val.clone()) {
                Ok(milestone) => match api.pm().save_milestone(milestone) {
                    Ok(_) => InvokeResponse::ok(()),
                    Err(e) => InvokeResponse::err(e.to_string()),
                },
                Err(e) => InvokeResponse::err(format!("Invalid milestone format: {}", e)),
            }
        }

        // --- Fallback for unhandled/optional plugin commands ---
        _ => {
            println!("[Warn] Unhandled Command Invoked: {}", cmd);
            InvokeResponse::ok(Value::Null)
        }
    }
}
