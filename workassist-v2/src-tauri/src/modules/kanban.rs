use crate::models::Task;
use crate::storage::Storage;
use rusqlite::{params, Result};
use chrono::Utc;

use std::sync::Arc;

pub struct KanbanModule {
    storage: Arc<Storage>,
}

impl KanbanModule {
    pub fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub fn get_all_tasks(&self, owner_id: i64) -> Result<Vec<Task>> {
        let conn = self.storage.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, owner_id, title, content, manager, start_date, due_date, status, is_urgent, created_at, review_comment, task_tag, is_deleted 
             FROM tasks WHERE (owner_id = ? OR owner_id = 999) AND is_deleted = 0"
        )?;
        
        let task_iter = stmt.query_map(params![owner_id], |row| {
            Ok(Task {
                id: Some(row.get(0)?),
                owner_id: Some(row.get(1)?),
                title: row.get(2)?,
                content: row.get(3)?,
                manager: row.get(4)?,
                start_date: row.get(5)?,
                due_date: row.get(6)?,
                status: row.get(7)?,
                is_urgent: row.get(8)?,
                created_at: row.get(9)?,
                review_comment: row.get(10)?,
                task_tag: row.get(11)?,
                is_deleted: row.get(12)?,
            })
        })?;

        let mut tasks = Vec::new();
        for task_res in task_iter {
            tasks.push(task_res?);
        }
        Ok(tasks)
    }

    pub fn add_task(&self, mut task: Task) -> Result<i64, String> {
        let now_local = Utc::now().with_timezone(&chrono::Local);
        let date_str = now_local.format("%Y%m%d").to_string();
        let time_str = now_local.format("%H%M").to_string();
        
        let conn = self.storage.conn.lock().unwrap();

        // 1. Rate limiting: Check tasks created in the last 60 seconds
        let one_minute_ago = (Utc::now() - chrono::Duration::seconds(60)).to_rfc3339();
        let count_last_min: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tasks WHERE created_at > ?",
            params![one_minute_ago],
            |row| row.get(0)
        ).map_err(|e| e.to_string())?;

        if count_last_min >= 55 {
            return Err("Task creation limit exceeded (max 55 per minute). Please wait.".to_string());
        }

        // 2. Sequence number for current minute
        // We look for tasks created in the same minute to determine the sequence suffix
        // We'll search by created_at prefix (YYYY-MM-DDTHH:MM)
        let minute_prefix = now_local.format("%Y-%m-%dT%H:%M").to_string();
        let count_this_min: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tasks WHERE created_at LIKE ?",
            params![format!("{}%", minute_prefix)],
            |row| row.get(0)
        ).map_err(|e| e.to_string())?;

        let sequence = count_this_min + 1;
        let tag = format!("T{}-{}-{:02}", date_str, time_str, sequence);
        task.task_tag = Some(tag);
        task.created_at = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO tasks (owner_id, title, content, manager, start_date, due_date, status, is_urgent, created_at, review_comment, task_tag, is_deleted)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
            params![
                task.owner_id,
                task.title,
                task.content,
                task.manager,
                task.start_date,
                task.due_date,
                task.status,
                task.is_urgent,
                task.created_at,
                task.review_comment,
                task.task_tag,
            ],
        ).map_err(|e| e.to_string())?;

        let task_id = conn.last_insert_rowid();
        let _ = self.storage.save_task_dual(&conn, &task, task_id);

        Ok(task_id)
    }

    pub fn update_status(&self, task_id: i64, new_status: &str) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute(
            "UPDATE tasks SET status = ? WHERE id = ?",
            params![new_status, task_id],
        )?;
        Ok(())
    }

    pub fn update_task(&self, task: Task) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute(
            "UPDATE tasks SET 
                title = ?, 
                content = ?, 
                manager = ?, 
                start_date = ?, 
                due_date = ?, 
                status = ?, 
                is_urgent = ?, 
                review_comment = ?, 
                task_tag = ?,
                is_deleted = ?
             WHERE id = ?",
            params![
                task.title,
                task.content,
                task.manager,
                task.start_date,
                task.due_date,
                task.status,
                task.is_urgent,
                task.review_comment,
                task.task_tag,
                task.is_deleted,
                task.id,
            ],
        )?;

        let _ = self.storage.save_task_dual(&conn, &task, task.id.unwrap_or(0));

        Ok(())
    }

    pub fn delete_task(&self, task_id: i64) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute("UPDATE tasks SET is_deleted = 1 WHERE id = ?", params![task_id])?;
        Ok(())
    }

    pub fn get_deleted_tasks(&self, owner_id: i64) -> Result<Vec<Task>> {
        let conn = self.storage.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, owner_id, title, content, manager, start_date, due_date, status, is_urgent, created_at, review_comment, task_tag, is_deleted 
             FROM tasks WHERE (owner_id = ? OR owner_id = 999) AND is_deleted = 1 ORDER BY created_at DESC"
        )?;
        
        let task_iter = stmt.query_map(params![owner_id], |row| {
            Ok(Task {
                id: Some(row.get(0)?),
                owner_id: Some(row.get(1)?),
                title: row.get(2)?,
                content: row.get(3)?,
                manager: row.get(4)?,
                start_date: row.get(5)?,
                due_date: row.get(6)?,
                status: row.get(7)?,
                is_urgent: row.get(8)?,
                created_at: row.get(9)?,
                review_comment: row.get(10)?,
                task_tag: row.get(11)?,
                is_deleted: row.get(12)?,
            })
        })?;
        
        task_iter.collect()
    }
    pub fn restore_task(&self, task_id: i64) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute("UPDATE tasks SET is_deleted = 0 WHERE id = ?", params![task_id])?;
        Ok(())
    }

    pub fn hard_delete_task(&self, task_id: i64) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute("DELETE FROM tasks WHERE id = ?", params![task_id])?;
        Ok(())
    }
}

// --- Kanban Plugin Commands ---

#[tauri::command]
pub async fn get_task_count(api: tauri::State<'_, crate::api::Api>, owner_id: i64) -> Result<usize, String> {
    api.kanban().get_all_tasks(owner_id).map(|t| t.len()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tasks(api: tauri::State<'_, crate::api::Api>, owner_id: i64) -> Result<Vec<Task>, String> {
    api.kanban().get_all_tasks(owner_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_task(api: tauri::State<'_, crate::api::Api>, task: Task) -> Result<i64, String> {
    api.kanban().add_task(task)
}

#[tauri::command]
pub async fn update_task_status(api: tauri::State<'_, crate::api::Api>, task_id: i64, new_status: String) -> Result<(), String> {
    api.kanban().update_status(task_id, &new_status).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_task(api: tauri::State<'_, crate::api::Api>, task: Task) -> Result<(), String> {
    api.kanban().update_task(task).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_task(api: tauri::State<'_, crate::api::Api>, task_id: i64) -> Result<(), String> {
    api.kanban().delete_task(task_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_deleted_tasks(api: tauri::State<'_, crate::api::Api>, owner_id: i64) -> Result<Vec<Task>, String> {
    api.kanban().get_deleted_tasks(owner_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_task(api: tauri::State<'_, crate::api::Api>, task_id: i64) -> Result<(), String> {
    api.kanban().restore_task(task_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hard_delete_task_cmd(api: tauri::State<'_, crate::api::Api>, task_id: i64) -> Result<(), String> {
    api.kanban().hard_delete_task(task_id).map_err(|e| e.to_string())
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("kanban")
        .invoke_handler(tauri::generate_handler![
            get_task_count,
            get_tasks,
            add_task,
            update_task_status,
            update_task,
            delete_task,
            get_deleted_tasks,
            restore_task,
            hard_delete_task_cmd
        ])
        .build()
}
