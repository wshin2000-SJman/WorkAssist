import sqlite3
import os

base = os.environ.get('LOCALAPPDATA', os.path.expanduser('~'))
DB_PATH = os.path.join(base, 'SJ_Kanban', 'sjkanban.db')

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
try:
    cursor.execute("PRAGMA table_info(milestones)")
    cols = cursor.fetchall()
    print("Columns in milestones:", [c[1] for c in cols])
    
    cursor.execute("SELECT * FROM milestones")
    rows = cursor.fetchall()
    print("Milestone rows:", rows)
except Exception as e:
    print("Error:", e)
conn.close()
