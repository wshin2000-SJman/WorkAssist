use rusqlite::{params, Result};
use crate::storage::Storage;
use crate::models::User;
use std::sync::Arc;

pub struct AuthModule {
    storage: Arc<Storage>,
}

impl AuthModule {
    pub fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub fn login(&self, username: &str, password_hash: &str) -> Result<Option<User>> {
        let conn = self.storage.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, username, password_hash, password_hint FROM users WHERE username = ? AND password_hash = ?"
        )?;
        
        let mut user_iter = stmt.query_map(params![username, password_hash], |row| {
            Ok(User {
                id: Some(row.get(0)?),
                username: row.get(1)?,
                password_hash: row.get(2)?,
                password_hint: row.get(3)?,
            })
        })?;

        if let Some(user) = user_iter.next() {
            Ok(Some(user?))
        } else {
            Ok(None)
        }
    }

    pub fn create_user(&self, username: &str, password_hash: &str, hint: &str) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO users (username, password_hash, password_hint) VALUES (?, ?, ?)",
            params![username, password_hash, hint],
        )?;
        Ok(())
    }

    pub fn get_hint(&self, username: &str) -> Result<Option<String>> {
        let conn = self.storage.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT password_hint FROM users WHERE username = ?")?;
        let mut rows = stmt.query_map(params![username], |row| row.get::<_, Option<String>>(0))?;
        
        if let Some(hint) = rows.next() {
            Ok(hint?)
        } else {
            Ok(None)
        }
    }

    pub fn change_password(&self, username: &str, old_hash: &str, new_hash: &str, new_hint: &str) -> Result<bool> {
        let conn = self.storage.conn.lock().unwrap();
        let updated = conn.execute(
            "UPDATE users SET password_hash = ?, password_hint = ? WHERE username = ? AND password_hash = ?",
            params![new_hash, new_hint, username, old_hash],
        )?;
        Ok(updated > 0)
    }
}
