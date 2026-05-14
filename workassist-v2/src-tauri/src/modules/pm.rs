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
             FROM projects WHERE owner_id = ? AND status = 'active' ORDER BY created_at DESC"
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

        Ok(conn.last_insert_rowid())
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
}
