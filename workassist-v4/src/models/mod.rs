use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    #[serde(default)]
    pub id: Option<i64>,
    pub username: String,
    pub password_hash: String,
    #[serde(default)]
    pub password_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default)]
    pub owner_id: Option<i64>,
    pub title: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub manager: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub is_urgent: bool,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub review_comment: Option<String>,
    #[serde(default)]
    pub task_tag: Option<String>,
    #[serde(default)]
    pub is_deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingCategory {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default)]
    pub owner_id: Option<i64>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub order_seq: i32,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meeting {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default)]
    pub owner_id: Option<i64>,
    pub title: String,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub participants: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub decisions: Option<String>,
    #[serde(default)]
    pub action_items: Option<String>,
    #[serde(default)]
    pub memo: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub meeting_tag: Option<String>,
    #[serde(default)]
    pub category_id: Option<i64>,
    #[serde(default)]
    pub is_deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default)]
    pub owner_id: Option<i64>,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub manager: Option<String>,
    #[serde(default)]
    pub client: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub dept1_name: String,
    #[serde(default)]
    pub dept2_name: String,
    #[serde(default)]
    pub dept3_name: String,
    #[serde(default)]
    pub dept4_name: String,
    #[serde(default)]
    pub dept5_name: String,
    #[serde(default)]
    pub dept6_name: String,
    #[serde(default)]
    pub dept7_name: String,
    #[serde(default)]
    pub dept8_name: String,
    #[serde(default)]
    pub dept9_name: String,
    #[serde(default)]
    pub dept10_name: String,
    #[serde(default)]
    pub project_tag: Option<String>,
    #[serde(default)]
    pub is_deleted: bool,
    #[serde(default)]
    pub completion_date: Option<String>,
    #[serde(default)]
    pub completion_memo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Milestone {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default)]
    pub project_id: i64,
    #[serde(default)]
    pub slot_number: i32,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub deadline: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub is_saved: bool,
    #[serde(default)]
    pub is_done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusLog {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default)]
    pub project_id: i64,
    #[serde(default)]
    pub department: String,
    #[serde(default)]
    pub text_content: Option<String>,
    #[serde(default)]
    pub timestamp: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub manager: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub is_deleted: bool,
}
