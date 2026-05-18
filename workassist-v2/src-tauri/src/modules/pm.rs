use crate::models::{Project, StatusLog, Milestone};
use crate::storage::Storage;
use rusqlite::{params, Result};
use chrono::Utc;
use serde::{Serialize, Deserialize};

use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectExportData {
    pub project: Project,
    pub milestones: Vec<Milestone>,
    pub status_logs: Vec<StatusLog>,
}

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
            "SELECT id, owner_id, name, description, manager, client, start_date, created_at, status, dept1_name, dept2_name, dept3_name, dept4_name, project_tag, is_deleted, completion_date, completion_memo 
             FROM projects WHERE (owner_id = ? OR owner_id = 999) AND status = 'active' AND is_deleted = 0 ORDER BY created_at DESC"
        )?;
        
        let project_iter = stmt.query_map(params![owner_id], |row| {
            Ok(Project {
                id: Some(row.get(0)?),
                owner_id: Some(row.get(1)?),
                name: row.get(2)?,
                description: row.get(3)?,
                manager: row.get(4)?,
                client: row.get(5)?,
                start_date: row.get(6)?,
                created_at: row.get(7)?,
                status: row.get(8)?,
                dept1_name: row.get(9)?,
                dept2_name: row.get(10)?,
                dept3_name: row.get(11)?,
                dept4_name: row.get(12)?,
                project_tag: row.get(13)?,
                is_deleted: row.get(14)?,
                completion_date: row.get(15)?,
                completion_memo: row.get(16)?,
            })
        })?;

        let mut projects = Vec::new();
        for project in project_iter {
            projects.push(project?);
        }
        Ok(projects)
    }

    pub fn add_project(&self, mut project: Project) -> Result<i64> {
        let now = Utc::now();
        let now_rfc = now.to_rfc3339();
        let now_local = now.with_timezone(&chrono::Local);
        let conn = self.storage.conn.lock().unwrap();

        if let Some(id) = project.id {
            // Fetch old department names before updating the project
            let mut stmt = conn.prepare("SELECT dept1_name, dept2_name, dept3_name, dept4_name FROM projects WHERE id = ?")?;
            let old_depts: Option<(String, String, String, String)> = stmt.query_row(params![id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            }).ok();

            conn.execute(
                "UPDATE projects SET name = ?, description = ?, manager = ?, client = ?, start_date = ?, dept1_name = ?, dept2_name = ?, dept3_name = ?, dept4_name = ?, project_tag = ?, is_deleted = ?, completion_date = ?, completion_memo = ? WHERE id = ?",
                params![
                    project.name,
                    project.description,
                    project.manager,
                    project.client,
                    project.start_date,
                    project.dept1_name,
                    project.dept2_name,
                    project.dept3_name,
                    project.dept4_name,
                    project.project_tag,
                    project.is_deleted,
                    project.completion_date,
                    project.completion_memo,
                    id
                ],
            )?;

            // Cascade update status logs if department names were modified
            if let Some((o1, o2, o3, o4)) = old_depts {
                if o1 != project.dept1_name {
                    conn.execute("UPDATE status_logs SET department = ? WHERE project_id = ? AND department = ?", params![project.dept1_name, id, o1])?;
                }
                if o2 != project.dept2_name {
                    conn.execute("UPDATE status_logs SET department = ? WHERE project_id = ? AND department = ?", params![project.dept2_name, id, o2])?;
                }
                if o3 != project.dept3_name {
                    conn.execute("UPDATE status_logs SET department = ? WHERE project_id = ? AND department = ?", params![project.dept3_name, id, o3])?;
                }
                if o4 != project.dept4_name {
                    conn.execute("UPDATE status_logs SET department = ? WHERE project_id = ? AND department = ?", params![project.dept4_name, id, o4])?;
                }
            }

            let _ = self.storage.save_project_dual(&conn, &project, id);
            Ok(id)
        } else {
            project.created_at = now_rfc;

            // Generate Tag: PYYMMDD-HHMM-## (SSOT)
            project.project_tag = Some(crate::storage::Storage::generate_sequential_tag(&conn, "projects", "P", &now_local));

            conn.execute(
                "INSERT INTO projects (owner_id, name, description, manager, client, start_date, created_at, status, dept1_name, dept2_name, dept3_name, dept4_name, project_tag, is_deleted, completion_date, completion_memo)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    project.owner_id,
                    project.name,
                    project.description,
                    project.manager,
                    project.client,
                    project.start_date,
                    project.created_at,
                    project.status,
                    project.dept1_name,
                    project.dept2_name,
                    project.dept3_name,
                    project.dept4_name,
                    project.project_tag,
                    project.is_deleted,
                    project.completion_date,
                    project.completion_memo,
                ],
            )?;
            let project_id = conn.last_insert_rowid();
            let _ = self.storage.save_project_dual(&conn, &project, project_id);
            Ok(project_id)
        }
    }

    pub fn get_status_logs(&self, project_id: i64) -> Result<Vec<StatusLog>> {
        let conn = self.storage.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, department, text_content, timestamp, status, tag, title, manager, start_date, due_date, is_deleted 
             FROM status_logs WHERE project_id = ? ORDER BY timestamp ASC"
        )?;
        
        let log_iter = stmt.query_map(params![project_id], |row| {
            Ok(StatusLog {
                id: Some(row.get(0)?),
                project_id: row.get(1)?,
                department: row.get(2)?,
                text_content: row.get(3)?,
                timestamp: row.get(4)?,
                status: row.get(5)?,
                tag: row.get(6)?,
                title: row.get(7)?,
                manager: row.get(8)?,
                start_date: row.get(9)?,
                due_date: row.get(10)?,
                is_deleted: row.get(11)?,
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

        // Generate sequential tag L{date_str}-{time_str}-{sequence:02} if tag is empty or None
        if log.tag.as_ref().map_or(true, |t| t.is_empty()) {
            let now_local = chrono::Local::now();
            log.tag = Some(crate::storage::Storage::generate_sequential_tag(&conn, "status_logs", "L", &now_local));
        }

        conn.execute(
            "INSERT INTO status_logs (project_id, department, text_content, timestamp, status, tag, title, manager, start_date, due_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                log.project_id,
                log.department,
                log.text_content,
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

    pub fn update_status_log(&self, log: StatusLog) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        if let Some(id) = log.id {
            conn.execute(
                "UPDATE status_logs SET title = ?, text_content = ?, manager = ?, start_date = ?, due_date = ? WHERE id = ?",
                params![
                    log.title,
                    log.text_content,
                    log.manager,
                    log.start_date,
                    log.due_date,
                    id
                ],
            )?;
            let _ = self.storage.save_status_log_dual(&conn, &log, id);
        }
        Ok(())
    }

    pub fn delete_status_log_permanent(&self, log_id: i64) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        self.storage.delete_status_log_dual(&conn, log_id)?;
        Ok(())
    }

    pub fn update_status_log_status(&self, log_id: i64, status: String) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute("UPDATE status_logs SET status = ? WHERE id = ?", params![status, log_id])?;
        Ok(())
    }

    pub fn update_status_log_deleted(&self, log_id: i64, is_deleted: bool) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute("UPDATE status_logs SET is_deleted = ? WHERE id = ?", params![is_deleted, log_id])?;
        Ok(())
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

    pub fn delete_project(&self, project_id: i64) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute("UPDATE projects SET is_deleted = 1 WHERE id = ?", params![project_id])?;
        Ok(())
    }

    pub fn get_deleted_projects(&self, owner_id: i64) -> Result<Vec<Project>> {
        let conn = self.storage.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, owner_id, name, description, manager, client, start_date, created_at, status, dept1_name, dept2_name, dept3_name, dept4_name, project_tag, is_deleted, completion_date, completion_memo 
             FROM projects WHERE (owner_id = ? OR owner_id = 999) AND is_deleted = 1 ORDER BY created_at DESC"
        )?;
        
        let project_iter = stmt.query_map(params![owner_id], |row| {
            Ok(Project {
                id: Some(row.get(0)?),
                owner_id: Some(row.get(1)?),
                name: row.get(2)?,
                description: row.get(3)?,
                manager: row.get(4)?,
                client: row.get(5)?,
                start_date: row.get(6)?,
                created_at: row.get(7)?,
                status: row.get(8)?,
                dept1_name: row.get(9)?,
                dept2_name: row.get(10)?,
                dept3_name: row.get(11)?,
                dept4_name: row.get(12)?,
                project_tag: row.get(13)?,
                is_deleted: row.get(14)?,
                completion_date: row.get(15)?,
                completion_memo: row.get(16)?,
            })
        })?;

        let mut projects = Vec::new();
        for project in project_iter {
            projects.push(project?);
        }
        Ok(projects)
    }

    pub fn restore_project(&self, project_id: i64) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute("UPDATE projects SET is_deleted = 0 WHERE id = ?", params![project_id])?;
        Ok(())
    }

    pub fn hard_delete_project(&self, project_id: i64) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        self.storage.delete_project_dual(&conn, project_id)?;
        Ok(())
    }

    pub fn complete_project(&self, project_id: i64, completion_date: String, completion_memo: String) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        // 1. Update Raw DB
        conn.execute(
            "UPDATE projects SET status = 'done', completion_date = ?, completion_memo = ? WHERE id = ?",
            params![completion_date, completion_memo, project_id]
        )?;

        // 2. Update Shadow DB (De-identified)
        let s_comp_memo = crate::storage::security::SecurityEngine::tokenize(&conn, &completion_memo);
        conn.execute(
            "UPDATE shadow_projects SET status = 'done', completion_date = ?, completion_memo = ? WHERE id = ?",
            params![completion_date, s_comp_memo, project_id]
        )?;

        Ok(())
    }

    pub fn get_completed_projects(&self, owner_id: i64) -> Result<Vec<Project>> {
        let conn = self.storage.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, owner_id, name, description, manager, client, start_date, created_at, status, dept1_name, dept2_name, dept3_name, dept4_name, project_tag, is_deleted, completion_date, completion_memo 
             FROM projects WHERE (owner_id = ? OR owner_id = 999) AND status = 'done' AND is_deleted = 0 ORDER BY completion_date DESC"
        )?;
        
        let project_iter = stmt.query_map(params![owner_id], |row| {
            Ok(Project {
                id: Some(row.get(0)?),
                owner_id: Some(row.get(1)?),
                name: row.get(2)?,
                description: row.get(3)?,
                manager: row.get(4)?,
                client: row.get(5)?,
                start_date: row.get(6)?,
                created_at: row.get(7)?,
                status: row.get(8)?,
                dept1_name: row.get(9)?,
                dept2_name: row.get(10)?,
                dept3_name: row.get(11)?,
                dept4_name: row.get(12)?,
                project_tag: row.get(13)?,
                is_deleted: row.get(14)?,
                completion_date: row.get(15)?,
                completion_memo: row.get(16)?,
            })
        })?;

        let mut projects = Vec::new();
        for project in project_iter {
            projects.push(project?);
        }
        Ok(projects)
    }

    pub fn reactivate_project(&self, project_id: i64) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        // 1. Update Raw DB
        conn.execute(
            "UPDATE projects SET status = 'active', completion_date = NULL, completion_memo = NULL WHERE id = ?",
            params![project_id]
        )?;

        // 2. Update Shadow DB
        conn.execute(
            "UPDATE shadow_projects SET status = 'active', completion_date = NULL, completion_memo = NULL WHERE id = ?",
            params![project_id]
        )?;

        Ok(())
    }

    pub fn export_project_db(&self, project_id: i64, file_path: String) -> Result<(), String> {
        let conn = self.storage.conn.lock().unwrap();
        
        // 1. Fetch project
        let mut stmt = conn.prepare(
            "SELECT id, owner_id, name, description, manager, client, start_date, created_at, status, dept1_name, dept2_name, dept3_name, dept4_name, project_tag, is_deleted, completion_date, completion_memo 
             FROM projects WHERE id = ?"
        ).map_err(|e| e.to_string())?;
        
        let project = stmt.query_row(params![project_id], |row| {
            Ok(Project {
                id: Some(row.get(0)?),
                owner_id: Some(row.get(1)?),
                name: row.get(2)?,
                description: row.get(3)?,
                manager: row.get(4)?,
                client: row.get(5)?,
                start_date: row.get(6)?,
                created_at: row.get(7)?,
                status: row.get(8)?,
                dept1_name: row.get(9)?,
                dept2_name: row.get(10)?,
                dept3_name: row.get(11)?,
                dept4_name: row.get(12)?,
                project_tag: row.get(13)?,
                is_deleted: row.get(14)?,
                completion_date: row.get(15)?,
                completion_memo: row.get(16)?,
            })
        }).map_err(|e| format!("Project not found: {}", e))?;
        
        // 2. Fetch milestones
        let mut stmt = conn.prepare(
            "SELECT id, project_id, slot_number, name, deadline, content, is_saved, is_done 
             FROM milestones WHERE project_id = ?"
        ).map_err(|e| e.to_string())?;
        
        let milestones: Vec<Milestone> = stmt.query_map(params![project_id], |row| {
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
        }).map_err(|e| e.to_string())?
        .filter_map(|m| m.ok())
        .collect();
        
        // 3. Fetch status logs
        let mut stmt = conn.prepare(
            "SELECT id, project_id, department, text_content, timestamp, status, tag, title, manager, start_date, due_date, is_deleted 
             FROM status_logs WHERE project_id = ?"
        ).map_err(|e| e.to_string())?;
        
        let status_logs: Vec<StatusLog> = stmt.query_map(params![project_id], |row| {
            Ok(StatusLog {
                id: Some(row.get(0)?),
                project_id: row.get(1)?,
                department: row.get(2)?,
                text_content: row.get(3)?,
                timestamp: row.get(4)?,
                status: row.get(5)?,
                tag: row.get(6)?,
                title: row.get(7)?,
                manager: row.get(8)?,
                start_date: row.get(9)?,
                due_date: row.get(10)?,
                is_deleted: row.get(11)?,
            })
        }).map_err(|e| e.to_string())?
        .filter_map(|l| l.ok())
        .collect();
        
        // Serialize
        let export_data = ProjectExportData {
            project,
            milestones,
            status_logs,
        };
        
        let json_str = serde_json::to_string_pretty(&export_data)
            .map_err(|e| format!("Failed to serialize data: {}", e))?;
            
        std::fs::write(&file_path, json_str)
            .map_err(|e| format!("Failed to write file: {}", e))?;
            
        Ok(())
    }

    pub fn import_project_db(&self, owner_id: i64, file_path: String) -> Result<(), String> {
        let json_str = std::fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read file: {}", e))?;
            
        let export_data: ProjectExportData = serde_json::from_str(&json_str)
            .map_err(|e| format!("Failed to parse project DB file: {}", e))?;
            
        let conn = self.storage.conn.lock().unwrap();
        
        // 1. Insert Project with a brand new ID
        let now = Utc::now();
        let now_rfc = now.to_rfc3339();
        let now_local = now.with_timezone(&chrono::Local);
        
        // Generate sequential tag
        let project_tag = crate::storage::Storage::generate_sequential_tag(&conn, "projects", "P", &now_local);
        
        let mut imported_proj = export_data.project;
        imported_proj.owner_id = Some(owner_id);
        imported_proj.created_at = now_rfc.clone();
        imported_proj.project_tag = Some(project_tag);
        imported_proj.status = "active".to_string(); // Keep imported projects active initially
        imported_proj.is_deleted = false;
        
        conn.execute(
            "INSERT INTO projects (owner_id, name, description, manager, client, start_date, created_at, status, dept1_name, dept2_name, dept3_name, dept4_name, project_tag, is_deleted, completion_date, completion_memo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                imported_proj.owner_id,
                imported_proj.name,
                imported_proj.description,
                imported_proj.manager,
                imported_proj.client,
                imported_proj.start_date,
                imported_proj.created_at,
                imported_proj.status,
                imported_proj.dept1_name,
                imported_proj.dept2_name,
                imported_proj.dept3_name,
                imported_proj.dept4_name,
                imported_proj.project_tag,
                imported_proj.is_deleted,
                imported_proj.completion_date,
                imported_proj.completion_memo,
            ],
        ).map_err(|e| format!("Failed to insert project: {}", e))?;
        
        let new_project_id = conn.last_insert_rowid();
        imported_proj.id = Some(new_project_id);
        
        // Sync shadow project
        let _ = self.storage.save_project_dual(&conn, &imported_proj, new_project_id);
        
        // 2. Insert milestones
        for milestone in export_data.milestones {
            let mut ms = milestone;
            ms.id = None; // Generate new ID
            ms.project_id = new_project_id;
            
            conn.execute(
                "INSERT INTO milestones (project_id, slot_number, name, deadline, content, is_saved, is_done)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
                params![
                    ms.project_id,
                    ms.slot_number,
                    ms.name,
                    ms.deadline,
                    ms.content,
                    ms.is_saved,
                    ms.is_done,
                ],
            ).map_err(|e| format!("Failed to insert milestone: {}", e))?;
        }
        
        // 3. Insert status logs
        for log in export_data.status_logs {
            let mut l = log;
            l.id = None;
            l.project_id = new_project_id;
            
            let log_tag = crate::storage::Storage::generate_sequential_tag(&conn, "status_logs", "L", &now_local);
            l.tag = Some(log_tag);
            l.is_deleted = false;
            
            conn.execute(
                "INSERT INTO status_logs (project_id, department, text_content, timestamp, status, tag, title, manager, start_date, due_date, owner_id, is_deleted)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    l.project_id,
                    l.department,
                    l.text_content,
                    l.timestamp,
                    l.status,
                    l.tag,
                    l.title,
                    l.manager,
                    l.start_date,
                    l.due_date,
                    Some(owner_id),
                    l.is_deleted,
                ],
            ).map_err(|e| format!("Failed to insert status log: {}", e))?;
            
            let new_log_id = conn.last_insert_rowid();
            l.id = Some(new_log_id);
            
            // Sync shadow log
            let _ = self.storage.save_status_log_dual(&conn, &l, new_log_id);
        }
        
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
pub async fn update_status_log(api: tauri::State<'_, crate::api::Api>, log: StatusLog) -> Result<(), String> {
    api.pm().update_status_log(log).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_status_log_permanent(api: tauri::State<'_, crate::api::Api>, log_id: i64) -> Result<(), String> {
    api.pm().delete_status_log_permanent(log_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_status_log_status(api: tauri::State<'_, crate::api::Api>, log_id: i64, status: String) -> Result<(), String> {
    api.pm().update_status_log_status(log_id, status).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_status_log_deleted(api: tauri::State<'_, crate::api::Api>, log_id: i64, is_deleted: bool) -> Result<(), String> {
    api.pm().update_status_log_deleted(log_id, is_deleted).map_err(|e| e.to_string())
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

#[tauri::command]
pub async fn delete_project(api: tauri::State<'_, crate::api::Api>, project_id: i64) -> Result<(), String> {
    api.pm().delete_project(project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_deleted_projects(api: tauri::State<'_, crate::api::Api>, owner_id: i64) -> Result<Vec<Project>, String> {
    api.pm().get_deleted_projects(owner_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_project(api: tauri::State<'_, crate::api::Api>, project_id: i64) -> Result<(), String> {
    api.pm().restore_project(project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hard_delete_project_cmd(api: tauri::State<'_, crate::api::Api>, project_id: i64) -> Result<(), String> {
    api.pm().hard_delete_project(project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn complete_project(api: tauri::State<'_, crate::api::Api>, project_id: i64, completion_date: String, completion_memo: String) -> Result<(), String> {
    api.pm().complete_project(project_id, completion_date, completion_memo).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_completed_projects(api: tauri::State<'_, crate::api::Api>, owner_id: i64) -> Result<Vec<Project>, String> {
    api.pm().get_completed_projects(owner_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reactivate_project(api: tauri::State<'_, crate::api::Api>, project_id: i64) -> Result<(), String> {
    api.pm().reactivate_project(project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_project_db(api: tauri::State<'_, crate::api::Api>, project_id: i64, file_path: String) -> Result<(), String> {
    api.pm().export_project_db(project_id, file_path)
}

#[tauri::command]
pub async fn import_project_db(api: tauri::State<'_, crate::api::Api>, owner_id: i64, file_path: String) -> Result<(), String> {
    api.pm().import_project_db(owner_id, file_path)
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("pm")
        .invoke_handler(tauri::generate_handler![
            get_project_count,
            get_projects,
            get_status_logs,
            add_status_log,
            update_status_log,
            delete_status_log_permanent,
            update_status_log_status,
            update_status_log_deleted,
            add_project,
            get_milestones,
            save_milestone,
            delete_project,
            get_deleted_projects,
            restore_project,
            hard_delete_project_cmd,
            complete_project,
            get_completed_projects,
            reactivate_project,
            export_project_db,
            import_project_db
        ])
        .build()
}
