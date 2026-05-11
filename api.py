import db
import json
import os
import io
import base64
import hashlib
import shutil
import uuid

import webview
HAS_OPENPYXL = False

from version import VERSION

def hash_password(password):
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

class API:
    def __init__(self):
        db.init_db()
        self.current_user_id = None
        self.APP_VERSION = VERSION
        self.window = None

    def set_window(self, window):
        self.window = window

    def select_folder(self):
        if not self.window:
            return None
        import webview
        result = self.window.create_file_dialog(webview.FOLDER_DIALOG)
        if result and len(result) > 0:
            return result[0]
        return None

    def get_app_version(self):
        return self.APP_VERSION

    # Auth API
    def register(self, username, password, hint):
        user_id = db.create_user(username, hash_password(password), hint)
        if user_id:
            return {'status': 'success'}
        return {'status': 'error', 'message': 'Username already exists'}

    def login(self, username, password):
        user = db.get_user(username)
        if not user:
            return {'status': 'error', 'message': 'User does not exist'}
        if user['password_hash'] != hash_password(password):
            return {'status': 'error', 'message': 'Incorrect password'}
        
        self.current_user_id = user['id']
        return {'status': 'success'}

    def logout(self):
        self.current_user_id = None
        return {'status': 'success'}

    def get_hint(self, username):
        user = db.get_user(username)
        if user:
            return {'status': 'success', 'hint': user['password_hint']}
        return {'status': 'error', 'message': 'User not found'}

    def change_password(self, username, old_password, new_password):
        user = db.get_user(username)
        if user and user['password_hash'] == hash_password(old_password):
            db.change_password(username, hash_password(new_password))
            return {'status': 'success'}
        return {'status': 'error', 'message': 'Invalid ID or Password'}

    # Task API
    def get_tasks(self):
        if self.current_user_id is None:
            return []
        return db.get_all_tasks(self.current_user_id)

    def add_task(self, data):
        if self.current_user_id is None:
            return {'status': 'error', 'message': 'Not logged in'}
            
        import datetime
        today = datetime.datetime.now()
        date_prefix = today.strftime('%y/%m/%d')
        seq = db.get_next_tag_sequence(self.current_user_id, date_prefix)
        
        if seq > 999:
            return {'status': 'error', 'message': 'tag_limit_exceeded'}
            
        task_tag = f"T-{date_prefix}-{seq:03d}"
        
        title = data.get('title', 'Untitled')
        content = data.get('content', '')
        manager = data.get('manager', '')
        start_date = data.get('start_date', '')
        due_date = data.get('due_date', '')
        status = data.get('status', 'Note')
        is_urgent = data.get('is_urgent', False)
        
        task_id = db.add_task(title, content, manager, start_date, due_date, status, is_urgent, self.current_user_id, task_tag)
        return {'status': 'success', 'id': task_id}

    def update_task_status(self, task_id, new_status):
        db.update_task_status(task_id, new_status)
        return {'status': 'success'}

    def save_review_and_complete(self, task_id, comment):
        db.save_review_comment(task_id, comment)
        db.update_task_status(task_id, 'Done')
        return {'status': 'success'}

    def update_task_dates(self, task_id, start_date, due_date):
        db.update_task_dates(task_id, start_date, due_date)
        return {'status': 'success'}

    def update_task_details(self, task_id, data):
        title = data.get('title')
        content = data.get('content')
        manager = data.get('manager')
        start_date = data.get('start_date')
        due_date = data.get('due_date')
        db.update_task_details(task_id, title, content, manager, start_date, due_date)
        return {'status': 'success'}

    def delete_task(self, task_id):
        db.delete_task(task_id)
        return {'status': 'success'}

    def initialize_data(self):
        if self.current_user_id is None:
            return {'status': 'error', 'message': 'Not logged in'}
        db.initialize_user_data(self.current_user_id)
        return {'status': 'success'}

    def export_csv(self):
        if self.current_user_id is None:
            return {'status': 'error', 'message': 'Not logged in'}
            
        tasks = db.get_all_tasks(self.current_user_id)
        
        # Determine the user's desktop path to save the export
        desktop_path = os.path.join(os.path.join(os.environ['USERPROFILE']), 'Desktop')
        export_file = os.path.join(desktop_path, 'SJKanban_Export.csv')
        
        # Write to CSV with UTF-8 BOM for Excel compatibility
        with open(export_file, mode='w', newline='', encoding='utf-8-sig') as f:
            writer = csv.writer(f)
            writer.writerow(['ID', 'Title', 'Content', 'Manager', 'Start Date', 'Due Date', 'Status', 'Urgent', 'Created At'])
            for t in tasks:
                writer.writerow([
                    t['id'], t['title'], t['content'], t['manager'], 
                    t['start_date'], t['due_date'], t['status'], 
                    'Yes' if t['is_urgent'] else 'No', t['created_at']
                ])
        
        return {'status': 'success', 'path': export_file}

    # Meeting API
    def get_meetings(self):
        if self.current_user_id is None:
            return []
        return db.get_all_meetings(self.current_user_id)

    def save_meeting(self, data):
        if self.current_user_id is None:
            return {'status': 'error', 'message': 'Not logged in'}
        
        meeting_id = data.get('id')
        title = data.get('title', 'Untitled')
        date = data.get('date', '')
        participants = data.get('participants', '')
        location = data.get('location', '')
        decisions = data.get('decisions', '[]')
        action_items = data.get('action_items', '[]')
        memo = data.get('memo', '')
        
        if meeting_id:
            db.update_meeting(meeting_id, title, date, participants, location, decisions, action_items, memo)
            return {'status': 'success', 'id': meeting_id}
        else:
            new_id = db.add_meeting(self.current_user_id, title, date, participants, location, decisions, action_items, memo)
            return {'status': 'success', 'id': new_id}

    def delete_meeting(self, meeting_id):
        db.delete_meeting(meeting_id)
        return {'status': 'success'}

    def _generate_md_and_save(self, data, save_dir):
        import datetime
        import json
        
        # Determine filename: YYYYMMDD_(회의록)_제목.md
        try:
            date_obj = datetime.datetime.strptime(data['date'], '%Y-%m-%d')
            date_str = date_obj.strftime('%Y%m%d')
        except:
            date_str = "00000000"
            
        safe_title = "".join([c for c in data['title'] if c.isalnum() or c in (' ', '_', '-')]).rstrip()
        filename = f"{date_str}_(회의록)_{safe_title}.md"
        
        os.makedirs(save_dir, exist_ok=True)
        export_file = os.path.join(save_dir, filename)
        
        # Construct Markdown content
        decisions = json.loads(data['decisions'] if isinstance(data['decisions'], str) else '[]')
        action_items = json.loads(data['action_items'] if isinstance(data['action_items'], str) else '[]')
        
        md_content = f"# 📝 {data['title']}\n\n"
        md_content += f"**날짜:** {data['date']}\n"
        md_content += f"**장소:** {data['location']}\n"
        md_content += f"**참석자:** {data['participants']}\n\n"
        
        if data.get('memo'):
            md_content += f"## 📝 Free Memo\n{data['memo']}\n\n"
        
        md_content += "## 💡 주요 결정 사항\n"
        if decisions:
            for d in decisions:
                md_content += f"- **{d['issue']}**\n"
                md_content += f"  - 결정: {d['decision']}\n"
                md_content += f"  - 근거: {d['reason']}\n"
        else:
            md_content += "*(없음)*\n"
            
        md_content += "\n## ✅ Action Items\n"
        if action_items:
            md_content += "| 할 일 | 담당자 | 기한 |\n"
            md_content += "| :--- | :--- | :--- |\n"
            for a in action_items:
                md_content += f"| {a['task']} | {a['owner']} | {a['due_date']} |\n"
        else:
            md_content += "*(없음)*\n"
            
        md_content += f"\n---\n*Created by SJ WorkAssist at {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*"
        
        with open(export_file, mode='w', encoding='utf-8') as f:
            f.write(md_content)
            
        return export_file

    def export_meeting_md(self, data):
        # Determine save directory
        save_dir = data.get('save_dir')
        if not save_dir:
            desktop_path = os.path.join(os.path.join(os.environ['USERPROFILE']), 'Desktop')
            save_dir = os.path.join(desktop_path, 'SJ_Meetings')
        
        path = self._generate_md_and_save(data, save_dir)
        return {'status': 'success', 'path': path}

    def export_all_meetings_md(self, save_dir):
        if self.current_user_id is None:
            return {'status': 'error', 'message': 'Not logged in'}
            
        meetings = db.get_all_meetings(self.current_user_id)
        if not meetings:
            return {'status': 'success', 'count': 0}

        count = 0
        for m in meetings:
            self._generate_md_and_save(m, save_dir)
            count += 1
            
        return {'status': 'success', 'count': count}

    # Project Manager API
    def get_projects(self, status='active'):
        if self.current_user_id is None:
            return []
        return db.get_all_projects(self.current_user_id, status)

    def save_project(self, data):
        if self.current_user_id is None:
            return {'status': 'error', 'message': 'Not logged in'}
        
        project_id = data.get('id')
        name = data.get('name', 'Untitled Project')
        description = data.get('description', '')
        manager = data.get('manager', '')
        client = data.get('client', '')
        dept1 = data.get('dept1_name', '[DPT. 1]')
        dept2 = data.get('dept2_name', '[DPT. 2]')
        dept3 = data.get('dept3_name', '[DPT. 3]')
        dept4 = data.get('dept4_name', '[DPT. 4]')
        
        if project_id:
            db.update_project(project_id, name, description, manager, client, dept1, dept2, dept3, dept4)
            return {'status': 'success', 'id': project_id}
        else:
            # Note: add_project in db.py doesn't take depts yet, it uses defaults. 
            # But I updated db.py to take depts if I wanted to, but the current add_project in db.py uses hardcoded defaults.
            # Wait, I updated add_project in db.py to take values? No, I just updated the INSERT.
            new_id = db.add_project(self.current_user_id, name, description, manager, client)
            return {'status': 'success', 'id': new_id}

    def delete_project(self, project_id):
        db.delete_project(project_id)
        return {'status': 'success'}

    def delete_project_permanent(self, project_id):
        db.delete_project_permanent(project_id)
        return {'status': 'success'}

    def mark_project_done(self, project_id):
        db.update_project_status(project_id, 'done')
        return {'status': 'success'}

    def restore_project(self, project_id):
        db.update_project_status(project_id, 'active')
        return {'status': 'success'}

    def get_status_logs(self, project_id):
        return db.get_status_logs(project_id)

    def save_status_log(self, data):
        project_id = data.get('project_id')
        department = data.get('department')
        text_content = data.get('text_content', '')
        image_path = data.get('image_path', '')
        title = data.get('title', '')
        manager = data.get('manager', '')
        start_date = data.get('start_date', '')
        due_date = data.get('due_date', '')
        
        # Generate tag: L-YY/MM/DD-###
        import datetime
        now = datetime.datetime.now()
        date_str = now.strftime('%y/%m/%d')
        serial = db.get_next_tag_serial(date_str)
        tag = f"L-{date_str}-{serial:03d}"
        
        new_id = db.add_status_log(project_id, department, text_content, image_path, tag, title, manager, start_date, due_date)
        return {'status': 'success', 'id': new_id, 'tag': tag}

    def update_status_log(self, data):
        log_id = data.get('id')
        title = data.get('title', '')
        text_content = data.get('text_content', '')
        manager = data.get('manager', '')
        start_date = data.get('start_date', '')
        due_date = data.get('due_date', '')
        image_path = data.get('image_path', '')
        
        db.update_status_log_full(log_id, title, text_content, manager, start_date, due_date, image_path)
        return {'status': 'success'}

    def delete_status_log(self, log_id):
        db.delete_status_log(log_id)
        return {'status': 'success'}

    def delete_status_log_permanent(self, log_id):
        db.delete_status_log_permanent(log_id)
        return {'status': 'success'}

    def mark_status_log_done(self, log_id):
        db.update_status_log_state(log_id, 'done')
        return {'status': 'success'}

    def restore_status_log(self, log_id):
        db.update_status_log_state(log_id, 'active')
        return {'status': 'success'}

    def mark_status_log_deleted(self, log_id):
        db.update_status_log_state(log_id, 'deleted')
        return {'status': 'success'}

    def export_project_html(self, project_id):
        try:
            import datetime
            import json
            project = db.get_project_by_id(project_id)
            if not project:
                return {'status': 'error', 'message': 'Project not found.'}
                
            logs = db.get_status_logs(project_id)
            milestones = db.get_milestones(project_id)
            
            project_data = {
                'name': project['name'],
                'manager': project['manager'],
                'client': project['client'],
                'depts': {
                    'Mech': project['dept1_name'] or 'Mech',
                    'Control': project['dept2_name'] or 'Control',
                    'Elec': project['dept3_name'] or 'Elec',
                    'Sales': project['dept4_name'] or 'Sales'
                },
                'logs': [l for l in logs if l['status'] != 'deleted'],
                'milestones': [m for m in milestones if m['is_saved']]
            }
            
            json_data = json.dumps(project_data)
            
            html_template = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gantt Chart - {project['name']}</title>
    <style>
        :root {{
            --bg-color: #0d0d12;
            --card-bg: #16161e;
            --border-color: #2a2b37;
            --text-color: #c0caf5;
            --accent-color: #7aa2f7;
            --mech-color: #9ece6a;
            --control-color: #bb9af7;
            --elec-color: #e0af68;
            --sales-color: #f7768e;
            --today-line: #ff9e64;
        }}
        
        * {{ box-sizing: border-box; }}

        body {{
            background-color: var(--bg-color);
            color: var(--text-color);
            font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 20px 40px;
            overflow-x: hidden;
        }}
        
        .header {{
            margin-bottom: 20px;
            border-bottom: 2px solid var(--border-color);
            padding-bottom: 15px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
        }}
        
        .header h1 {{ margin: 0; color: var(--accent-color); font-size: 2em; }}
        
        .project-info {{ display: flex; gap: 30px; margin-top: 10px; color: #565f89; font-size: 0.9em; font-weight: bold; }}
        
        .controls {{ display: flex; gap: 10px; margin-bottom: 20px; align-items: center; }}
        
        .btn {{
            background: #1a1b26;
            border: 1px solid var(--border-color);
            color: var(--text-color);
            padding: 8px 15px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
            transition: all 0.2s;
        }}
        
        .btn:hover {{ border-color: var(--accent-color); background: #24283b; }}
        .btn.active {{ background: var(--accent-color); color: #000; border-color: var(--accent-color); }}
        
        .gantt-container {{
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            overflow: auto;
            position: relative;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            min-height: 500px;
        }}
        
        .gantt-grid {{ display: inline-block; position: relative; min-width: 100%; }}
        
        .gantt-header {{
            display: flex;
            background: #1a1b26;
            border-bottom: 1px solid var(--border-color);
            position: sticky;
            top: 0;
            z-index: 10;
        }}
        
        .day-col {{
            width: 120px;
            flex-shrink: 0;
            text-align: center;
            padding: 10px 0;
            font-size: 0.8em;
            border-right: 1px solid rgba(42, 43, 55, 0.3);
            color: #787c99;
        }}
        
        .day-col.today {{ background: rgba(255, 158, 100, 0.1); color: var(--today-line); font-weight: bold; }}
        
        .dept-row {{ display: flex; border-bottom: 1px solid var(--border-color); min-height: 100px; position: relative; }}
        
        .dept-label {{
            width: 150px;
            flex-shrink: 0;
            position: sticky;
            left: 0;
            background: var(--card-bg);
            z-index: 5;
            display: flex;
            align-items: center;
            padding: 15px;
            font-weight: bold;
            font-size: 0.9em;
            border-right: 2px solid var(--border-color);
            box-shadow: 5px 0 10px rgba(0,0,0,0.2);
            text-transform: uppercase;
        }}
        
        .chart-area {{
            position: relative;
            flex: 0 0 auto;
            background-image: linear-gradient(90deg, rgba(42, 43, 55, 0.1) 1px, transparent 1px);
            background-size: 120px 100%;
        }}
        
        .task-bar {{
            position: absolute;
            height: 30px;
            border-radius: 4px;
            padding: 0 8px;
            display: flex;
            align-items: center;
            font-size: 0.75em;
            color: #000;
            font-weight: bold;
            box-shadow: 0 3px 5px rgba(0,0,0,0.3);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            z-index: 2;
            transition: all 0.2s;
            cursor: pointer;
        }}
        
        .task-bar:hover {{ transform: scaleY(1.1); z-index: 100; overflow: visible; background: #fff !important; box-shadow: 0 5px 15px rgba(0,0,0,0.5); }}
        
        .milestone-marker {{ position: absolute; top: 0; bottom: 0; width: 2px; background: var(--accent-color); z-index: 1; opacity: 0.4; }}
        .milestone-marker.completed {{ background: #565f89; }}
        .milestone-label {{ position: absolute; top: 5px; transform: translateX(-50%); background: var(--accent-color); color: #000; padding: 2px 6px; border-radius: 3px; font-size: 0.65em; font-weight: bold; white-space: nowrap; pointer-events: none; }}
        
        .today-line {{ position: absolute; top: 0; bottom: 0; width: 0; border-left: 2px dashed var(--today-line); z-index: 20; pointer-events: none; }}
        
        .legend {{ margin-top: 20px; display: flex; gap: 20px; justify-content: center; font-size: 0.8em; }}
        .legend-item {{ display: flex; align-items: center; gap: 6px; }}
        .color-box {{ width: 12px; height: 12px; border-radius: 2px; }}

        .tooltip {{
            position: fixed;
            background: #1a1b26;
            border: 1px solid var(--border-color);
            padding: 10px;
            border-radius: 4px;
            font-size: 0.8em;
            z-index: 1000;
            pointer-events: none;
            display: none;
            box-shadow: 0 5px 15px rgba(0,0,0,0.5);
            max-width: 300px;
            line-height: 1.4;
        }}
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>{project['name']}</h1>
            <div class="project-info">
                <span>MANAGER: {project['manager']}</span>
                <span>CLIENT: {project['client']}</span>
                <span>EXPORT DATE: {datetime.date.today().strftime('%Y-%m-%d')}</span>
            </div>
        </div>
        <div class="controls">
            <button class="btn" id="btn-prev">PREV</button>
            <button class="btn active" id="btn-weekly">WEEKLY</button>
            <button class="btn" id="btn-monthly">MONTHLY</button>
            <button class="btn" id="btn-next">NEXT</button>
        </div>
    </div>
    
    <div class="gantt-container" id="gantt-container">
        <div class="gantt-grid" id="gantt-grid"></div>
    </div>
    
    <div class="legend">
        <div class="legend-item"><div class="color-box" style="background: var(--mech-color);"></div> {project['dept1_name']}</div>
        <div class="legend-item"><div class="color-box" style="background: var(--control-color);"></div> {project['dept2_name']}</div>
        <div class="legend-item"><div class="color-box" style="background: var(--elec-color);"></div> {project['dept3_name']}</div>
        <div class="legend-item"><div class="color-box" style="background: var(--sales-color);"></div> {project['dept4_name']}</div>
        <div class="legend-item"><div class="color-box" style="border: 1px dashed var(--today-line);"></div> TODAY</div>
    </div>

    <div id="tooltip" class="tooltip"></div>

    <script>
        const projectData = {json_data};
        let currentScale = 'weekly';
        let baseDate = new Date();
        
        const grid = document.getElementById('gantt-grid');
        const tooltip = document.getElementById('tooltip');

        function getDaysCount() {{
            if (currentScale === 'monthly') return 12;
            const availableWidth = window.innerWidth - 80 - 150;
            return Math.max(7, Math.floor(availableWidth / 120));
        }}

        function getDaysInMonth(year, month) {{ return new Date(year, month + 1, 0).getDate(); }}

        function render() {{
            grid.innerHTML = '';
            const now = new Date(); now.setHours(0,0,0,0);
            const days = getDaysCount();
            let startDate;
            
            if (currentScale === 'weekly') {{
                startDate = new Date(baseDate);
                startDate.setHours(0,0,0,0);
            }} else {{
                startDate = new Date(baseDate.getFullYear(), baseDate.getMonth() - 5, 1);
            }}

            const header = document.createElement('div');
            header.className = 'gantt-header';
            const corner = document.createElement('div');
            corner.style.width = '150px'; corner.style.flexShrink = '0';
            corner.style.borderRight = '2px solid var(--border-color)';
            header.appendChild(corner);

            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

            for (let i = 0; i < days; i++) {{
                const col = document.createElement('div');
                col.className = 'day-col';
                if (currentScale === 'weekly') {{
                    const d = new Date(startDate); d.setDate(startDate.getDate() + i);
                    if (d.getTime() === now.getTime()) col.classList.add('today');
                    col.innerHTML = `${{d.getMonth() + 1}}/${{d.getDate()}}<br>${{dayNames[d.getDay()]}}`;
                }} else {{
                    const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
                    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) col.classList.add('today');
                    col.innerHTML = `${{d.getFullYear()}}<br>${{monthNames[d.getMonth()]}}`;
                }}
                header.appendChild(col);
            }}
            grid.appendChild(header);

            function getPct(date) {{
                if (currentScale === 'weekly') {{
                    const diff = (date.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
                    if (diff < -0.5 || diff > days + 0.5) return -1;
                    return (diff / days) * 100;
                }} else {{
                    const monthDiff = (date.getFullYear() - startDate.getFullYear()) * 12 + (date.getMonth() - startDate.getMonth());
                    if (monthDiff < -0.5 || monthDiff > days + 0.5) return -1;
                    const day = date.getDate();
                    const daysInMonth = getDaysInMonth(date.getFullYear(), date.getMonth());
                    return ((monthDiff + (day / daysInMonth)) / days) * 100;
                }}
            }}

            const todayPct = getPct(now);
            const bodyWidth = days * 120;
            const depts = [{{code:'Mech', color:'var(--mech-color)'}}, {{code:'Control', color:'var(--control-color)'}}, {{code:'Elec', color:'var(--elec-color)'}}, {{code:'Sales', color:'var(--sales-color)'}}];

            depts.forEach(dept => {{
                const row = document.createElement('div'); row.className = 'dept-row';
                const label = document.createElement('div'); label.className = 'dept-label'; label.style.color = dept.color;
                label.innerText = projectData.depts[dept.code];
                row.appendChild(label);

                const area = document.createElement('div'); area.className = 'chart-area';
                area.style.width = bodyWidth + 'px';

                if (todayPct >= 0 && todayPct <= 100) {{
                    const line = document.createElement('div'); line.className = 'today-line';
                    line.style.left = todayPct + '%'; line.style.height = '100%';
                    area.appendChild(line);
                }}

                projectData.milestones.forEach(m => {{
                    const pct = getPct(new Date(m.deadline));
                    if (pct >= 0 && pct <= 100) {{
                        const marker = document.createElement('div'); marker.className = 'milestone-marker' + (m.is_done ? ' completed' : '');
                        marker.style.left = pct + '%';
                        const mLabel = document.createElement('div'); mLabel.className = 'milestone-label'; mLabel.innerText = m.name;
                        marker.appendChild(mLabel); area.appendChild(marker);
                    }}
                }});

                const deptLogs = projectData.logs.filter(l => l.department === dept.code);
                const placed = [];
                deptLogs.forEach(log => {{
                    const s = new Date(log.start_date || log.timestamp.split(' ')[0]);
                    const d = new Date(log.due_date || log.timestamp.split(' ')[0]);
                    d.setHours(23,59,59,999);
                    let lp = getPct(s); let rp = getPct(d);
                    if (lp === -1 && rp === -1) return;
                    const vL = Math.max(0, lp); const vR = Math.min(100, rp);
                    if (vL > 100 || vR < 0 || vR < vL) return;
                    
                    let lane = 0;
                    while (placed.some(p => p.lane === lane && !(rp < p.left || lp > p.right))) lane++;
                    placed.push({{lane, left: lp, right: rp}});

                    const bar = document.createElement('div'); bar.className = 'task-bar';
                    bar.style.left = vL + '%'; bar.style.width = Math.max(vR - vL, 0.5) + '%';
                    bar.style.top = (15 + lane * 40) + 'px'; bar.style.backgroundColor = dept.color;
                    bar.innerText = log.title || log.text_content.split('\\n')[0];
                    bar.onmouseenter = (e) => {{
                        tooltip.style.display = 'block';
                        tooltip.innerHTML = `<strong>${{log.title || 'Task'}}</strong><br><small>${{log.timestamp}}</small><br>${{log.text_content.replace(/\\n/g, '<br>')}}`;
                        updateTooltip(e);
                    }};
                    bar.onmousemove = updateTooltip;
                    bar.onmouseleave = () => tooltip.style.display = 'none';
                    area.appendChild(bar);
                }});
                row.appendChild(area); grid.appendChild(row);
            }});
        }}

        function updateTooltip(e) {{ tooltip.style.left = (e.clientX + 15) + 'px'; tooltip.style.top = (e.clientY + 15) + 'px'; }}

        document.getElementById('btn-prev').onclick = () => {{
            if (currentScale === 'weekly') baseDate.setDate(baseDate.getDate() - 7);
            else baseDate.setMonth(baseDate.getMonth() - 1);
            render();
        }};
        document.getElementById('btn-next').onclick = () => {{
            if (currentScale === 'weekly') baseDate.setDate(baseDate.getDate() + 7);
            else baseDate.setMonth(baseDate.getMonth() + 1);
            render();
        }};
        document.getElementById('btn-weekly').onclick = () => {{
            currentScale = 'weekly'; document.getElementById('btn-weekly').classList.add('active'); document.getElementById('btn-monthly').classList.remove('active'); render();
        }};
        document.getElementById('btn-monthly').onclick = () => {{
            currentScale = 'monthly'; document.getElementById('btn-monthly').classList.add('active'); document.getElementById('btn-weekly').classList.remove('active'); render();
        }};

        window.onresize = render;
        if(currentScale === 'weekly') baseDate.setDate(baseDate.getDate() - 3);
        render();
    </script>
</body>
</html>
"""
            safe_name = "".join([c for c in project['name'] if c.isalnum() or c in (' ', '_', '-')]).rstrip()
            filename = f"{safe_name}_GanttChart.html"
            dest_path = self.window.create_file_dialog(webview.SAVE_DIALOG, save_filename=filename, file_types=('HTML Files (*.html)', 'All files (*.*)'))
            if dest_path and len(dest_path) > 0:
                save_path = dest_path[0]
                if os.path.isdir(save_path):
                    save_path = os.path.join(save_path, filename)
                with open(save_path, 'w', encoding='utf-8') as f:
                    f.write(html_template)
                return {'status': 'success', 'path': save_path}
            return {'status': 'error', 'message': 'User cancelled export.'}
        except Exception as e:
            import traceback
            return {'status': 'error', 'message': f"Failed to export HTML: {str(e)}\n{traceback.format_exc()}"}

    def upload_project_image(self, project_id):
        if not self.window:
            return {'status': 'error', 'message': 'No window context'}
        
        file_types = ('Image files (*.png;*.jpg;*.jpeg;*.gif)', 'All files (*.*)')
        result = self.window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False, file_types=file_types)
        
        if result and len(result) > 0:
            source_path = result[0]
            
            # Destination path: %LOCALAPPDATA%/SJ_WorkAssist/projects/{project_id}/
            base = db.get_data_dir()
            proj_dir = os.path.join(base, 'projects', str(project_id))
            os.makedirs(proj_dir, exist_ok=True)
            
            ext = os.path.splitext(source_path)[1]
            filename = f"{uuid.uuid4().hex}{ext}"
            dest_path = os.path.join(proj_dir, filename)
            
            shutil.copy2(source_path, dest_path)
            
            return {'status': 'success', 'path': dest_path}
            
        return {'status': 'cancelled'}

    def get_local_image_base64(self, path):
        if not path or not os.path.exists(path):
            return ""
        try:
            with open(path, "rb") as image_file:
                encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
                ext = os.path.splitext(path)[1].lower()
                mime = "image/jpeg"
                if ext == ".png":
                    mime = "image/png"
                elif ext == ".gif":
                    mime = "image/gif"
                return f"data:{mime};base64,{encoded_string}"
        except Exception as e:
            return ""

    # Milestone API
    def get_milestones(self, project_id):
        return db.get_milestones(project_id)

    def save_milestone(self, data):
        project_id = data.get('project_id')
        slot_number = data.get('slot_number')
        name = data.get('name', '')
        deadline = data.get('deadline', '')
        content = data.get('content', '')
        is_saved = data.get('is_saved', False)
        is_done = data.get('is_done', False)
        
        db.save_milestone(project_id, slot_number, name, deadline, content, is_saved, is_done)
        return {'status': 'success'}

    def delete_milestone(self, project_id, slot_number):
        db.delete_milestone(project_id, slot_number)
        return {'status': 'success'}
