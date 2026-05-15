use crate::models::{Project, StatusLog, Milestone};
use crate::storage::Storage;
use rusqlite::{params, Result};
use chrono::Utc;

use std::sync::Arc;

pub struct PmModule {
    storage: Arc<Storage>,
}

impl PmModule {
    pub fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub fn get_active_projects(&self, owner_id: i64) -> Result<Vec<Project>> {
        let conn = self.storage.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, owner_id, name, description, manager, client, created_at, status, dept1_name, dept2_name, dept3_name, dept4_name 
             FROM projects WHERE (owner_id = ? OR owner_id = 999) AND status = 'active' ORDER BY created_at DESC"
        )?;
        
        let project_iter = stmt.query_map(params![owner_id], |row| {
            Ok(Project {
                id: Some(row.get(0)?),
                owner_id: Some(row.get(1)?),
                name: row.get(2)?,
                description: row.get(3)?,
                manager: row.get(4)?,
                client: row.get(5)?,
                created_at: row.get(6)?,
                status: row.get(7)?,
                dept1_name: row.get(8)?,
                dept2_name: row.get(9)?,
                dept3_name: row.get(10)?,
                dept4_name: row.get(11)?,
            })
        })?;

        let mut projects = Vec::new();
        for project in project_iter {
            projects.push(project?);
        }
        Ok(projects)
    }

    pub fn add_project(&self, mut project: Project) -> Result<i64> {
        let now = Utc::now().to_rfc3339();
        project.created_at = now;

        let conn = self.storage.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO projects (owner_id, name, description, manager, client, created_at, status, dept1_name, dept2_name, dept3_name, dept4_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                project.owner_id,
                project.name,
                project.description,
                project.manager,
                project.client,
                project.created_at,
                project.status,
                project.dept1_name,
                project.dept2_name,
                project.dept3_name,
                project.dept4_name,
            ],
        )?;
        let project_id = conn.last_insert_rowid();
        let _ = self.storage.save_project_dual(&conn, &project, project_id);

        Ok(project_id)
    }

    pub fn get_status_logs(&self, project_id: i64) -> Result<Vec<StatusLog>> {
        let conn = self.storage.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, department, text_content, image_path, timestamp, status, tag, title, manager, start_date, due_date 
             FROM status_logs WHERE project_id = ? ORDER BY timestamp ASC"
        )?;
        
        let log_iter = stmt.query_map(params![project_id], |row| {
            Ok(StatusLog {
                id: Some(row.get(0)?),
                project_id: row.get(1)?,
                department: row.get(2)?,
                text_content: row.get(3)?,
                image_path: row.get(4)?,
                timestamp: row.get(5)?,
                status: row.get(6)?,
                tag: row.get(7)?,
                title: row.get(8)?,
                manager: row.get(9)?,
                start_date: row.get(10)?,
                due_date: row.get(11)?,
            })
        })?;

        let mut logs = Vec::new();
        for log in log_iter {
            logs.push(log?);
        }
        Ok(logs)
    }

    pub fn add_status_log(&self, mut log: StatusLog) -> Result<i64> {
        let now = Utc::now().to_rfc3339();
        log.timestamp = now;

        let conn = self.storage.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO status_logs (project_id, department, text_content, image_path, timestamp, status, tag, title, manager, start_date, due_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                log.project_id,
                log.department,
                log.text_content,
                log.image_path,
                log.timestamp,
                log.status,
                log.tag,
                log.title,
                log.manager,
                log.start_date,
                log.due_date,
            ],
        )?;
        let log_id = conn.last_insert_rowid();
        let _ = self.storage.save_status_log_dual(&conn, &log, log_id);

        Ok(log_id)
    }

    pub fn get_milestones(&self, project_id: i64) -> Result<Vec<Milestone>> {
        let conn = self.storage.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, slot_number, name, deadline, content, is_saved, is_done 
             FROM milestones WHERE project_id = ? ORDER BY slot_number ASC"
        )?;
        
        let milestone_iter = stmt.query_map(params![project_id], |row| {
            Ok(Milestone {
                id: Some(row.get(0)?),
                project_id: row.get(1)?,
                slot_number: row.get(2)?,
                name: row.get(3)?,
                deadline: row.get(4)?,
                content: row.get(5)?,
                is_saved: row.get(6)?,
                is_done: row.get(7)?,
            })
        })?;

        let mut milestones = Vec::new();
        for ms in milestone_iter {
            milestones.push(ms?);
        }
        Ok(milestones)
    }

    pub fn save_milestone(&self, milestone: Milestone) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO milestones (id, project_id, slot_number, name, deadline, content, is_saved, is_done)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                milestone.id,
                milestone.project_id,
                milestone.slot_number,
                milestone.name,
                milestone.deadline,
                milestone.content,
                milestone.is_saved,
                milestone.is_done,
            ],
        )?;
        Ok(())
    }
}

// --- PM Plugin Commands ---

#[tauri::command]
pub async fn get_project_count(api: tauri::State<'_, crate::api::Api>, owner_id: i64) -> Result<usize, String> {
    api.pm().get_active_projects(owner_id).map(|p| p.len()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_projects(api: tauri::State<'_, crate::api::Api>, owner_id: i64) -> Result<Vec<Project>, String> {
    api.pm().get_active_projects(owner_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_status_logs(api: tauri::State<'_, crate::api::Api>, project_id: i64) -> Result<Vec<StatusLog>, String> {
    api.pm().get_status_logs(project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_status_log(api: tauri::State<'_, crate::api::Api>, log: StatusLog) -> Result<i64, String> {
    api.pm().add_status_log(log).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_project(api: tauri::State<'_, crate::api::Api>, project: Project) -> Result<i64, String> {
    api.pm().add_project(project).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_milestones(api: tauri::State<'_, crate::api::Api>, project_id: i64) -> Result<Vec<Milestone>, String> {
    api.pm().get_milestones(project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_milestone(api: tauri::State<'_, crate::api::Api>, milestone: Milestone) -> Result<(), String> {
    api.pm().save_milestone(milestone).map_err(|e| e.to_string())
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("pm")
        .invoke_handler(tauri::generate_handler![
            get_project_count,
            get_projects,
            get_status_logs,
            add_status_log,
            add_project,
            get_milestones,
            save_milestone
        ])
        .build()
}
