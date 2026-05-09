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

if __name__ == '__main__':
    init_db()
