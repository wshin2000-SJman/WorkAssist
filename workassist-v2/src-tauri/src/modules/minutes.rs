use crate::models::Meeting;
use crate::storage::Storage;
use rusqlite::{params, Result};
use chrono::Utc;

use std::sync::Arc;

pub struct MinutesModule {
    storage: Arc<Storage>,
}

impl MinutesModule {
    pub fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub fn get_all_meetings(&self, owner_id: i64) -> Result<Vec<Meeting>> {
        let conn = self.storage.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, owner_id, title, date, participants, location, decisions, action_items, memo, created_at 
             FROM meetings WHERE owner_id = ? OR owner_id = 999 ORDER BY date DESC"
        )?;
        
        let meeting_iter = stmt.query_map(params![owner_id], |row| {
            Ok(Meeting {
                id: Some(row.get(0)?),
                owner_id: Some(row.get(1)?),
                title: row.get(2)?,
                date: row.get(3)?,
                participants: row.get(4)?,
                location: row.get(5)?,
                decisions: row.get(6)?,
                action_items: row.get(7)?,
                memo: row.get(8)?,
                created_at: row.get(9)?,
            })
        })?;

        let mut meetings = Vec::new();
        for meeting in meeting_iter {
            meetings.push(meeting?);
        }
        Ok(meetings)
    }

    pub fn save_meeting(&self, mut meeting: Meeting) -> Result<i64> {
        let now = Utc::now().to_rfc3339();
        let conn = self.storage.conn.lock().unwrap();
        
        if let Some(id) = meeting.id {
            conn.execute(
                "UPDATE meetings SET title = ?, date = ?, participants = ?, location = ?, decisions = ?, action_items = ?, memo = ? WHERE id = ?",
                params![
                    meeting.title,
                    meeting.date,
                    meeting.participants,
                    meeting.location,
                    meeting.decisions,
                    meeting.action_items,
                    meeting.memo,
                    id
                ],
            )?;
            let _ = self.storage.save_meeting_dual(&conn, &meeting, id);
            Ok(id)
        } else {
            meeting.created_at = now;
            conn.execute(
                "INSERT INTO meetings (owner_id, title, date, participants, location, decisions, action_items, memo, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    meeting.owner_id,
                    meeting.title,
                    meeting.date,
                    meeting.participants,
                    meeting.location,
                    meeting.decisions,
                    meeting.action_items,
                    meeting.memo,
                    meeting.created_at
                ],
            )?;
            let meeting_id = conn.last_insert_rowid();
            let _ = self.storage.save_meeting_dual(&conn, &meeting, meeting_id);
            Ok(meeting_id)
        }
    }

    pub fn export_to_markdown(&self, meeting: &Meeting) -> String {
        let mut md = format!("# 📝 {}\n\n", meeting.title);
        md.push_str(&format!("**날짜:** {}\n", meeting.date.as_deref().unwrap_or("-")));
        md.push_str(&format!("**장소:** {}\n", meeting.location.as_deref().unwrap_or("-")));
        md.push_str(&format!("**참석자:** {}\n\n", meeting.participants.as_deref().unwrap_or("-")));
        
        if let Some(memo) = &meeting.memo {
            md.push_str("## 📝 Free Memo\n");
            md.push_str(memo);
            md.push_str("\n\n");
        }
        
        md.push_str("\n---\n*Created by SJ WorkAssist v2.0 (Rust Engine)*");
        md
    }
}

// --- Minutes Plugin Commands ---

#[tauri::command]
pub async fn get_meeting_count(api: tauri::State<'_, crate::api::Api>, owner_id: i64) -> Result<usize, String> {
    api.minutes().get_all_meetings(owner_id).map(|m| m.len()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_meetings(api: tauri::State<'_, crate::api::Api>, owner_id: i64) -> Result<Vec<Meeting>, String> {
    api.minutes().get_all_meetings(owner_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_meeting(api: tauri::State<'_, crate::api::Api>, meeting: Meeting) -> Result<i64, String> {
    api.minutes().save_meeting(meeting).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_meeting_md(api: tauri::State<'_, crate::api::Api>, meeting: Meeting) -> Result<String, String> {
    Ok(api.minutes().export_to_markdown(&meeting))
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("minutes")
        .invoke_handler(tauri::generate_handler![
            get_meeting_count,
            get_meetings,
            save_meeting,
            export_meeting_md
        ])
        .build()
}
