import sqlite3
import os

base = os.environ.get('LOCALAPPDATA', os.path.expanduser('~'))
db_path = os.path.join(base, 'SJ_Kanban', 'sjkanban.db')

conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("PRAGMA table_info(meetings)")
cols = cursor.fetchall()
for col in cols:
    print(col)
conn.close()
