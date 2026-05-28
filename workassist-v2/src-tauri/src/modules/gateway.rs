use crate::storage::Storage;
use rusqlite::Result;
use std::sync::Arc;
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ShadowData {
    pub id: i64,
    pub title: Option<String>,
    pub content: Option<String>,
    pub extra: Option<String>,
}

pub struct GatewayModule {
    storage: Arc<Storage>,
}

impl GatewayModule {
    pub fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub fn get_all_shadow_tasks(&self) -> Result<Vec<ShadowData>> {
        let conn = self.storage.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, title, content, review_comment FROM tasks WHERE is_deleted = 0")?;
        let rows = stmt.query_map([], |row| {
            Ok(ShadowData {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                extra: row.get(3)?,
            })
        })?;
        
        let mut list = Vec::new();
        for r in rows { list.push(r?); }
        Ok(list)
    }

    pub fn detokenize(&self, text: &str) -> String {
        text.to_string()
    }
}

// --- Gateway Plugin Commands ---

#[tauri::command]
pub async fn get_ai_ready_tasks(api: tauri::State<'_, crate::api::Api>) -> Result<Vec<ShadowData>, String> {
    api.gateway().get_all_shadow_tasks().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn process_ai_response(api: tauri::State<'_, crate::api::Api>, response: String) -> Result<String, String> {
    Ok(api.gateway().detokenize(&response))
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("gateway")
        .invoke_handler(tauri::generate_handler![
            get_ai_ready_tasks,
            process_ai_response
        ])
        .build()
}
