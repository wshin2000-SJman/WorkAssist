pub const CREATE_USERS_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        password_hint TEXT
    );
";

pub const CREATE_MEETINGS_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS meetings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER,
        title TEXT NOT NULL,
        date TEXT,
        participants TEXT,
        location TEXT,
        decisions TEXT,
        action_items TEXT,
        memo TEXT,
        created_at TEXT NOT NULL,
        meeting_tag TEXT DEFAULT '',
        is_deleted BOOLEAN NOT NULL DEFAULT 0,
        FOREIGN KEY (owner_id) REFERENCES users(id)
    );
";

pub const CREATE_TASKS_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER,
        title TEXT NOT NULL,
        content TEXT,
        manager TEXT,
        start_date TEXT,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'Note',
        is_urgent BOOLEAN NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        review_comment TEXT DEFAULT '',
        task_tag TEXT DEFAULT '',
        is_deleted BOOLEAN NOT NULL DEFAULT 0,
        FOREIGN KEY (owner_id) REFERENCES users(id)
    );
";

pub const CREATE_PROJECTS_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER,
        name TEXT NOT NULL,
        description TEXT,
        manager TEXT,
        client TEXT,
        start_date TEXT,
        created_at TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        dept1_name TEXT DEFAULT '[DPT. 1]',
        dept2_name TEXT DEFAULT '[DPT. 2]',
        dept3_name TEXT DEFAULT '[DPT. 3]',
        dept4_name TEXT DEFAULT '[DPT. 4]',
        project_tag TEXT DEFAULT '',
        is_deleted BOOLEAN NOT NULL DEFAULT 0,
        completion_date TEXT,
        completion_memo TEXT,
        FOREIGN KEY (owner_id) REFERENCES users(id)
    );
";

pub const CREATE_MILESTONES_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS milestones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        slot_number INTEGER,
        name TEXT,
        deadline TEXT,
        content TEXT,
        is_saved BOOLEAN DEFAULT 0,
        is_done BOOLEAN DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        UNIQUE(project_id, slot_number)
    );
";

pub const CREATE_STATUS_LOGS_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS status_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        owner_id INTEGER,
        department TEXT NOT NULL,
        text_content TEXT,
        timestamp TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        tag TEXT,
        title TEXT,
        manager TEXT,
        start_date TEXT,
        due_date TEXT,
        is_deleted BOOLEAN NOT NULL DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (owner_id) REFERENCES users(id)
    );
";

pub const CREATE_SECURE_VAULT_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS secure_vault (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_text TEXT UNIQUE NOT NULL,
        token_id TEXT NOT NULL,
        entity_type TEXT NOT NULL
    );
";

pub const CREATE_SHADOW_MEETINGS_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS shadow_meetings (
        id INTEGER PRIMARY KEY, -- Matches original meeting ID
        title TEXT,
        participants TEXT,
        location TEXT,
        decisions TEXT,
        action_items TEXT,
        memo TEXT,
        meeting_tag TEXT
    );
";

pub const CREATE_SHADOW_TASKS_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS shadow_tasks (
        id INTEGER PRIMARY KEY, -- Matches original task ID
        title TEXT,
        content TEXT,
        review_comment TEXT,
        task_tag TEXT
    );
";

pub const CREATE_SHADOW_PROJECTS_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS shadow_projects (
        id INTEGER PRIMARY KEY, -- Matches original project ID
        name TEXT,
        description TEXT,
        project_tag TEXT,
        status TEXT,
        completion_date TEXT,
        completion_memo TEXT
    );
";

pub const CREATE_SHADOW_STATUS_LOGS_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS shadow_status_logs (
        id INTEGER PRIMARY KEY, -- Matches original status_log ID
        title TEXT,
        text_content TEXT,
        manager TEXT
    );
";

pub const CREATE_MEETING_CATEGORIES_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS meeting_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#3b82f6',
        order_seq INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (owner_id) REFERENCES users(id),
        UNIQUE(owner_id, name)
    );
";

pub const CREATE_SHADOW_MEETING_CATEGORIES_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS shadow_meeting_categories (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
    );
";
