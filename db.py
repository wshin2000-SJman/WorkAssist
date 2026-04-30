import sqlite3
import os
import datetime

def get_data_dir():
    """Get or create the SJ_Kanban data directory under LOCALAPPDATA."""
    base = os.environ.get('LOCALAPPDATA', os.path.expanduser('~'))
    data_dir = os.path.join(base, 'SJ_Kanban')
    os.makedirs(data_dir, exist_ok=True)
    return data_dir

DB_PATH = os.path.join(get_data_dir(), 'sjkanban.db')

def get_connection():
    return sqlite3.connect(DB_PATH)

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
    # Count tasks for this user created today (based on task_tag prefix)
    cursor.execute("SELECT COUNT(*) FROM tasks WHERE owner_id = ? AND task_tag LIKE ?", (owner_id, f"{date_prefix}%"))
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

if __name__ == '__main__':
    init_db()
