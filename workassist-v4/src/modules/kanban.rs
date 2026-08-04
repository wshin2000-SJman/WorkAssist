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

        // 2. Sequence number for current minute (SSOT)
        task.task_tag = Some(crate::storage::Storage::generate_sequential_tag(&conn, "tasks", "T", &now_local));
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
