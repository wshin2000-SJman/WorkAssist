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
        self.storage.delete_meeting_dual(&conn, meeting_id)?;
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
            let _ = self.storage.save_meeting_dual(&conn, &meeting, id);
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
            let _ = self.storage.save_meeting_dual(&conn, &meeting, meeting_id);
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
            let _ = self.storage.save_category_dual(&conn, &category.name, id);
            Ok(id)
        } else {
            category.created_at = now;
            conn.execute(
                "INSERT INTO meeting_categories (owner_id, name, color, order_seq, created_at) VALUES (?, ?, ?, ?, ?)",
                params![owner_id, category.name, category.color, category.order_seq, category.created_at],
            ).map_err(|e| e.to_string())?;
            let category_id = conn.last_insert_rowid();
            let _ = self.storage.save_category_dual(&conn, &category.name, category_id);
            Ok(category_id)
        }
    }

    pub fn delete_category(&self, category_id: i64) -> std::result::Result<(), String> {
        let conn = self.storage.conn.lock().unwrap();
        conn.execute("UPDATE meetings SET category_id = NULL WHERE category_id = ?", params![category_id]).map_err(|e| e.to_string())?;
        conn.execute("UPDATE shadow_meetings SET category_id = NULL WHERE category_id = ?", params![category_id]).map_err(|e| e.to_string())?;
        let _ = self.storage.delete_category_dual(&conn, category_id);
        Ok(())
    }
}

// --- Minutes Plugin Commands ---

#[tauri::command]
pub async fn save_text_file(path: String, content: String) -> Result<(), String> {
    use std::fs;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_meeting_md(api: tauri::State<'_, crate::api::Api>, meeting: Meeting) -> Result<String, String> {
    Ok(api.minutes().export_to_markdown(&meeting))
}

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
pub async fn delete_meeting(api: tauri::State<'_, crate::api::Api>, meeting_id: i64) -> Result<(), String> {
    api.minutes().delete_meeting(meeting_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_deleted_meetings(api: tauri::State<'_, crate::api::Api>, owner_id: i64) -> Result<Vec<Meeting>, String> {
    api.minutes().get_deleted_meetings(owner_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_meeting(api: tauri::State<'_, crate::api::Api>, meeting_id: i64) -> Result<(), String> {
    api.minutes().restore_meeting(meeting_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hard_delete_meeting_cmd(api: tauri::State<'_, crate::api::Api>, meeting_id: i64) -> Result<(), String> {
    api.minutes().hard_delete_meeting(meeting_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_minutes_md_bulk(api: tauri::State<'_, crate::api::Api>, dir_path: String, owner_id: i64) -> Result<String, String> {
    let minutes = api.minutes().get_all_meetings(owner_id).map_err(|e| e.to_string())?;
    let categories = api.minutes().get_categories(owner_id).map_err(|e| e.to_string())?;
    
    let path = std::path::Path::new(&dir_path);
    if !path.exists() {
        return Err("Directory does not exist.".to_string());
    }
    
    // 1. Pre-create "Uncategorized" directory
    let uncategorized_dir = path.join("Uncategorized");
    if !uncategorized_dir.exists() {
        std::fs::create_dir_all(&uncategorized_dir).map_err(|e| e.to_string())?;
    }
    
    // 2. Pre-create directories for all existing categories
    for cat in &categories {
        let safe_name = cat.name.replace(&['/', '\\', ':', '*', '?', '"', '<', '>', '|'][..], "_");
        let cat_dir = path.join(&safe_name);
        if !cat_dir.exists() {
            std::fs::create_dir_all(&cat_dir).map_err(|e| e.to_string())?;
        }
    }
    
    let mut count = 0;
    for m in minutes {
        // Resolve category folder name
        let cat_folder_name = if let Some(cat_id) = m.category_id {
            if let Some(cat) = categories.iter().find(|c| c.id == Some(cat_id)) {
                cat.name.replace(&['/', '\\', ':', '*', '?', '"', '<', '>', '|'][..], "_")
            } else {
                "Uncategorized".to_string()
            }
        } else {
            "Uncategorized".to_string()
        };
        
        let target_dir = path.join(&cat_folder_name);
        if !target_dir.exists() {
            std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
        }
        
        let tag = m.meeting_tag.as_deref().unwrap_or("M-UNKNOWN");
        let safe_title = m.title.replace(&['/', '\\', ':', '*', '?', '"', '<', '>', '|'][..], "_");
        let filename = format!("{}_{}.md", tag, safe_title);
        let file_path = target_dir.join(&filename);
        
        let content = format!(
            "# {}\n\n- **Date**: {}\n- **Participants**: {}\n- **Location**: {}\n- **Tag**: {}\n\n## Decisions\n{}\n\n## Action Items\n{}\n\n## Memo\n{}\n",
            m.title,
            m.date.as_deref().unwrap_or(""),
            m.participants.as_deref().unwrap_or(""),
            m.location.as_deref().unwrap_or(""),
            tag,
            m.decisions.as_deref().unwrap_or(""),
            m.action_items.as_deref().unwrap_or(""),
            m.memo.as_deref().unwrap_or("")
        );
        
        if std::fs::write(&file_path, content).is_ok() {
            count += 1;
        }
    }
    
    Ok(format!("Successfully exported {} minutes to category folders.", count))
}

#[tauri::command]
pub async fn import_minutes_md_bulk(api: tauri::State<'_, crate::api::Api>, dir_path: String, owner_id: i64, category_id: Option<i64>) -> Result<String, String> {
    let path = std::path::Path::new(&dir_path);
    if !path.exists() {
        return Err("Directory does not exist.".to_string());
    }
    
    let entries = std::fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut count = 0;
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    
    for entry in entries.flatten() {
        let file_path = entry.path();
        if file_path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        
        let content = match std::fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        
        let title_line = content.lines().find(|l| l.starts_with("# "));
        if title_line.is_none() {
            errors.push(format!("Missing '# Title' in {:?}", file_path.file_name().unwrap()));
            continue;
        }
        let title = title_line.unwrap()[2..].trim().to_string();
        
        let extract_meta = |key: &str| -> Option<String> {
            let keys = match key {
                "Date" => vec!["Date", "날짜"],
                "Participants" => vec!["Participants", "참석자"],
                "Location" => vec!["Location", "장소"],
                "Tag" => vec!["Tag"],
                _ => vec![key],
            };
            
            for k in keys {
                for line in content.lines() {
                    let clean_line = line.trim()
                        .trim_start_matches('>')
                        .trim_start_matches('-')
                        .trim_start_matches('*')
                        .trim();
                        
                    if let Some(colon_idx) = clean_line.find(':') {
                        let key_part = clean_line[..colon_idx].trim().trim_matches('*').trim();
                        if key_part == k {
                            let mut val = clean_line[colon_idx + 1..].trim();
                            val = val.trim_start_matches('*').trim_end_matches('*').trim();
                            
                            let mut val_str = val.to_string();
                            if val_str.starts_with('`') && val_str.ends_with('`') && val_str.len() >= 2 {
                                val_str = val_str[1..val_str.len()-1].trim().to_string();
                            }
                            return Some(val_str);
                        }
                    }
                }
            }
            None
        };
        
        let date = extract_meta("Date");
        let participants = extract_meta("Participants");
        let location = extract_meta("Location");
        let mut parsed_tag = extract_meta("Tag");
        if let Some(ref tag) = parsed_tag {
            if tag.trim().is_empty() {
                parsed_tag = None;
            }
        }
        
        let extract_section = |header: &str| -> Option<String> {
            let parts: Vec<&str> = content.split(&format!("## {}", header)).collect();
            if parts.len() > 1 {
                let section_content = parts[1].split("\n## ").next().unwrap_or(parts[1]);
                Some(section_content.trim().to_string())
            } else {
                None
            }
        };
        
        let decisions = extract_section("Decisions");
        let action_items = extract_section("Action Items");
        let memo = extract_section("Memo");
        
        let mut resolved_tag = parsed_tag.clone();
        let mut target_category_id = category_id;
        
        if let Some(ref tag_val) = parsed_tag {
            let minutes = api.minutes();
            let conn = minutes.storage.conn.lock().unwrap();
            
            // 1. Check if same tag exists in Trash Bin (is_deleted = 1)
            let trash_meetings: Vec<i64> = {
                let mut stmt = conn.prepare("SELECT id FROM meetings WHERE meeting_tag = ? AND is_deleted = 1").unwrap();
                let rows = stmt.query_map(params![tag_val], |r| r.get(0)).unwrap();
                rows.filter_map(|r| r.ok()).collect()
            };
            
            if !trash_meetings.is_empty() {
                for m_id in &trash_meetings {
                    let _ = minutes.storage.delete_meeting_dual(&conn, *m_id);
                }
                warnings.push(format!(
                    "File {:?}: An identical meeting with tag '{}' in the Trash Bin has been permanently deleted.",
                    file_path.file_name().unwrap(),
                    tag_val
                ));
            }
            
            // 2. Check if same tag exists in active meetings (is_deleted = 0)
            let check_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM meetings WHERE meeting_tag = ? AND is_deleted = 0",
                params![tag_val],
                |row| row.get(0)
            ).unwrap_or(0);
            
            if check_count > 0 {
                target_category_id = None; // Force Uncategorized
                let mut suffix_counter = 1;
                loop {
                    let candidate_tag = format!("{} ({})", tag_val, suffix_counter);
                    let sub_count: i64 = conn.query_row(
                        "SELECT COUNT(*) FROM meetings WHERE meeting_tag = ? AND is_deleted = 0",
                        params![candidate_tag],
                        |row| row.get(0)
                    ).unwrap_or(0);
                    
                    if sub_count == 0 {
                        resolved_tag = Some(candidate_tag);
                        break;
                    }
                    suffix_counter += 1;
                }
                warnings.push(format!(
                    "File {:?}: Tag '{}' already exists. Imported to 'Uncategorized' with tag '{}'.",
                    file_path.file_name().unwrap(),
                    tag_val,
                    resolved_tag.as_ref().unwrap()
                ));
            }
        }
        
        let meeting = crate::models::Meeting {
            id: None,
            owner_id: Some(owner_id),
            title,
            date,
            participants,
            location,
            decisions,
            action_items,
            memo,
            category_id: target_category_id,
            created_at: chrono::Utc::now().to_rfc3339(),
            meeting_tag: resolved_tag,
            is_deleted: false,
        };
        
        if let Err(e) = api.minutes().save_meeting(meeting) {
            errors.push(format!("Failed to save {:?}: {}", file_path.file_name().unwrap(), e));
        } else {
            count += 1;
        }
    }
    
    if count == 0 && !errors.is_empty() {
        return Err(format!("Import failed. Errors:\n{}", errors.join("\n")));
    }
    
    let mut msg = format!("Successfully imported {} minutes.", count);
    if !warnings.is_empty() {
        msg.push_str("\n\nDuplicate tag/trash warnings:\n");
        msg.push_str(&warnings.join("\n"));
    }
    if !errors.is_empty() {
        msg.push_str("\n\nErrors encountered:\n");
        msg.push_str(&errors.join("\n"));
    }
    
    Ok(msg)
}

#[tauri::command]
pub async fn import_minutes_md_single(api: tauri::State<'_, crate::api::Api>, file_path: String, owner_id: i64, category_id: Option<i64>) -> Result<Option<String>, String> {
    let path = std::path::Path::new(&file_path);
    if !path.exists() {
        return Err("File does not exist.".to_string());
    }
    
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    
    let title_line = content.lines().find(|l| l.starts_with("# "));
    if title_line.is_none() {
        return Err("Missing '# Title' in the markdown file.".to_string());
    }
    let title = title_line.unwrap()[2..].trim().to_string();
    
    let extract_meta = |key: &str| -> Option<String> {
        let keys = match key {
            "Date" => vec!["Date", "날짜"],
            "Participants" => vec!["Participants", "참석자"],
            "Location" => vec!["Location", "장소"],
            "Tag" => vec!["Tag"],
            _ => vec![key],
        };
        
        for k in keys {
            for line in content.lines() {
                let clean_line = line.trim()
                    .trim_start_matches('>')
                    .trim_start_matches('-')
                    .trim_start_matches('*')
                    .trim();
                    
                if let Some(colon_idx) = clean_line.find(':') {
                    let key_part = clean_line[..colon_idx].trim().trim_matches('*').trim();
                    if key_part == k {
                        let mut val = clean_line[colon_idx + 1..].trim();
                        val = val.trim_start_matches('*').trim_end_matches('*').trim();
                        
                        let mut val_str = val.to_string();
                        if val_str.starts_with('`') && val_str.ends_with('`') && val_str.len() >= 2 {
                            val_str = val_str[1..val_str.len()-1].trim().to_string();
                        }
                        return Some(val_str);
                    }
                }
            }
        }
        None
    };
    
    let date = extract_meta("Date");
    let participants = extract_meta("Participants");
    let location = extract_meta("Location");
    let mut parsed_tag = extract_meta("Tag");
    if let Some(ref tag) = parsed_tag {
        if tag.trim().is_empty() {
            parsed_tag = None;
        }
    }
    
    let extract_section = |header: &str| -> Option<String> {
        let parts: Vec<&str> = content.split(&format!("## {}", header)).collect();
        if parts.len() > 1 {
            let section_content = parts[1].split("\n## ").next().unwrap_or(parts[1]);
            Some(section_content.trim().to_string())
        } else {
            None
        }
    };
    
    let decisions = extract_section("Decisions");
    let action_items = extract_section("Action Items");
    let memo = extract_section("Memo");
    
    let mut resolved_tag = parsed_tag.clone();
    let mut target_category_id = category_id;
    let mut warning_msg = None;
    let mut trash_deleted_msg = None;
    
    if let Some(ref tag_val) = parsed_tag {
        let minutes = api.minutes();
        let conn = minutes.storage.conn.lock().unwrap();
        
        // 1. Check if same tag exists in Trash Bin (is_deleted = 1)
        let trash_meetings: Vec<i64> = {
            let mut stmt = conn.prepare("SELECT id FROM meetings WHERE meeting_tag = ? AND is_deleted = 1").unwrap();
            let rows = stmt.query_map(params![tag_val], |r| r.get(0)).unwrap();
            rows.filter_map(|r| r.ok()).collect()
        };
        
        if !trash_meetings.is_empty() {
            for m_id in &trash_meetings {
                let _ = minutes.storage.delete_meeting_dual(&conn, *m_id);
            }
            trash_deleted_msg = Some(format!(
                "An identical meeting with tag '{}' in the Trash Bin has been permanently deleted.",
                tag_val
            ));
        }
        
        // 2. Check if same tag exists in active meetings (is_deleted = 0)
        let check_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM meetings WHERE meeting_tag = ? AND is_deleted = 0",
            params![tag_val],
            |row| row.get(0)
        ).unwrap_or(0);
        
        if check_count > 0 {
            target_category_id = None; // Force Uncategorized
            let mut suffix_counter = 1;
            loop {
                let candidate_tag = format!("{} ({})", tag_val, suffix_counter);
                let sub_count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM meetings WHERE meeting_tag = ? AND is_deleted = 0",
                    params![candidate_tag],
                    |row| row.get(0)
                ).unwrap_or(0);
                
                if sub_count == 0 {
                    resolved_tag = Some(candidate_tag);
                    break;
                }
                suffix_counter += 1;
            }
            warning_msg = Some(format!(
                "Tag '{}' already exists. This meeting has been imported to 'Uncategorized' with tag '{}'.",
                tag_val,
                resolved_tag.as_ref().unwrap()
            ));
        }
    }
    
    let meeting = crate::models::Meeting {
        id: None,
        owner_id: Some(owner_id),
        title,
        date,
        participants,
        location,
        decisions,
        action_items,
        memo,
        category_id: target_category_id,
        created_at: chrono::Utc::now().to_rfc3339(),
        meeting_tag: resolved_tag,
        is_deleted: false,
    };
    
    api.minutes().save_meeting(meeting).map_err(|e| e.to_string())?;
    
    let mut final_msg = Vec::new();
    if let Some(trash_msg) = trash_deleted_msg {
        final_msg.push(trash_msg);
    }
    if let Some(warn) = warning_msg {
        final_msg.push(warn);
    }
    
    if final_msg.is_empty() {
        Ok(None)
    } else {
        Ok(Some(final_msg.join("\n")))
    }
}

#[tauri::command]
pub async fn get_categories(api: tauri::State<'_, crate::api::Api>, owner_id: i64) -> Result<Vec<MeetingCategory>, String> {
    api.minutes().get_categories(owner_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_category(api: tauri::State<'_, crate::api::Api>, category: MeetingCategory) -> Result<i64, String> {
    api.minutes().save_category(category)
}

#[tauri::command]
pub async fn delete_category(api: tauri::State<'_, crate::api::Api>, category_id: i64) -> Result<(), String> {
    api.minutes().delete_category(category_id)
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("minutes")
        .invoke_handler(tauri::generate_handler![
            get_meeting_count,
            get_meetings,
            save_meeting,
            export_meeting_md,
            save_text_file,
            delete_meeting,
            get_deleted_meetings,
            restore_meeting,
            hard_delete_meeting_cmd,
            export_minutes_md_bulk,
            import_minutes_md_bulk,
            import_minutes_md_single,
            get_categories,
            save_category,
            delete_category
        ])
        .build()
}
