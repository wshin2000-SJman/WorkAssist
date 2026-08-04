use crate::models::{Meeting, MeetingCategory};
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
            "SELECT id, owner_id, title, date, participants, location, decisions, action_items, memo, created_at, meeting_tag, is_deleted, category_id 
             FROM meetings WHERE (owner_id = ? OR owner_id = 999) AND is_deleted = 0 ORDER BY date DESC"
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
                meeting_tag: row.get(10)?,
                is_deleted: row.get(11)?,
                category_id: row.get(12)?,
            })
        })?;

        let mut meetings = Vec::new();
        for meeting in meeting_iter {
            meetings.push(meeting?);
        }
        Ok(meetings)
    }

    pub fn delete_meeting(&self, meeting_id: i64) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute("UPDATE meetings SET is_deleted = 1 WHERE id = ?", params![meeting_id])?;
        Ok(())
    }

    pub fn get_deleted_meetings(&self, owner_id: i64) -> Result<Vec<Meeting>> {
        let conn = self.storage.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, owner_id, title, date, participants, location, decisions, action_items, memo, created_at, meeting_tag, is_deleted, category_id 
             FROM meetings WHERE (owner_id = ? OR owner_id = 999) AND is_deleted = 1 ORDER BY date DESC"
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
                meeting_tag: row.get(10)?,
                is_deleted: row.get(11)?,
                category_id: row.get(12)?,
            })
        })?;

        let mut meetings = Vec::new();
        for meeting in meeting_iter {
            meetings.push(meeting?);
        }
        Ok(meetings)
    }

    pub fn restore_meeting(&self, meeting_id: i64) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute("UPDATE meetings SET is_deleted = 0 WHERE id = ?", params![meeting_id])?;
        Ok(())
    }

    pub fn hard_delete_meeting(&self, meeting_id: i64) -> Result<()> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute("DELETE FROM meetings WHERE id = ?", params![meeting_id])?;
        Ok(())
    }

    pub fn save_meeting(&self, mut meeting: Meeting) -> Result<i64> {
        let now = Utc::now();
        let now_rfc = now.to_rfc3339();
        let now_local = now.with_timezone(&chrono::Local);
        let conn = self.storage.conn.lock().unwrap();
        
        // Enforce 99 minutes limit per category
        if let Some(cat_id) = meeting.category_id {
            if !meeting.is_deleted {
                let count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM meetings WHERE category_id = ? AND is_deleted = 0 AND id != ?",
                    params![cat_id, meeting.id.unwrap_or(0)],
                    |row| row.get(0)
                )?;
                if count >= 99 {
                    return Err(rusqlite::Error::ToSqlConversionFailure(
                        Box::new(std::io::Error::new(
                            std::io::ErrorKind::Other,
                            "Category limit exceeded: A category can only hold a maximum of 99 active minutes."
                        ))
                    ));
                }
            }
        }
        
        if let Some(id) = meeting.id {
            conn.execute(
                "UPDATE meetings SET title = ?, date = ?, participants = ?, location = ?, decisions = ?, action_items = ?, memo = ?, meeting_tag = ?, is_deleted = ?, category_id = ? WHERE id = ?",
                params![
                    meeting.title,
                    meeting.date,
                    meeting.participants,
                    meeting.location,
                    meeting.decisions,
                    meeting.action_items,
                    meeting.memo,
                    meeting.meeting_tag,
                    meeting.is_deleted,
                    meeting.category_id,
                    id
                ],
            )?;
            Ok(id)
        } else {
            // Generate Tag: MYYMMDD-HHMM-## (SSOT) if not already present
            if meeting.meeting_tag.is_none() {
                meeting.meeting_tag = Some(crate::storage::Storage::generate_sequential_tag(&conn, "meetings", "M", &now_local));
            }
            meeting.created_at = now_rfc;
            conn.execute(
                "INSERT INTO meetings (owner_id, title, date, participants, location, decisions, action_items, memo, created_at, meeting_tag, is_deleted, category_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    meeting.owner_id,
                    meeting.title,
                    meeting.date,
                    meeting.participants,
                    meeting.location,
                    meeting.decisions,
                    meeting.action_items,
                    meeting.memo,
                    meeting.created_at,
                    meeting.meeting_tag,
                    meeting.is_deleted,
                    meeting.category_id
                ],
            )?;
            let meeting_id = conn.last_insert_rowid();
            Ok(meeting_id)
        }
    }

    pub fn export_to_markdown(&self, meeting: &Meeting) -> String {
        let mut md = format!("# 📝 {}\n\n", meeting.title);
        if let Some(tag) = &meeting.meeting_tag {
            md.push_str(&format!("> **Tag:** `{}`\n\n", tag));
        }
        md.push_str(&format!("**날짜:** {}\n", meeting.date.as_deref().unwrap_or("-")));
        md.push_str(&format!("**장소:** {}\n", meeting.location.as_deref().unwrap_or("-")));
        md.push_str(&format!("**참석자:** {}\n\n", meeting.participants.as_deref().unwrap_or("-")));
        
        if let Some(memo) = &meeting.memo {
            if !memo.trim().is_empty() {
                md.push_str("## 🎯 Agenda\n");
                md.push_str(memo);
                md.push_str("\n\n");
            }
        }

        if let Some(decisions) = &meeting.decisions {
            if !decisions.trim().is_empty() {
                md.push_str("## ✅ Decisions\n");
                md.push_str(decisions);
                md.push_str("\n\n");
            }
        }

        if let Some(action_items) = &meeting.action_items {
            if !action_items.trim().is_empty() {
                md.push_str("## 🏃 Action Items\n");
                md.push_str(action_items);
                md.push_str("\n\n");
            }
        }
        
        md.push_str("\n---\n*Created by SJ WorkAssist v2.0 (Rust Engine)*");
        md
    }

    pub fn get_categories(&self, owner_id: i64) -> Result<Vec<MeetingCategory>> {
        let conn = self.storage.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, owner_id, name, color, order_seq, created_at 
             FROM meeting_categories WHERE (owner_id = ? OR owner_id = 999) 
             ORDER BY order_seq ASC, name ASC"
        )?;
        
        let category_iter = stmt.query_map(params![owner_id], |row| {
            Ok(MeetingCategory {
                id: Some(row.get(0)?),
                owner_id: Some(row.get(1)?),
                name: row.get(2)?,
                color: row.get(3)?,
                order_seq: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        
        let mut categories = Vec::new();
        for cat in category_iter {
            categories.push(cat?);
        }
        Ok(categories)
    }

    pub fn save_category(&self, mut category: MeetingCategory) -> std::result::Result<i64, String> {
        let conn = self.storage.conn.lock().unwrap();
        let owner_id = category.owner_id.unwrap_or(1);
        
        if category.id.is_none() {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM meeting_categories WHERE owner_id = ?",
                params![owner_id],
                |row| row.get(0)
            ).map_err(|e| e.to_string())?;
            if count >= 50 {
                return Err("You have reached the maximum limit of 50 categories.".to_string());
            }
        }
        
        let now = Utc::now().to_rfc3339();
        
        if let Some(id) = category.id {
            conn.execute(
                "UPDATE meeting_categories SET name = ?, color = ?, order_seq = ? WHERE id = ?",
                params![category.name, category.color, category.order_seq, id],
            ).map_err(|e| e.to_string())?;
            Ok(id)
        } else {
            category.created_at = now;
            conn.execute(
                "INSERT INTO meeting_categories (owner_id, name, color, order_seq, created_at) VALUES (?, ?, ?, ?, ?)",
                params![owner_id, category.name, category.color, category.order_seq, category.created_at],
            ).map_err(|e| e.to_string())?;
            let category_id = conn.last_insert_rowid();
            Ok(category_id)
        }
    }

    pub fn delete_category(&self, category_id: i64) -> std::result::Result<(), String> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute("UPDATE meetings SET category_id = NULL WHERE category_id = ?", params![category_id]).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM meeting_categories WHERE id = ?", params![category_id]).map_err(|e| e.to_string())?;
        Ok(())
    }
}

