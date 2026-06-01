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
        dept5_name TEXT DEFAULT '[DPT. 5]',
        dept6_name TEXT DEFAULT '[DPT. 6]',
        dept7_name TEXT DEFAULT '[DPT. 7]',
        dept8_name TEXT DEFAULT '[DPT. 8]',
        dept9_name TEXT DEFAULT '[DPT. 9]',
        dept10_name TEXT DEFAULT '[DPT. 10]',
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



pub const CREATE_SPECS_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS specs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        part_number TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL,
        manufacturer TEXT NOT NULL,
        catalog_name TEXT,
        description TEXT,
        spec_data TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
";

#[cfg(feature = "orders")]
pub const CREATE_ORDERS_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER,
        
        -- 수주매출 현황 (21개 컬럼 1-to-1 매칭)
        order_date TEXT,                    -- 수주일자 (Col 2, B)
        project_code TEXT,                  -- 프로젝트코드 (Col 3, C)
        category TEXT,                      -- 구분 (Col 4, D) (상품 / 제품)
        client TEXT NOT NULL,               -- 고객사 (Col 5, E)
        client_po_num TEXT,                 -- 고객 발주번호 (Col 6, F)
        product_name TEXT,                  -- 제품명 (Col 7, G)
        client_manager TEXT,                -- 고객 담당자 (Col 8, H)
        sales_manager TEXT,                 -- 영업담당자 (Col 9, I)
        request_date TEXT,                  -- 납품요청일 (Col 10, J)
        purchase_place TEXT,                -- 매입처 (Col 11, K)
        qty INTEGER,                        -- 수량 (Col 12, L)
        order_price INTEGER,                -- 수주단가 (Col 13, M)
        order_amount INTEGER,               -- 수주금액 (Col 14, N)
        estimate_delivery_date TEXT,        -- 납품 예정일 (Col 15, O)
        actual_delivery_date TEXT,          -- 실제 납품일 (Col 16, P)
        tax_invoice_1 TEXT,                 -- 1차 계산서 (Col 17, Q)
        tax_invoice_2 TEXT,                 -- 2차 계산서 (Col 18, R)
        settlement_1 INTEGER,               -- 1차 정산금 (Col 19, S)
        settlement_2 INTEGER,               -- 2차 정산금 (Col 20, T)
        description TEXT,                   -- 비고 (Col 21, U)
        
        status TEXT NOT NULL DEFAULT '대기', -- 진행상태
        created_at TEXT NOT NULL,
        is_deleted BOOLEAN NOT NULL DEFAULT 0
    );
";


