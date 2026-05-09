import sqlite3
import os
import datetime

def get_data_dir():
    """Get or create the SJ_WorkAssist data directory under LOCALAPPDATA."""
    base = os.environ.get('LOCALAPPDATA', os.path.expanduser('~'))
    data_dir = os.path.join(base, 'SJ_WorkAssist')
    os.makedirs(data_dir, exist_ok=True)
    return data_dir

DB_PATH = os.path.join(get_data_dir(), 'sjkanban.db')

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    
    # Create Users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            password_hint TEXT
        )
    ''')
    
    # Insert default tutorial user (PW: 1234)
    tutorial_hash = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4"
    cursor.execute('''
        INSERT OR IGNORE INTO users (username, password_hash, password_hint)
        VALUES (?, ?, ?)
    ''', ("tutorial", tutorial_hash, "The password is '1234'"))
    
    # Get tutorial_id for data insertion
    cursor.execute('SELECT id FROM users WHERE username = ?', ("tutorial",))
    tutorial_id = cursor.fetchone()[0]
    
    # Create Meetings table
    cursor.execute('''
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
            FOREIGN KEY (owner_id) REFERENCES users(id)
        )
    ''')

    # Migration: Add memo column if not exists
    cursor.execute("PRAGMA table_info(meetings)")
    columns = [col[1] for col in cursor.fetchall()]
    if 'memo' not in columns:
        cursor.execute("ALTER TABLE meetings ADD COLUMN memo TEXT")
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT,
            manager TEXT,
            start_date TEXT,
            due_date TEXT,
            status TEXT NOT NULL DEFAULT 'Note',
            is_urgent BOOLEAN NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )
    ''')
    
    # Migration: Add owner_id if it doesn't exist
    cursor.execute("PRAGMA table_info(tasks)")
    columns = [col[1] for col in cursor.fetchall()]
    if 'owner_id' not in columns:
        cursor.execute("ALTER TABLE tasks ADD COLUMN owner_id INTEGER DEFAULT NULL")
    if 'review_comment' not in columns:
        cursor.execute("ALTER TABLE tasks ADD COLUMN review_comment TEXT DEFAULT ''")
    if 'task_tag' not in columns:
        cursor.execute("ALTER TABLE tasks ADD COLUMN task_tag TEXT DEFAULT ''")
        
    # Create Projects table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER,
            name TEXT NOT NULL,
            description TEXT,
            manager TEXT,
            client TEXT,
            created_at TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            FOREIGN KEY (owner_id) REFERENCES users(id)
        )
    ''')

    # Migration for projects
    cursor.execute("PRAGMA table_info(projects)")
    columns = [col[1] for col in cursor.fetchall()]
    if 'status' not in columns:
        cursor.execute("ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'active'")
    if 'dept1_name' not in columns:
        cursor.execute("ALTER TABLE projects ADD COLUMN dept1_name TEXT DEFAULT '[DPT. 1]'")
    if 'dept2_name' not in columns:
        cursor.execute("ALTER TABLE projects ADD COLUMN dept2_name TEXT DEFAULT '[DPT. 2]'")
    if 'dept3_name' not in columns:
        cursor.execute("ALTER TABLE projects ADD COLUMN dept3_name TEXT DEFAULT '[DPT. 3]'")
    if 'dept4_name' not in columns:
        cursor.execute("ALTER TABLE projects ADD COLUMN dept4_name TEXT DEFAULT '[DPT. 4]'")

    # Create Milestones table
    cursor.execute('''
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
        )
    ''')

    cursor.execute("PRAGMA table_info(milestones)")
    columns = [col[1] for col in cursor.fetchall()]
    if 'is_done' not in columns:
        cursor.execute("ALTER TABLE milestones ADD COLUMN is_done BOOLEAN DEFAULT 0")

    # Create Status Logs table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS status_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            department TEXT NOT NULL,
            text_content TEXT,
            image_path TEXT,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    cursor.execute("PRAGMA table_info(status_logs)")
    columns = [col[1] for col in cursor.fetchall()]
    if 'status' not in columns:
        cursor.execute("ALTER TABLE status_logs ADD COLUMN status TEXT DEFAULT 'active'")
    if 'tag' not in columns:
        cursor.execute("ALTER TABLE status_logs ADD COLUMN tag TEXT")
    if 'title' not in columns:
        cursor.execute("ALTER TABLE status_logs ADD COLUMN title TEXT")
    if 'manager' not in columns:
        cursor.execute("ALTER TABLE status_logs ADD COLUMN manager TEXT")
    if 'start_date' not in columns:
        cursor.execute("ALTER TABLE status_logs ADD COLUMN start_date TEXT")
    if 'due_date' not in columns:
        cursor.execute("ALTER TABLE status_logs ADD COLUMN due_date TEXT")

    # Insert tutorial data
    _insert_tutorial_data(cursor, tutorial_id)

    conn.commit()
    conn.close()

# Milestone Methods
def get_milestones(project_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT slot_number, name, deadline, content, is_saved, is_done FROM milestones WHERE project_id = ? ORDER BY slot_number ASC", (project_id,))
    rows = cursor.fetchall()
    conn.close()
    
    milestones = []
    for row in rows:
        milestones.append({
            'slot_number': row[0],
            'name': row[1],
            'deadline': row[2],
            'content': row[3],
            'is_saved': bool(row[4]),
            'is_done': bool(row[5])
        })
    return milestones

def save_milestone(project_id, slot_number, name, deadline, content, is_saved, is_done=False):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO milestones (project_id, slot_number, name, deadline, content, is_saved, is_done)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, slot_number) DO UPDATE SET
            name=excluded.name,
            deadline=excluded.deadline,
            content=excluded.content,
            is_saved=excluded.is_saved,
            is_done=excluded.is_done
    ''', (project_id, slot_number, name, deadline, content, 1 if is_saved else 0, 1 if is_done else 0))
    conn.commit()
    conn.close()

def delete_milestone(project_id, slot_number):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM milestones WHERE project_id = ? AND slot_number = ?", (project_id, slot_number))
    conn.commit()
    conn.close()

# User Auth Methods
def create_user(username, password_hash, hint):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO users (username, password_hash, password_hint) VALUES (?, ?, ?)", 
                       (username, password_hash, hint))
        conn.commit()
        
        # If this is the first user, assign all orphaned tasks to them
        cursor.execute("SELECT COUNT(*) FROM users")
        if cursor.fetchone()[0] == 1:
            user_id = cursor.lastrowid
            cursor.execute("UPDATE tasks SET owner_id = ? WHERE owner_id IS NULL", (user_id,))
            conn.commit()
            
        return cursor.lastrowid
    except sqlite3.IntegrityError:
        return None # Username exists
    finally:
        conn.close()

def get_user(username):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, password_hash, password_hint FROM users WHERE username = ?", (username,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return {'id': row[0], 'password_hash': row[1], 'password_hint': row[2]}
    return None

def change_password(username, new_password_hash):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET password_hash = ? WHERE username = ?", (new_password_hash, username))
    conn.commit()
    conn.close()

# Task Methods
def get_all_tasks(owner_id=None):
    conn = get_connection()
    cursor = conn.cursor()
    
    if owner_id is not None:
        cursor.execute("SELECT id, title, content, manager, start_date, due_date, status, is_urgent, created_at, review_comment, task_tag FROM tasks WHERE owner_id = ?", (owner_id,))
    else:
        cursor.execute("SELECT id, title, content, manager, start_date, due_date, status, is_urgent, created_at, review_comment, task_tag FROM tasks")
        
    rows = cursor.fetchall()
    conn.close()
    
    tasks = []
    for row in rows:
        tasks.append({
            'id': row[0],
            'title': row[1],
            'content': row[2],
            'manager': row[3],
            'start_date': row[4],
            'due_date': row[5],
            'status': row[6],
            'is_urgent': bool(row[7]),
            'created_at': row[8],
            'review_comment': row[9] or '',
            'task_tag': row[10] or ''
        })
    return tasks

def get_next_tag_sequence(owner_id, date_prefix):
    conn = get_connection()
    cursor = conn.cursor()
    # Count tasks for this user created today (supporting both old and new formats)
    cursor.execute("SELECT COUNT(*) FROM tasks WHERE owner_id = ? AND (task_tag LIKE ? OR task_tag LIKE ?)", 
                   (owner_id, f"{date_prefix}%", f"T-{date_prefix}%"))
    count = cursor.fetchone()[0]
    conn.close()
    return count + 1

def add_task(title, content, manager, start_date, due_date, status='Note', is_urgent=False, owner_id=None, task_tag=''):
    conn = get_connection()
    cursor = conn.cursor()
    created_at = datetime.datetime.now().isoformat()
    cursor.execute('''
        INSERT INTO tasks (title, content, manager, start_date, due_date, status, is_urgent, created_at, owner_id, task_tag)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (title, content, manager, start_date, due_date, status, is_urgent, created_at, owner_id, task_tag))
    conn.commit()
    task_id = cursor.lastrowid
    conn.close()
    return task_id

def update_task_status(task_id, new_status):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE tasks SET status = ? WHERE id = ?", (new_status, task_id))
    conn.commit()
    conn.close()

def update_task_dates(task_id, start_date, due_date):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE tasks SET start_date = ?, due_date = ? WHERE id = ?", (start_date, due_date, task_id))
    conn.commit()
    conn.close()

def save_review_comment(task_id, comment):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE tasks SET review_comment = ? WHERE id = ?", (comment, task_id))
    conn.commit()
    conn.close()

def update_task_details(task_id, title, content, manager, start_date, due_date):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE tasks 
        SET title = ?, content = ?, manager = ?, start_date = ?, due_date = ? 
        WHERE id = ?
    ''', (title, content, manager, start_date, due_date, task_id))
    conn.commit()
    conn.close()

def delete_task(task_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()

def initialize_user_data(owner_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM tasks WHERE owner_id = ?", (owner_id,))
    conn.commit()
    conn.close()

# Meeting Methods
def get_all_meetings(owner_id=None):
    conn = get_connection()
    cursor = conn.cursor()
    if owner_id is not None:
        cursor.execute("SELECT id, title, date, participants, location, decisions, action_items, memo, created_at FROM meetings WHERE owner_id = ? ORDER BY date DESC", (owner_id,))
    else:
        cursor.execute("SELECT id, title, date, participants, location, decisions, action_items, memo, created_at FROM meetings ORDER BY date DESC")
    rows = cursor.fetchall()
    conn.close()
    
    meetings = []
    for row in rows:
        meetings.append({
            'id': row[0],
            'title': row[1],
            'date': row[2],
            'participants': row[3],
            'location': row[4],
            'decisions': row[5],
            'action_items': row[6],
            'memo': row[7],
            'created_at': row[8]
        })
    return meetings

def add_meeting(owner_id, title, date, participants, location, decisions, action_items, memo):
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    cursor.execute('''
        INSERT INTO meetings (owner_id, title, date, participants, location, decisions, action_items, memo, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (owner_id, title, date, participants, location, decisions, action_items, memo, now))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return new_id

def update_meeting(meeting_id, title, date, participants, location, decisions, action_items, memo):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE meetings 
        SET title = ?, date = ?, participants = ?, location = ?, decisions = ?, action_items = ?, memo = ?
        WHERE id = ?
    ''', (title, date, participants, location, decisions, action_items, memo, meeting_id))
    conn.commit()
    conn.close()

def delete_meeting(meeting_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM meetings WHERE id = ?", (meeting_id,))
    conn.commit()
    conn.close()

# Project Manager Methods
def get_all_projects(owner_id=None, status='active'):
    conn = get_connection()
    cursor = conn.cursor()
    if owner_id is not None:
        cursor.execute("SELECT id, name, description, manager, client, created_at, status, dept1_name, dept2_name, dept3_name, dept4_name FROM projects WHERE owner_id = ? AND status = ? ORDER BY created_at DESC", (owner_id, status))
    else:
        cursor.execute("SELECT id, name, description, manager, client, created_at, status, dept1_name, dept2_name, dept3_name, dept4_name FROM projects WHERE status = ? ORDER BY created_at DESC", (status,))
    rows = cursor.fetchall()
    conn.close()
    
    projects = []
    for row in rows:
        projects.append({
            'id': row[0],
            'name': row[1],
            'description': row[2] or '',
            'manager': row[3] or '',
            'client': row[4] or '',
            'created_at': row[5],
            'status': row[6] or 'active',
            'dept1_name': row[7] or '[DPT. 1]',
            'dept2_name': row[8] or '[DPT. 2]',
            'dept3_name': row[9] or '[DPT. 3]',
            'dept4_name': row[10] or '[DPT. 4]'
        })
    return projects

def add_project(owner_id, name, description, manager, client):
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    cursor.execute('''
        INSERT INTO projects (owner_id, name, description, manager, client, created_at, dept1_name, dept2_name, dept3_name, dept4_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (owner_id, name, description, manager, client, now, '[DPT. 1]', '[DPT. 2]', '[DPT. 3]', '[DPT. 4]'))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return new_id

def get_project_by_id(project_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, description, manager, client, created_at, status, dept1_name, dept2_name, dept3_name, dept4_name FROM projects WHERE id = ?", (project_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    return {
        'id': row[0],
        'name': row[1],
        'description': row[2] or '',
        'manager': row[3] or '',
        'client': row[4] or '',
        'created_at': row[5],
        'status': row[6] or 'active',
        'dept1_name': row[7] or '[DPT. 1]',
        'dept2_name': row[8] or '[DPT. 2]',
        'dept3_name': row[9] or '[DPT. 3]',
        'dept4_name': row[10] or '[DPT. 4]'
    }

def update_project(project_id, name, description, manager, client, dept1_name, dept2_name, dept3_name, dept4_name):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE projects 
        SET name = ?, description = ?, manager = ?, client = ?, 
            dept1_name = ?, dept2_name = ?, dept3_name = ?, dept4_name = ?
        WHERE id = ?
    ''', (name, description, manager, client, dept1_name, dept2_name, dept3_name, dept4_name, project_id))
    conn.commit()
    conn.close()

def delete_project(project_id):
    conn = get_connection()
    cursor = conn.cursor()
    # Now mark as 'deleted' status instead of physical deletion
    cursor.execute("UPDATE projects SET status = 'deleted' WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()

def delete_project_permanent(project_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM status_logs WHERE project_id = ?", (project_id,))
    cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()

def update_project_status(project_id, status):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE projects SET status = ? WHERE id = ?", (status, project_id))
    conn.commit()
    conn.close()

def get_status_logs(project_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, department, text_content, image_path, timestamp, status, tag, title, manager, start_date, due_date FROM status_logs WHERE project_id = ? ORDER BY timestamp ASC", (project_id,))
    rows = cursor.fetchall()
    conn.close()
    
    logs = []
    for row in rows:
        logs.append({
            'id': row[0],
            'department': row[1],
            'text_content': row[2] or '',
            'image_path': row[3] or '',
            'timestamp': row[4],
            'status': row[5] or 'active',
            'tag': row[6] or '',
            'title': row[7] or '',
            'manager': row[8] or '',
            'start_date': row[9] or '',
            'due_date': row[10] or ''
        })
    return logs

def get_next_tag_serial(date_str):
    """Returns the next serial number for a given date (YY/MM/DD)."""
    conn = get_connection()
    cursor = conn.cursor()
    # Find the max serial for today's date
    cursor.execute("SELECT tag FROM status_logs WHERE tag LIKE ?", (f'L-{date_str}-%',))
    tags = cursor.fetchall()
    conn.close()
    
    max_serial = 0
    for row in tags:
        tag = row[0]
        if tag:
            parts = tag.split('-')
            if len(parts) == 3:
                try:
                    serial = int(parts[2])
                    if serial > max_serial:
                        max_serial = serial
                except ValueError:
                    continue
    return max_serial + 1

def add_status_log(project_id, department, text_content, image_path, tag=None, title='', manager='', start_date='', due_date=''):
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    cursor.execute('''
        INSERT INTO status_logs (project_id, department, text_content, image_path, timestamp, tag, title, manager, start_date, due_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (project_id, department, text_content, image_path, now, tag, title, manager, start_date, due_date))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return new_id

def delete_status_log(log_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE status_logs SET status = 'deleted' WHERE id = ?", (log_id,))
    conn.commit()
    conn.close()

def delete_status_log_permanent(log_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM status_logs WHERE id = ?", (log_id,))
    conn.commit()
    conn.close()

def update_status_log_state(log_id, status):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE status_logs SET status = ? WHERE id = ?", (status, log_id))
    conn.commit()
    conn.close()

def update_status_log_full(log_id, title, content, manager, start, due, image):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE status_logs 
        SET title = ?, text_content = ?, manager = ?, start_date = ?, due_date = ?, image_path = ?
        WHERE id = ?
    ''', (title, content, manager, start, due, image, log_id))
    conn.commit()
    conn.close()

def _insert_tutorial_data(cursor, tutorial_id):
    # Check if data already exists for this user
    cursor.execute('SELECT COUNT(*) FROM tasks WHERE owner_id = ?', (tutorial_id,))
    if cursor.fetchone()[0] > 0:
        return

    import json
    tutorial_json = '''{
    "tasks": [
        {
            "title": "해야 할 일 메모는 Note에",
            "content": "해야 할 일 메모는 Note에 하세요. 필요시 To-do 또는 Doing 섹션으로 드래그 & 드랍 하여 상태를 변경시킬 수 있습니다.",
            "manager": "홍길동",
            "start_date": "2026-05-13",
            "due_date": "2026-05-13",
            "status": "Note",
            "is_urgent": 0,
            "created_at": "2026-05-10T00:18:20.496462",
            "review_comment": "",
            "task_tag": "T-26/05/10-001"
        },
        {
            "title": "해야 할 일, To-do에",
            "content": "이번주에 진행할 업무를 To-do 리스트로 관리하세요. Task의 상태는 언제든지 Drag & Drop으로 변경 가능합니다.",
            "manager": "홍길동",
            "start_date": "2026-05-14",
            "due_date": "2026-05-18",
            "status": "To-do",
            "is_urgent": 0,
            "created_at": "2026-05-10T00:19:07.432506",
            "review_comment": "",
            "task_tag": "T-26/05/10-002"
        },
        {
            "title": "진행중인 일은 Doing에",
            "content": "진행중인 일은 Doing에서 관리하세요. \\n완료된 업무는 Review 단계로 Drag & Drop하시면 됩니다.",
            "manager": "홍길동",
            "start_date": "2026-05-10",
            "due_date": "2026-05-10",
            "status": "Doing",
            "is_urgent": 0,
            "created_at": "2026-05-10T00:19:42.777572",
            "review_comment": "",
            "task_tag": "T-26/05/10-003"
        },
        {
            "title": "긴급 업무는 Urgent Task",
            "content": "긴급 업무는 Urgent 버튼을 눌러 생성 가능합니다. 긴급 업무의 경우 곧바로 Doing 섹션에 생성됩니다. 업무 완료시 Review 섹션으로 Drag & Drop하여 완료처리하시면 됩니다.",
            "manager": "홍길동",
            "start_date": "2026-05-12",
            "due_date": "2026-05-12",
            "status": "Doing",
            "is_urgent": 1,
            "created_at": "2026-05-10T00:20:41.216951",
            "review_comment": "",
            "task_tag": "T-26/05/10-004"
        },
        {
            "title": "완료된 일은 Review 후 Done",
            "content": "완료된 업무는 반드시 Review 후 Done(완료) 처리 하세요. 완료 처리시 검토자의 첨언이 반드시 필요합니다.",
            "manager": "홍길동",
            "start_date": "2026-05-10",
            "due_date": "2026-05-10",
            "status": "Review",
            "is_urgent": 0,
            "created_at": "2026-05-10T00:21:25.736979",
            "review_comment": "",
            "task_tag": "T-26/05/10-005"
        },
        {
            "title": "완료된 업무는 Done 리스트로 확인",
            "content": "완료된 업무는 Done 리스트로 확인 가능하며, 리스트는 csv로 내보내기 가능합니다.",
            "manager": "홍길동",
            "start_date": "2026-05-04",
            "due_date": "2026-05-04",
            "status": "Done",
            "is_urgent": 0,
            "created_at": "2026-05-10T00:21:53.361377",
            "review_comment": "[2026. 5. 10. 오전 12:22:03] Reviewer:: 김리뷰\\n검토 완료.",
            "task_tag": "T-26/05/10-006"
        },
        {
            "title": "삭제된 업무는 휴지통에서 확인",
            "content": "삭제된 업무는 휴지통에서 확인 가능합니다.",
            "manager": "홍길동",
            "start_date": "2026-05-10",
            "due_date": "2026-05-10",
            "status": "Deleted",
            "is_urgent": 0,
            "created_at": "2026-05-10T00:22:55.560851",
            "review_comment": "",
            "task_tag": "T-26/05/10-007"
        }
    ],
    "meetings": [
        {
            "title": "회의록 작성기입니다",
            "date": "2026-05-10",
            "participants": "홍길동",
            "location": "대회의실",
            "decisions": "[{\\"issue\\":\\"이슈 및 아젠다 섹션\\",\\"decision\\":\\"결정사항 섹션\\",\\"reason\\":\\"결정 근거 섹션\\"}]",
            "action_items": "[{\\"title\\":\\"액션 아이템 섹션\\",\\"content\\":\\"액션 아이템의 내용을 기록. 액션 아이템은 '[TASK EXPORT]' 버튼을 통해서 Task Mngr.로 내보낼 수 있음.\\",\\"manager\\":\\"홍길동\\",\\"start_date\\":\\"2026-05-10\\",\\"due_date\\":\\"2026-05-10\\"}]",
            "memo": "자유로운 메모를 적는 섹션입니다.\\n오른쪽 Live Preview 섹션에서 현재 작성중인 회의록을 실시간으로 확인할 수 있습니다. \\n\\n완료된 회의록은 SAVE 또는 Reset 가능합니다. \\n완료된 회의록은 마크다운(Markdown) 형식으로 클립보드에 붙여넣거나 내보낼 수 있습니다.",
            "created_at": "2026-05-10 00:25:04"
        }
    ],
    "projects": [
        {
            "name": "프로젝트 관리 기능입니다.",
            "description": "간트차트 형식으로 프로젝트를 관리할 수 있는 기능입니다. 담당부서는 최대 4개, 마일스톤은 최대 10개까지 등록 가능합니다.\\nTime Table은 주간/월간 형태로 확인 가능하며 HTML 형태로 내보낼 수 있습니다. ",
            "manager": "홍길동",
            "client": "김고객",
            "created_at": "2026-05-10 00:26:49",
            "status": "active",
            "dept1_name": "요리사",
            "dept2_name": "알바생",
            "dept3_name": "카운터",
            "dept4_name": "사장님",
            "logs": [
                {
                    "department": "Mech",
                    "text_content": "요리",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:30:16",
                    "status": "active",
                    "tag": "L-26/05/10-001",
                    "title": "밑반찬 만들기",
                    "manager": "김요리",
                    "start_date": "2026-05-11",
                    "due_date": "2026-05-11"
                },
                {
                    "department": "Mech",
                    "text_content": "식재료 구매",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:30:34",
                    "status": "done",
                    "tag": "L-26/05/10-002",
                    "title": "장보기",
                    "manager": "김요리",
                    "start_date": "2026-05-04",
                    "due_date": "2026-05-07"
                },
                {
                    "department": "Mech",
                    "text_content": "쌀밥 보리밥",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:31:00",
                    "status": "active",
                    "tag": "L-26/05/10-003",
                    "title": "밥 짓기",
                    "manager": "김요리",
                    "start_date": "2026-05-25",
                    "due_date": "2026-06-03"
                },
                {
                    "department": "Mech",
                    "text_content": "요리",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:31:45",
                    "status": "active",
                    "tag": "L-26/05/10-004",
                    "title": "메인반찬 만들기",
                    "manager": "김요리",
                    "start_date": "2026-06-16",
                    "due_date": "2026-06-26"
                },
                {
                    "department": "Control",
                    "text_content": "청소",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:32:12",
                    "status": "active",
                    "tag": "L-26/05/10-005",
                    "title": "바닥청소",
                    "manager": "김알바",
                    "start_date": "2026-05-05",
                    "due_date": "2026-05-08"
                },
                {
                    "department": "Control",
                    "text_content": "청소",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:32:22",
                    "status": "active",
                    "tag": "L-26/05/10-006",
                    "title": "냉장고 청소",
                    "manager": "김알바",
                    "start_date": "2026-05-18",
                    "due_date": "2026-05-27"
                },
                {
                    "department": "Control",
                    "text_content": "청소",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:32:43",
                    "status": "active",
                    "tag": "L-26/05/10-007",
                    "title": "가스렌지 청소",
                    "manager": "김알바",
                    "start_date": "2026-06-03",
                    "due_date": "2026-06-19"
                },
                {
                    "department": "Control",
                    "text_content": "삭제",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:33:17",
                    "status": "deleted",
                    "tag": "L-26/05/10-008",
                    "title": "삭제기능 테스트",
                    "manager": "김알바",
                    "start_date": "2026-04-27",
                    "due_date": "2026-05-06"
                },
                {
                    "department": "Elec",
                    "text_content": "계산",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:33:42",
                    "status": "active",
                    "tag": "L-26/05/10-009",
                    "title": "계산하기",
                    "manager": "김카운터",
                    "start_date": "2026-05-05",
                    "due_date": "2026-05-22"
                },
                {
                    "department": "Elec",
                    "text_content": "스트라이크",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:34:01",
                    "status": "deleted",
                    "tag": "L-26/05/10-010",
                    "title": "카운터 스트라이크",
                    "manager": "김카운터",
                    "start_date": "2026-05-19",
                    "due_date": "2026-06-26"
                },
                {
                    "department": "Elec",
                    "text_content": "더더더",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:34:28",
                    "status": "active",
                    "tag": "L-26/05/10-011",
                    "title": "더 많이 계산하기",
                    "manager": "김카운터",
                    "start_date": "2026-06-09",
                    "due_date": "2026-06-12"
                },
                {
                    "department": "Elec",
                    "text_content": "펀치",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:34:45",
                    "status": "active",
                    "tag": "L-26/05/10-012",
                    "title": "카운터 펀치",
                    "manager": "김카운터",
                    "start_date": "2026-06-22",
                    "due_date": "2026-06-30"
                },
                {
                    "department": "Sales",
                    "text_content": "투자",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:35:12",
                    "status": "done",
                    "tag": "L-26/05/10-013",
                    "title": "투자유치",
                    "manager": "김사장",
                    "start_date": "2026-04-13",
                    "due_date": "2026-04-17"
                },
                {
                    "department": "Sales",
                    "text_content": "미팅",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:35:44",
                    "status": "active",
                    "tag": "L-26/05/10-014",
                    "title": "고객사 미팅",
                    "manager": "김사장",
                    "start_date": "2026-05-01",
                    "due_date": "2026-05-13"
                },
                {
                    "department": "Sales",
                    "text_content": "회식",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:36:03",
                    "status": "active",
                    "tag": "L-26/05/10-015",
                    "title": "독려 회식",
                    "manager": "김사장",
                    "start_date": "2026-06-03",
                    "due_date": "2026-06-03"
                },
                {
                    "department": "Sales",
                    "text_content": "회식",
                    "image_path": "",
                    "timestamp": "2026-05-10 00:36:22",
                    "status": "active",
                    "tag": "L-26/05/10-016",
                    "title": "과제 종결회식",
                    "manager": "김사장",
                    "start_date": "2026-06-30",
                    "due_date": "2026-06-30"
                }
            ],
            "milestones": [
                {
                    "slot_number": 1,
                    "name": "1차 테스트",
                    "deadline": "2026-05-15",
                    "content": "1차 테스트 하기",
                    "is_saved": 1,
                    "is_done": 0
                },
                {
                    "slot_number": 2,
                    "name": "2차 테스트",
                    "deadline": "2026-06-01",
                    "content": "2차 테스트 하기",
                    "is_saved": 1,
                    "is_done": 0
                },
                {
                    "slot_number": 3,
                    "name": "최종 점검회의",
                    "deadline": "2026-06-24",
                    "content": "최종 점검 회의",
                    "is_saved": 1,
                    "is_done": 0
                }
            ]
        },
        {
            "name": "완료된 프로젝트는 완료리스트에",
            "description": "김완료",
            "manager": "김완료",
            "client": "김완료",
            "created_at": "2026-05-10 00:36:51",
            "status": "done",
            "dept1_name": "[DPT. 1]",
            "dept2_name": "[DPT. 2]",
            "dept3_name": "[DPT. 3]",
            "dept4_name": "[DPT. 4]",
            "logs": [],
            "milestones": []
        },
        {
            "name": "삭제된 프로젝트는 삭제 리스트에",
            "description": "김삭제",
            "manager": "김삭제",
            "client": "김삭제",
            "created_at": "2026-05-10 00:37:16",
            "status": "deleted",
            "dept1_name": "[DPT. 1]",
            "dept2_name": "[DPT. 2]",
            "dept3_name": "[DPT. 3]",
            "dept4_name": "[DPT. 4]",
            "logs": [],
            "milestones": []
        }
    ]
}'''
    data = json.loads(tutorial_json)
    
    # Insert Tasks
    for t in data['tasks']:
        cursor.execute('''
            INSERT INTO tasks (title, content, manager, start_date, due_date, status, is_urgent, created_at, review_comment, task_tag, owner_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (t['title'], t['content'], t['manager'], t['start_date'], t['due_date'], t['status'], t['is_urgent'], t['created_at'], t['review_comment'], t['task_tag'], tutorial_id))
        
    # Insert Meetings
    for m in data['meetings']:
        cursor.execute('''
            INSERT INTO meetings (owner_id, title, date, participants, location, decisions, action_items, memo, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (tutorial_id, m['title'], m['date'], m['participants'], m['location'], m['decisions'], m['action_items'], m['memo'], m['created_at']))
        
    # Insert Projects
    for p in data['projects']:
        cursor.execute('''
            INSERT INTO projects (owner_id, name, description, manager, client, created_at, status, dept1_name, dept2_name, dept3_name, dept4_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (tutorial_id, p['name'], p['description'], p['manager'], p['client'], p['created_at'], p['status'], p['dept1_name'], p['dept2_name'], p['dept3_name'], p['dept4_name']))
        project_id = cursor.lastrowid
        
        # Logs
        for l in p['logs']:
            cursor.execute('''
                INSERT INTO status_logs (project_id, department, text_content, image_path, timestamp, status, tag, title, manager, start_date, due_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (project_id, l['department'], l['text_content'], l['image_path'], l['timestamp'], l['status'], l['tag'], l['title'], l['manager'], l['start_date'], l['due_date']))
            
        # Milestones
        for ms in p['milestones']:
            cursor.execute('''
                INSERT INTO milestones (project_id, slot_number, name, deadline, content, is_saved, is_done)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (project_id, ms['slot_number'], ms['name'], ms['deadline'], ms['content'], ms['is_saved'], ms['is_done']))

if __name__ == '__main__':
    init_db()
