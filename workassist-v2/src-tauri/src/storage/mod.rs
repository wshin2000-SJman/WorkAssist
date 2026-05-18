pub mod schema;
pub mod security;
use rusqlite::{Connection, Result, params};
use std::path::PathBuf;
use std::sync::Mutex;
use crate::models::{Task, Meeting, Project, StatusLog};
use crate::storage::security::SecurityEngine;

pub struct Storage {
    pub conn: Mutex<Connection>,
    pub path: PathBuf,
}

impl Storage {
    pub fn new(path: PathBuf) -> Result<Self> {
        let conn = Connection::open(&path)?;
        
        // Use pragma_update instead of execute for journal_mode to avoid "ExecuteReturnedResults" error
        conn.pragma_update(None, "journal_mode", "WAL")?;
        
        let storage = Storage { 
            conn: Mutex::new(conn), 
            path 
        };
        storage.initialize_tables()?;
        
        Ok(storage)
    }

    pub fn initialize_tables(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        Self::ensure_schema(&conn)?;
        
        // Seed default user
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
        if count == 0 {
            conn.execute(
                "INSERT INTO users (username, password_hash, password_hint) VALUES (?, ?, ?)",
                ["admin", "admin", "admin"],
            )?;
        }
        Ok(())
    }

    pub fn get_default_path() -> PathBuf {
        let mut path = if cfg!(windows) {
            PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into()))
        } else {
            PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()))
        };
        
        path.push("SJ_WorkAssist");
        std::fs::create_dir_all(&path).ok();
        path.push("sjworkassist_v2.db");
        path
    }

    pub fn get_backup_dir(&self) -> PathBuf {
        let mut backup_dir = self.path.parent().unwrap().to_path_buf();
        backup_dir.push("backups");
        backup_dir
    }

    pub fn perform_backup(&self) -> Result<(), String> {
        let backup_dir = self.get_backup_dir();
        std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

        // Checkpoint before copy
        {
            let conn = self.conn.lock().unwrap();
            let _ = conn.pragma_update(None, "wal_checkpoint", "TRUNCATE");
        }

        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
        let backup_path = backup_dir.join(format!("sjworkassist_v2_backup_{}.db", timestamp));

        std::fs::copy(&self.path, &backup_path).map_err(|e| e.to_string())?;

        self.cleanup_backups(backup_dir).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn cleanup_backups(&self, backup_dir: PathBuf) -> std::io::Result<()> {
        let mut backups: Vec<_> = std::fs::read_dir(backup_dir)?
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains("backup_"))
            .collect();

        backups.sort_by_key(|a| a.metadata().and_then(|m| m.modified()).ok());

        if backups.len() > 3 {
            let delete_count = backups.len() - 3;
            for i in 0..delete_count {
                std::fs::remove_file(backups[i].path())?;
            }
        }
        Ok(())
    }

    pub fn manual_backup(&self, target_path: PathBuf) -> Result<(), String> {
        // Checkpoint before copy
        {
            let conn = self.conn.lock().unwrap();
            let _ = conn.pragma_update(None, "wal_checkpoint", "TRUNCATE");
        }
        std::fs::copy(&self.path, &target_path).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn import_database(&self, source_path: PathBuf, current_user: Option<crate::models::User>) -> Result<(), String> {

        // 1. Checkpoint and Close current connection
        {
            let mut conn = self.conn.lock().unwrap();
            let _ = conn.pragma_update(None, "wal_checkpoint", "TRUNCATE");
            *conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        }

        // 2. Overwrite the DB file
        std::fs::copy(&source_path, &self.path).map_err(|e| {
            format!("Failed to copy file: {}", e)
        })?;
        
        // 3. Remove WAL/SHM files
        let mut wal = self.path.clone();
        wal.set_extension("db-wal");
        let mut shm = self.path.clone();
        shm.set_extension("db-shm");
        let _ = std::fs::remove_file(wal);
        let _ = std::fs::remove_file(shm);

        // 4. Re-open, Migrate, and Remap
        {
            let mut conn = self.conn.lock().unwrap();
            let new_conn = Connection::open(&self.path).map_err(|e| e.to_string())?;
            new_conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
            
            // CRITICAL: Ensure the new DB has all required tables and columns BEFORE remapping
            Self::ensure_schema(&new_conn).map_err(|e| format!("Migration failed after import: {}", e))?;

            // If we have a current user, preserve/remap them
            if let Some(user) = current_user {

                // 1. Sync user record by username
                new_conn.execute(
                    "INSERT INTO users (username, password_hash, password_hint) 
                     VALUES (?, ?, ?) 
                     ON CONFLICT(username) DO UPDATE SET 
                        password_hash = excluded.password_hash,
                        password_hint = excluded.password_hint",
                    params![user.username, user.password_hash, user.password_hint],
                ).map_err(|e| format!("User sync failed: {}", e))?;

                let final_id: i64 = new_conn.query_row(
                    "SELECT id FROM users WHERE username = ?",
                    [user.username.clone()],
                    |row| row.get(0),
                ).map_err(|e| format!("Failed to retrieve final user ID: {}", e))?;

                // 3. Remap all data to this final ID and count changes
                let _t_count = new_conn.execute("UPDATE tasks SET owner_id = ?", [final_id]).map_err(|e| e.to_string())?;
                let _m_count = new_conn.execute("UPDATE meetings SET owner_id = ?", [final_id]).map_err(|e| e.to_string())?;
                let _p_count = new_conn.execute("UPDATE projects SET owner_id = ?", [final_id]).map_err(|e| e.to_string())?;
                let _s_count = new_conn.execute("UPDATE status_logs SET owner_id = ?", [final_id]).map_err(|e| e.to_string())?;

                
                // Also ensure shadow tables are correctly associated if needed 
                // (Note: Shadow tables currently match by ID, so if main IDs are kept, they're fine)
            }

            *conn = new_conn;
        }

        Ok(())
    }

    /// Internal helper to ensure schema is up to date on any connection
    fn ensure_schema(conn: &Connection) -> Result<()> {
        conn.execute(schema::CREATE_USERS_TABLE, [])?;
        conn.execute(schema::CREATE_MEETINGS_TABLE, [])?;
        conn.execute(schema::CREATE_TASKS_TABLE, [])?;
        conn.execute(schema::CREATE_PROJECTS_TABLE, [])?;
        conn.execute(schema::CREATE_MILESTONES_TABLE, [])?;
        conn.execute(schema::CREATE_STATUS_LOGS_TABLE, [])?;
        conn.execute(schema::CREATE_SECURE_VAULT_TABLE, [])?;
        conn.execute(schema::CREATE_SHADOW_TASKS_TABLE, [])?;
        conn.execute(schema::CREATE_SHADOW_MEETINGS_TABLE, [])?;
        conn.execute(schema::CREATE_SHADOW_PROJECTS_TABLE, [])?;
        conn.execute(schema::CREATE_SHADOW_STATUS_LOGS_TABLE, [])?;

        // Column Migrations
        let tasks_info: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(tasks)")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            rows.map(|r| r.unwrap()).collect()
        };
        if !tasks_info.contains(&"is_deleted".to_string()) {
            conn.execute("ALTER TABLE tasks ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT 0", [])?;
        }

        let shadow_tasks_info: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(shadow_tasks)")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            rows.map(|r| r.unwrap()).collect()
        };
        if !shadow_tasks_info.contains(&"task_tag".to_string()) {
            conn.execute("ALTER TABLE shadow_tasks ADD COLUMN task_tag TEXT", [])?;
        }
        
        let meetings_info: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(meetings)")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            rows.map(|r| r.unwrap()).collect()
        };
        if !meetings_info.contains(&"meeting_tag".to_string()) {
            conn.execute("ALTER TABLE meetings ADD COLUMN meeting_tag TEXT DEFAULT ''", [])?;
        }
        if !meetings_info.contains(&"is_deleted".to_string()) {
            conn.execute("ALTER TABLE meetings ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT 0", [])?;
        }

        let shadow_meetings_info: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(shadow_meetings)")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            rows.map(|r| r.unwrap()).collect()
        };
        if !shadow_meetings_info.contains(&"meeting_tag".to_string()) {
            conn.execute("ALTER TABLE shadow_meetings ADD COLUMN meeting_tag TEXT", [])?;
        }

        let logs_info: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(status_logs)")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            rows.map(|r| r.unwrap()).collect()
        };
        if !logs_info.contains(&"owner_id".to_string()) {
            conn.execute("ALTER TABLE status_logs ADD COLUMN owner_id INTEGER", [])?;
        }
        if !logs_info.contains(&"is_deleted".to_string()) {
            conn.execute("ALTER TABLE status_logs ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT 0", [])?;
        }

        let projects_info: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(projects)")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            rows.map(|r| r.unwrap()).collect()
        };
        if !projects_info.contains(&"project_tag".to_string()) {
            conn.execute("ALTER TABLE projects ADD COLUMN project_tag TEXT DEFAULT ''", [])?;
        }
        if !projects_info.contains(&"is_deleted".to_string()) {
            conn.execute("ALTER TABLE projects ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT 0", [])?;
        }
        if !projects_info.contains(&"start_date".to_string()) {
            conn.execute("ALTER TABLE projects ADD COLUMN start_date TEXT", [])?;
        }
        if !projects_info.contains(&"completion_date".to_string()) {
            conn.execute("ALTER TABLE projects ADD COLUMN completion_date TEXT", [])?;
        }
        if !projects_info.contains(&"completion_memo".to_string()) {
            conn.execute("ALTER TABLE projects ADD COLUMN completion_memo TEXT", [])?;
        }

        let shadow_projects_info: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(shadow_projects)")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            rows.map(|r| r.unwrap()).collect()
        };
        if !shadow_projects_info.contains(&"project_tag".to_string()) {
            conn.execute("ALTER TABLE shadow_projects ADD COLUMN project_tag TEXT", [])?;
        }
        if !shadow_projects_info.contains(&"status".to_string()) {
            conn.execute("ALTER TABLE shadow_projects ADD COLUMN status TEXT", [])?;
        }
        if !shadow_projects_info.contains(&"completion_date".to_string()) {
            conn.execute("ALTER TABLE shadow_projects ADD COLUMN completion_date TEXT", [])?;
        }
        if !shadow_projects_info.contains(&"completion_memo".to_string()) {
            conn.execute("ALTER TABLE shadow_projects ADD COLUMN completion_memo TEXT", [])?;
        }

        Ok(())
    }

    pub fn initialize_user_data(&self, owner_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM status_logs WHERE owner_id = ?", [owner_id])?;
        conn.execute("DELETE FROM milestones WHERE project_id IN (SELECT id FROM projects WHERE owner_id = ?)", [owner_id])?;
        conn.execute("DELETE FROM projects WHERE owner_id = ?", [owner_id])?;
        conn.execute("DELETE FROM tasks WHERE owner_id = ?", [owner_id])?;
        conn.execute("DELETE FROM meetings WHERE owner_id = ?", [owner_id])?;
        self.clear_shadow_tables(&conn)?;
        Ok(())
    }

    pub fn initialize_all_data(&self, current_user: Option<crate::models::User>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM status_logs", [])?;
        conn.execute("DELETE FROM milestones", [])?;
        conn.execute("DELETE FROM projects", [])?;
        conn.execute("DELETE FROM tasks", [])?;
        conn.execute("DELETE FROM meetings", [])?;
        self.clear_shadow_tables(&conn)?;

        // Preserve current user so they can still login after wipe
        if let Some(user) = current_user {
            conn.execute(
                "INSERT INTO users (username, password_hash, password_hint) 
                 VALUES (?, ?, ?) 
                 ON CONFLICT(username) DO UPDATE SET 
                    password_hash = excluded.password_hash,
                    password_hint = excluded.password_hint",
                params![user.username, user.password_hash, user.password_hint],
            )?;
        }

        Ok(())
    }

    fn clear_shadow_tables(&self, conn: &rusqlite::Connection) -> Result<()> {
        conn.execute("DELETE FROM shadow_tasks", [])?;
        conn.execute("DELETE FROM shadow_meetings", [])?;
        conn.execute("DELETE FROM shadow_projects", [])?;
        conn.execute("DELETE FROM shadow_status_logs", [])?;
        conn.execute("DELETE FROM secure_vault", [])?;
        Ok(())
    }

    // --- Dual-Write Methods ---

    pub fn generate_sequential_tag(
        conn: &rusqlite::Connection, 
        table_name: &str, 
        prefix: &str, 
        timestamp: &chrono::DateTime<chrono::Local>
    ) -> String {
        let date_str = timestamp.format("%y%m%d").to_string();
        let time_str = timestamp.format("%H%M").to_string();
        let minute_prefix = timestamp.format("%Y-%m-%dT%H:%M").to_string();
        
        let query = format!("SELECT COUNT(*) FROM {} WHERE created_at LIKE ?", table_name);
        let count: i64 = conn.query_row(
            &query,
            params![format!("{}%", minute_prefix)],
            |row| row.get(0)
        ).unwrap_or(0);
        
        format!("{}{}-{}-{:02}", prefix, date_str, time_str, count + 1)
    }


    pub fn save_task_dual(&self, conn: &rusqlite::Connection, task: &Task, task_id: i64) -> Result<()> {
        // 1. Tokenize content
        let shadow_title = SecurityEngine::tokenize(conn, &task.title);
        let shadow_content = SecurityEngine::tokenize(conn, task.content.as_deref().unwrap_or(""));
        let shadow_comment = SecurityEngine::tokenize(conn, task.review_comment.as_deref().unwrap_or(""));

        // 2. Write to shadow table
        conn.execute(
            "INSERT OR REPLACE INTO shadow_tasks (id, title, content, review_comment, task_tag) VALUES (?, ?, ?, ?, ?)",
            params![task_id, shadow_title, shadow_content, shadow_comment, task.task_tag],
        )?;

        Ok(())
    }

    pub fn save_meeting_dual(&self, conn: &rusqlite::Connection, meeting: &Meeting, meeting_id: i64) -> Result<()> {
        // 1. Tokenize fields
        let s_title = SecurityEngine::tokenize(conn, &meeting.title);
        let s_participants = SecurityEngine::tokenize(conn, meeting.participants.as_deref().unwrap_or(""));
        let s_location = SecurityEngine::tokenize(conn, meeting.location.as_deref().unwrap_or(""));
        let s_decisions = SecurityEngine::tokenize(conn, meeting.decisions.as_deref().unwrap_or(""));
        let s_action = SecurityEngine::tokenize(conn, meeting.action_items.as_deref().unwrap_or(""));
        let s_memo = SecurityEngine::tokenize(conn, meeting.memo.as_deref().unwrap_or(""));

        // 2. Write to shadow
        conn.execute(
            "INSERT OR REPLACE INTO shadow_meetings (id, title, participants, location, decisions, action_items, memo, meeting_tag) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![meeting_id, s_title, s_participants, s_location, s_decisions, s_action, s_memo, meeting.meeting_tag],
        )?;

        Ok(())
    }

    pub fn save_project_dual(&self, conn: &rusqlite::Connection, project: &Project, project_id: i64) -> Result<()> {
        let s_name = SecurityEngine::tokenize(conn, &project.name);
        let s_desc = SecurityEngine::tokenize(conn, project.description.as_deref().unwrap_or(""));
        let s_comp_memo = SecurityEngine::tokenize(conn, project.completion_memo.as_deref().unwrap_or(""));

        conn.execute(
            "INSERT OR REPLACE INTO shadow_projects (id, name, description, project_tag, status, completion_date, completion_memo) 
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                project_id, 
                s_name, 
                s_desc, 
                project.project_tag, 
                project.status, 
                project.completion_date, 
                s_comp_memo
            ],
        )?;

        Ok(())
    }

    pub fn save_status_log_dual(&self, conn: &rusqlite::Connection, log: &StatusLog, log_id: i64) -> Result<()> {
        let s_title = SecurityEngine::tokenize(conn, log.title.as_deref().unwrap_or(""));
        let s_content = SecurityEngine::tokenize(conn, log.text_content.as_deref().unwrap_or(""));
        let s_manager = SecurityEngine::tokenize(conn, log.manager.as_deref().unwrap_or(""));

        conn.execute(
            "INSERT OR REPLACE INTO shadow_status_logs (id, title, text_content, manager) VALUES (?, ?, ?, ?)",
            params![log_id, s_title, s_content, s_manager],
        )?;

        Ok(())
    }

    pub fn delete_task_dual(&self, conn: &rusqlite::Connection, task_id: i64) -> Result<()> {
        conn.execute("DELETE FROM tasks WHERE id = ?", params![task_id])?;
        conn.execute("DELETE FROM shadow_tasks WHERE id = ?", params![task_id])?;
        Ok(())
    }

    pub fn delete_meeting_dual(&self, conn: &rusqlite::Connection, meeting_id: i64) -> Result<()> {
        conn.execute("DELETE FROM meetings WHERE id = ?", params![meeting_id])?;
        conn.execute("DELETE FROM shadow_meetings WHERE id = ?", params![meeting_id])?;
        Ok(())
    }

    pub fn delete_project_dual(&self, conn: &rusqlite::Connection, project_id: i64) -> Result<()> {
        let _ = conn.execute("DELETE FROM shadow_status_logs WHERE id IN (SELECT id FROM status_logs WHERE project_id = ?)", params![project_id]);
        let _ = conn.execute("DELETE FROM status_logs WHERE project_id = ?", params![project_id]);
        let _ = conn.execute("DELETE FROM milestones WHERE project_id = ?", params![project_id]);
        let _ = conn.execute("DELETE FROM shadow_projects WHERE id = ?", params![project_id]);
        conn.execute("DELETE FROM projects WHERE id = ?", params![project_id])?;
        Ok(())
    }

    pub fn delete_status_log_dual(&self, conn: &rusqlite::Connection, log_id: i64) -> Result<()> {
        let _ = conn.execute("DELETE FROM shadow_status_logs WHERE id = ?", params![log_id]);
        conn.execute("DELETE FROM status_logs WHERE id = ?", params![log_id])?;
        Ok(())
    }

    pub fn seed_demo_data(&self) -> Result<()> {
        let owner_id = 999;
        let now_dt = chrono::Local::now();
        let now = now_dt.to_rfc3339();
        
        // Dynamic dates within +/- 2 weeks
        let d_m10 = (now_dt - chrono::Duration::days(10)).format("%Y-%m-%d").to_string();
        let d_m5 = (now_dt - chrono::Duration::days(5)).format("%Y-%m-%d").to_string();
        let d_m2 = (now_dt - chrono::Duration::days(2)).format("%Y-%m-%d").to_string();
        let d_today = now_dt.format("%Y-%m-%d").to_string();
        let d_p1 = (now_dt + chrono::Duration::days(1)).format("%Y-%m-%d").to_string();
        let d_p3 = (now_dt + chrono::Duration::days(3)).format("%Y-%m-%d").to_string();
        let d_p5 = (now_dt + chrono::Duration::days(5)).format("%Y-%m-%d").to_string();
        let d_p8 = (now_dt + chrono::Duration::days(8)).format("%Y-%m-%d").to_string();
        let _d_p14 = (now_dt + chrono::Duration::days(14)).format("%Y-%m-%d").to_string();

        let conn = self.conn.lock().unwrap();

        // Clear existing demo data first to ensure idempotency and prevent duplicates
        conn.execute("DELETE FROM shadow_tasks WHERE id IN (SELECT id FROM tasks WHERE owner_id = ?)", [owner_id])?;
        conn.execute("DELETE FROM shadow_meetings WHERE id IN (SELECT id FROM meetings WHERE owner_id = ?)", [owner_id])?;
        conn.execute("DELETE FROM shadow_projects WHERE id IN (SELECT id FROM projects WHERE owner_id = ?)", [owner_id])?;
        conn.execute("DELETE FROM shadow_status_logs WHERE id IN (SELECT id FROM status_logs WHERE owner_id = ?)", [owner_id])?;

        conn.execute("DELETE FROM status_logs WHERE owner_id = ?", [owner_id])?;
        conn.execute("DELETE FROM milestones WHERE project_id IN (SELECT id FROM projects WHERE owner_id = ?)", [owner_id])?;
        conn.execute("DELETE FROM projects WHERE owner_id = ?", [owner_id])?;
        conn.execute("DELETE FROM tasks WHERE owner_id = ?", [owner_id])?;
        conn.execute("DELETE FROM meetings WHERE owner_id = ?", [owner_id])?;

        // Ensure demo user exists
        conn.execute(
            "INSERT OR IGNORE INTO users (id, username, password_hash, password_hint) VALUES (?, ?, ?, ?)",
            params![owner_id, "demo_user", "demo", "demo"],
        )?;

        let projects = vec![
            Project {
                id: None, owner_id: Some(owner_id),
                name: "SJ-Gimbal System R&D".to_string(),
                description: Some("Developing high-precision gimbal stabilization for industrial drones.".to_string()),
                manager: Some("Wonseup Shin".to_string()),
                client: Some("SJ Global".to_string()),
                start_date: Some(d_m10.clone()),
                created_at: format!("{}T09:00:00Z", d_m10), status: "active".to_string(),
                dept1_name: "Control".to_string(), dept2_name: "Hardware".to_string(),
                dept3_name: "Software".to_string(), dept4_name: "Testing".to_string(),
                project_tag: Some(format!("P{}-0900-01", &d_m10.replace("-", "")[2..])),
                is_deleted: false,
                completion_date: None, completion_memo: None,
            },
            Project {
                id: None, owner_id: Some(owner_id),
                name: "Antigravity UI Redesign".to_string(),
                description: Some("Premium UI/UX overhaul for the core WorkAssist engine.".to_string()),
                manager: Some("Admin User".to_string()),
                client: Some("Internal".to_string()),
                start_date: Some(d_m5.clone()),
                created_at: format!("{}T10:00:00Z", d_m5), status: "active".to_string(),
                dept1_name: "Design".to_string(), dept2_name: "Frontend".to_string(),
                dept3_name: "Backend".to_string(), dept4_name: "QA".to_string(),
                project_tag: Some(format!("P{}-1000-02", &d_m5.replace("-", "")[2..])),
                is_deleted: false,
                completion_date: None, completion_memo: None,
            },
            Project {
                id: None, owner_id: Some(owner_id),
                name: "Autonomous Navigation Alpha".to_string(),
                description: Some("Implementing SLAM algorithms for indoor warehouse robots.".to_string()),
                manager: Some("Wonseup Shin".to_string()),
                client: Some("Logistics Corp".to_string()),
                start_date: Some(d_today.clone()),
                created_at: format!("{}T11:00:00Z", d_today), status: "active".to_string(),
                dept1_name: "Algorithm".to_string(), dept2_name: "Vision".to_string(),
                dept3_name: "Control".to_string(), dept4_name: "Integration".to_string(),
                project_tag: Some(format!("P{}-1100-03", &d_today.replace("-", "")[2..])),
                is_deleted: false,
                completion_date: None, completion_memo: None,
            },
            Project {
                id: None, owner_id: Some(owner_id),
                name: "Cloud Sync Gateway v2".to_string(),
                description: Some("Next-gen secure synchronization layer for cross-platform data.".to_string()),
                manager: Some("Cloud Lead".to_string()),
                client: Some("SJ Global".to_string()),
                start_date: Some(d_today.clone()),
                created_at: format!("{}T14:00:00Z", d_today), status: "active".to_string(),
                dept1_name: "API".to_string(), dept2_name: "Security".to_string(),
                dept3_name: "DevOps".to_string(), dept4_name: "Monitoring".to_string(),
                project_tag: Some(format!("P{}-1400-04", &d_today.replace("-", "")[2..])),
                is_deleted: false,
                completion_date: None, completion_memo: None,
            },
            Project {
                id: None, owner_id: Some(owner_id),
                name: "Legacy Control Board Prototype".to_string(),
                description: Some("Initial hardware prototyping and motor drive testing for first-generation gimbal system.".to_string()),
                manager: Some("Wonseup Shin".to_string()),
                client: Some("SJ Global".to_string()),
                start_date: Some(d_m10.clone()),
                created_at: format!("{}T08:00:00Z", d_m10), status: "done".to_string(),
                dept1_name: "Control".to_string(), dept2_name: "Hardware".to_string(),
                dept3_name: "Software".to_string(), dept4_name: "Testing".to_string(),
                project_tag: Some(format!("P{}-0800-05", &d_m10.replace("-", "")[2..])),
                is_deleted: false,
                completion_date: Some(d_m2.clone()),
                completion_memo: Some("Prototype validated successfully under load. Design signed off by client.".to_string()),
            }
        ];

        for mut p in projects {
            conn.execute(
                "INSERT INTO projects (owner_id, name, description, manager, client, start_date, created_at, status, dept1_name, dept2_name, dept3_name, dept4_name, project_tag, is_deleted, completion_date, completion_memo) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![p.owner_id, p.name, p.description, p.manager, p.client, p.start_date, p.created_at, p.status, p.dept1_name, p.dept2_name, p.dept3_name, p.dept4_name, p.project_tag, p.is_deleted, p.completion_date, p.completion_memo],
            )?;
            let pid = conn.last_insert_rowid();
            p.id = Some(pid);
            self.save_project_dual(&conn, &p, pid)?;

            // Add some status logs for the project
            let log = StatusLog {
                id: None, project_id: pid, department: "Software".to_string(),
                text_content: Some("SecurityEngine tokenization logic implemented and tested with SJ-Gimbal data.".to_string()),
                timestamp: now.clone(), status: "completed".to_string(),
                tag: Some("Security".to_string()), title: Some("Security Gateway Update".to_string()),
                manager: Some("Wonseup Shin".to_string()), start_date: None, due_date: None,
                is_deleted: false,
            };
            conn.execute(
                "INSERT INTO status_logs (project_id, owner_id, department, text_content, timestamp, status, tag, title, manager, is_deleted) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![log.project_id, owner_id, log.department, log.text_content, log.timestamp, log.status, log.tag, log.title, log.manager, log.is_deleted],
            )?;
            let lid = conn.last_insert_rowid();
            self.save_status_log_dual(&conn, &log, lid)?;
        }

        // 2. Demo Tasks
        let tasks = vec![
            Task {
                id: None, owner_id: Some(owner_id),
                title: "Fix Tokenization Bug in GateWay".to_string(),
                content: Some("Ensure special characters in Wonseup Shin's profile are handled correctly.".to_string()),
                manager: Some("Wonseup Shin".to_string()),
                start_date: Some(d_m2.clone()), due_date: Some(d_p3.clone()),
                status: "Doing".to_string(), is_urgent: true, created_at: now.clone(),
                review_comment: None, task_tag: Some(format!("T{}-0930-01", &d_m2.replace("-", "")[2..])), is_deleted: false,
            },
            Task {
                id: None, owner_id: Some(owner_id),
                title: "Prepare SJ-Automation Q3 Report".to_string(),
                content: Some("Compile financial data and project status for the board meeting.".to_string()),
                manager: Some("Admin User".to_string()),
                start_date: Some(d_m10.clone()), due_date: Some(d_p8.clone()),
                status: "Note".to_string(), is_urgent: false, created_at: now.clone(),
                review_comment: None, task_tag: Some(format!("T{}-1015-02", &d_m10.replace("-", "")[2..])), is_deleted: false,
            },
            Task {
                id: None, owner_id: Some(owner_id),
                title: "Update API Documentation".to_string(),
                content: Some("Complete Swagger definitions for the new Minutes Search endpoint.".to_string()),
                manager: Some("Wonseup Shin".to_string()),
                start_date: Some(d_today.clone()), due_date: Some(d_p5.clone()),
                status: "To-do".to_string(), is_urgent: false, created_at: now.clone(),
                review_comment: None, task_tag: Some(format!("T{}-1145-03", &d_today.replace("-", "")[2..])), is_deleted: false,
            },
            Task {
                id: None, owner_id: Some(owner_id),
                title: "Performance Profiling".to_string(),
                content: Some("Analyze SQLite query latency for the new shadow DB sync logic.".to_string()),
                manager: Some("Perf Lead".to_string()),
                start_date: Some(d_p1.clone()), due_date: Some(d_p3.clone()),
                status: "Todo".to_string(), is_urgent: true, created_at: now.clone(),
                review_comment: None, task_tag: Some(format!("T{}-1420-04", &d_p1.replace("-", "")[2..])), is_deleted: false,
            }
        ];

        for mut t in tasks {
            conn.execute(
                "INSERT INTO tasks (owner_id, title, content, manager, start_date, due_date, status, is_urgent, created_at, task_tag) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![t.owner_id, t.title, t.content, t.manager, t.start_date, t.due_date, t.status, t.is_urgent, t.created_at, t.task_tag],
            )?;
            let tid = conn.last_insert_rowid();
            t.id = Some(tid);
            self.save_task_dual(&conn, &t, tid)?;
        }

        // 3. Demo Meetings
        let meetings = vec![
            Meeting {
                id: None, owner_id: Some(owner_id),
                title: "SJ-Gimbal Core Security Review".to_string(),
                date: Some(d_m2.clone()),
                participants: Some("Wonseup Shin, Admin User, Technical Lead".to_string()),
                location: Some("Conference Room Alpha".to_string()),
                decisions: Some("Approved the use of regex-based SecurityEngine for PII tokenization.".to_string()),
                action_items: Some("1. Update schema.rs, 2. Test dual-write latency".to_string()),
                memo: Some("Crucial meeting to finalize the Antigravity security layer.".to_string()),
                created_at: now.clone(),
                meeting_tag: Some(format!("M{}-1400-01", &d_m2.replace("-", "")[2..])),
                is_deleted: false,
            },
            Meeting {
                id: None, owner_id: Some(owner_id),
                title: "Quarterly Strategy Session".to_string(),
                date: Some(d_today.clone()),
                participants: Some("Wonseup Shin, C-Level Executives".to_string()),
                location: Some("Executive Suite".to_string()),
                decisions: Some("Decided to prioritize the Antigravity v2 deployment across all SJ branches.".to_string()),
                action_items: Some("1. Draft deployment roadmap, 2. Allocate Q3 budget".to_string()),
                memo: Some("High-level strategic alignment for the next expansion phase.".to_string()),
                created_at: now.clone(),
                meeting_tag: Some(format!("M{}-1000-02", &d_today.replace("-", "")[2..])),
                is_deleted: false,
            }
        ];

        for mut m in meetings {
            conn.execute(
                "INSERT INTO meetings (owner_id, title, date, participants, location, decisions, action_items, memo, created_at, meeting_tag) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![m.owner_id, m.title, m.date, m.participants, m.location, m.decisions, m.action_items, m.memo, m.created_at, m.meeting_tag],
            )?;
            let mid = conn.last_insert_rowid();
            m.id = Some(mid);
            self.save_meeting_dual(&conn, &m, mid)?;
        }

        Ok(())
    }

    pub fn clear_demo_data(&self) -> Result<()> {
        let owner_id = 999;
        let conn = self.conn.lock().unwrap();

        // Delete from shadow tables using subqueries
        conn.execute("DELETE FROM shadow_tasks WHERE id IN (SELECT id FROM tasks WHERE owner_id = ?)", [owner_id])?;
        conn.execute("DELETE FROM shadow_meetings WHERE id IN (SELECT id FROM meetings WHERE owner_id = ?)", [owner_id])?;
        conn.execute("DELETE FROM shadow_projects WHERE id IN (SELECT id FROM projects WHERE owner_id = ?)", [owner_id])?;
        conn.execute("DELETE FROM shadow_status_logs WHERE id IN (SELECT id FROM status_logs WHERE owner_id = ?)", [owner_id])?;

        // Delete from primary tables (Referencing tables first to prevent foreign key errors)
        conn.execute("DELETE FROM status_logs WHERE owner_id = ?", [owner_id])?;
        conn.execute("DELETE FROM milestones WHERE project_id IN (SELECT id FROM projects WHERE owner_id = ?)", [owner_id])?;
        conn.execute("DELETE FROM projects WHERE owner_id = ?", [owner_id])?;
        conn.execute("DELETE FROM tasks WHERE owner_id = ?", [owner_id])?;
        conn.execute("DELETE FROM meetings WHERE owner_id = ?", [owner_id])?;
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Project;
    use std::path::PathBuf;

    #[test]
    fn test_project_tag_flow() {
        // Create a temporary test database file in the workspace
        let test_db_dir = std::env::temp_dir();
        std::fs::create_dir_all(&test_db_dir).ok();
        let test_db_path = test_db_dir.join("test_workassist.db");
        if test_db_path.exists() {
            std::fs::remove_file(&test_db_path).ok();
        }

        // 1. Initialize storage and verify tables & schemas are created
        let storage = Storage::new(test_db_path.clone()).expect("Failed to create test storage");
        
        // Connect to verify schema directly
        let conn = rusqlite::Connection::open(&test_db_path).expect("Failed to open test connection");
        
        let mut stmt = conn.prepare("PRAGMA table_info(projects)").unwrap();
        let columns: Vec<String> = stmt.query_map([], |row| row.get::<_, String>(1)).unwrap().map(|r| r.unwrap()).collect();
        assert!(columns.contains(&"project_tag".to_string()), "projects table should contain project_tag column");

        let mut stmt_s = conn.prepare("PRAGMA table_info(shadow_projects)").unwrap();
        let s_columns: Vec<String> = stmt_s.query_map([], |row| row.get::<_, String>(1)).unwrap().map(|r| r.unwrap()).collect();
        assert!(s_columns.contains(&"project_tag".to_string()), "shadow_projects table should contain project_tag column");

        // 2. Seed demo data and verify tagged projects
        storage.seed_demo_data().expect("Failed to seed demo data");

        let mut stmt_p = conn.prepare("SELECT name, project_tag FROM projects WHERE owner_id = 999").unwrap();
        let seeded_projects: Vec<(String, String)> = stmt_p.query_map([], |row| {
            Ok((row.get::<_, String>(0).unwrap(), row.get::<_, String>(1).unwrap()))
        }).unwrap().map(|r| r.unwrap()).collect();

        assert!(!seeded_projects.is_empty(), "Seeded projects should not be empty");
        for (name, tag) in &seeded_projects {
            assert!(tag.starts_with('P'), "Demo project {} tag '{}' should start with 'P'", name, tag);
            assert_eq!(tag.len(), 15, "Demo project {} tag '{}' length should be 15", name, tag);
            println!("Demo project seeded tag verified: {} -> {}", name, tag);
        }

        // 3. Test dynamic project tag generation inside add_project
        let pm = crate::modules::pm::PmModule::new(std::sync::Arc::new(storage));
        let new_project = Project {
            id: None,
            owner_id: Some(1),
            name: "Test Dynamic Tag Project".to_string(),
            description: Some("Verification of sequential tags".to_string()),
            manager: Some("Tester".to_string()),
            client: Some("QA".to_string()),
            start_date: None,
            created_at: "".to_string(),
            status: "active".to_string(),
            dept1_name: "".to_string(),
            dept2_name: "".to_string(),
            dept3_name: "".to_string(),
            dept4_name: "".to_string(),
            project_tag: None,
            is_deleted: false,
            completion_date: None,
            completion_memo: None,
        };

        let project_id = pm.add_project(new_project).expect("Failed to add project");
        
        // Query the added project to verify tag
        let mut stmt_new = conn.prepare("SELECT project_tag FROM projects WHERE id = ?").unwrap();
        let generated_tag: String = stmt_new.query_row([project_id], |row| row.get(0)).unwrap();
        
        assert!(generated_tag.starts_with('P'), "Generated tag '{}' should start with 'P'", generated_tag);
        assert_eq!(generated_tag.len(), 15, "Generated tag '{}' length should be 15", generated_tag);
        assert!(generated_tag.ends_with("-01"), "Generated tag '{}' should end with -01 sequence number", generated_tag);
        println!("Dynamically generated project tag verified: {}", generated_tag);

        // Clean up test DB
        std::fs::remove_file(&test_db_path).ok();
    }

    #[test]
    fn test_project_trash_flow() {
        let test_db_dir = std::env::temp_dir();
        std::fs::create_dir_all(&test_db_dir).ok();
        let test_db_path = test_db_dir.join("test_workassist_trash.db");
        if test_db_path.exists() {
            std::fs::remove_file(&test_db_path).ok();
        }

        // Initialize storage
        let storage = Storage::new(test_db_path.clone()).expect("Failed to create test storage");
        let conn = rusqlite::Connection::open(&test_db_path).expect("Failed to open test connection");

        // Verify columns inside schema
        let mut stmt = conn.prepare("PRAGMA table_info(projects)").unwrap();
        let columns: Vec<String> = stmt.query_map([], |row| row.get::<_, String>(1)).unwrap().map(|r| r.unwrap()).collect();
        assert!(columns.contains(&"is_deleted".to_string()), "projects table should contain is_deleted column");

        // Seed demo data
        storage.seed_demo_data().expect("Failed to seed demo data");

        // PM Module instance
        let pm = crate::modules::pm::PmModule::new(std::sync::Arc::new(storage));

        // Retrieve active projects and verify count
        let owner_id = 1;
        let active_projects = pm.get_active_projects(owner_id).unwrap();
        assert!(!active_projects.is_empty(), "Active projects list should not be empty initially");
        let initial_count = active_projects.len();

        // 1. Soft delete project
        let target_project = &active_projects[0];
        let target_id = target_project.id.unwrap();
        pm.delete_project(target_id).unwrap();

        // Retrieve active projects after deletion
        let active_projects_after = pm.get_active_projects(owner_id).unwrap();
        assert_eq!(active_projects_after.len(), initial_count - 1, "Active count should decrease by 1");

        // Retrieve deleted projects list
        let deleted_projects = pm.get_deleted_projects(owner_id).unwrap();
        assert!(deleted_projects.iter().any(|p| p.id.unwrap() == target_id), "Deleted project should show in get_deleted_projects");

        // 2. Restore project
        pm.restore_project(target_id).unwrap();

        // Retrieve active projects after restore
        let active_projects_restored = pm.get_active_projects(owner_id).unwrap();
        assert_eq!(active_projects_restored.len(), initial_count, "Active count should return to initial count");

        // Verify it is not in deleted list anymore
        let deleted_projects_after = pm.get_deleted_projects(owner_id).unwrap();
        assert!(!deleted_projects_after.iter().any(|p| p.id.unwrap() == target_id), "Project should be removed from get_deleted_projects");

        // 3. Hard delete project
        pm.hard_delete_project(target_id).unwrap();

        // Verify it is completely gone
        let active_projects_final = pm.get_active_projects(owner_id).unwrap();
        assert_eq!(active_projects_final.len(), initial_count - 1, "Active count should decrease by 1 since project was hard deleted");
        
        let deleted_projects_final = pm.get_deleted_projects(owner_id).unwrap();
        assert!(!deleted_projects_final.iter().any(|p| p.id.unwrap() == target_id), "Project should not exist in deleted list");

        // Clean up test DB
        std::fs::remove_file(&test_db_path).ok();
    }
}
