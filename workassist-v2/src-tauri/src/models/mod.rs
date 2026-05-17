use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: Option<i64>,
    pub username: String,
    pub password_hash: String,
    pub password_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: Option<i64>,
    pub owner_id: Option<i64>,
    pub title: String,
    pub content: Option<String>,
    pub manager: Option<String>,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub status: String,
    pub is_urgent: bool,
    pub created_at: String,
    pub review_comment: Option<String>,
    pub task_tag: Option<String>,
    #[serde(default)]
    pub is_deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meeting {
    pub id: Option<i64>,
    pub owner_id: Option<i64>,
    pub title: String,
    pub date: Option<String>,
    pub participants: Option<String>,
    pub location: Option<String>,
    pub decisions: Option<String>, // JSON string in DB
    pub action_items: Option<String>, // JSON string in DB
    pub memo: Option<String>,
    pub created_at: String,
    pub meeting_tag: Option<String>,
    #[serde(default)]
    pub is_deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: Option<i64>,
    pub owner_id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub manager: Option<String>,
    pub client: Option<String>,
    pub created_at: String,
    pub status: String,
    pub dept1_name: String,
    pub dept2_name: String,
    pub dept3_name: String,
    pub dept4_name: String,
    pub project_tag: Option<String>,
    #[serde(default)]
    pub is_deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Milestone {
    pub id: Option<i64>,
    pub project_id: i64,
    pub slot_number: i32,
    pub name: Option<String>,
    pub deadline: Option<String>,
    pub content: Option<String>,
    pub is_saved: bool,
    pub is_done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusLog {
    pub id: Option<i64>,
    pub project_id: i64,
    pub department: String,
    pub text_content: Option<String>,
    pub image_path: Option<String>,
    pub timestamp: String,
    pub status: String,
    pub tag: Option<String>,
    pub title: Option<String>,
    pub manager: Option<String>,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    #[serde(default)]
    pub is_deleted: bool,
}
