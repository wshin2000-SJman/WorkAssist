pub mod schema;
use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::Mutex;

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
        storage.init_tables()?;
        
        Ok(storage)
    }

    fn init_tables(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(schema::CREATE_USERS_TABLE, [])?;
        conn.execute(schema::CREATE_MEETINGS_TABLE, [])?;
        conn.execute(schema::CREATE_TASKS_TABLE, [])?;
        conn.execute(schema::CREATE_PROJECTS_TABLE, [])?;
        conn.execute(schema::CREATE_MILESTONES_TABLE, [])?;
        conn.execute(schema::CREATE_STATUS_LOGS_TABLE, [])?;

        // Migration: Add is_deleted column if not exists
        let table_info: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(tasks)")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            rows.map(|r| r.unwrap()).collect()
        };

        if !table_info.contains(&"is_deleted".to_string()) {
            conn.execute("ALTER TABLE tasks ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT 0", [])?;
            println!("Migration: Added is_deleted column to tasks table.");
        }

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

    pub fn perform_backup(&self) -> std::io::Result<()> {
        let backup_dir = self.get_backup_dir();
        std::fs::create_dir_all(&backup_dir)?;

        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
        let backup_path = backup_dir.join(format!("sjworkassist_v2_backup_{}.db", timestamp));

        std::fs::copy(&self.path, &backup_path)?;
        println!("Backup created at: {:?}", backup_path);

        self.cleanup_backups(backup_dir)?;
        Ok(())
    }

    fn cleanup_backups(&self, backup_dir: PathBuf) -> std::io::Result<()> {
        let mut backups: Vec<_> = std::fs::read_dir(backup_dir)?
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains("backup_"))
            .collect();

        // Sort by modification time (oldest first)
        backups.sort_by_key(|a| a.metadata().and_then(|m| m.modified()).ok());

        // Keep only the latest 3
        if backups.len() > 3 {
            let delete_count = backups.len() - 3;
            for i in 0..delete_count {
                std::fs::remove_file(backups[i].path())?;
                println!("Deleted old backup: {:?}", backups[i].path());
            }
        }
        Ok(())
    }

    pub fn manual_backup(&self, target_path: PathBuf) -> std::io::Result<()> {
        std::fs::copy(&self.path, &target_path)?;
        Ok(())
    }

    pub fn import_database(&self, source_path: PathBuf) -> std::io::Result<()> {
        // To safely import, we overwrite the current DB file.
        // The user should restart the app for full reliability, 
        // but copying over it usually works if we aren't mid-transaction.
        std::fs::copy(&source_path, &self.path)?;
        
        // Remove WAL/SHM files to avoid consistency issues with the new DB
        let mut wal = self.path.clone();
        wal.set_extension("db-wal");
        let mut shm = self.path.clone();
        shm.set_extension("db-shm");
        
        let _ = std::fs::remove_file(wal);
        let _ = std::fs::remove_file(shm);
        
        Ok(())
    }

    pub fn initialize_user_data(&self, owner_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        // Delete all related data for the owner
        conn.execute("DELETE FROM status_logs WHERE project_id IN (SELECT id FROM projects WHERE owner_id = ?)", [owner_id])?;
        conn.execute("DELETE FROM milestones WHERE project_id IN (SELECT id FROM projects WHERE owner_id = ?)", [owner_id])?;
        conn.execute("DELETE FROM projects WHERE owner_id = ?", [owner_id])?;
        conn.execute("DELETE FROM tasks WHERE owner_id = ?", [owner_id])?;
        conn.execute("DELETE FROM meetings WHERE owner_id = ?", [owner_id])?;
        Ok(())
    }
}
