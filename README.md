# WorkAssist

> **삼정오토메이션 내부용 통합 업무 보조 툴**  
> A minimalist, retro-styled productivity suite for task, meeting, and project management.

Built with **Python + PyWebView** for a standalone desktop experience — no browser, no internet, no installation of Python required on end-user machines.

---

## 📋 Key Features

### ✅ Task Manager (`Task Mngr.`)
- Kanban-style task board with status tracking (Todo / In Progress / Review / Done)
- Urgent markers, tag-based categorization, and due date management
- Calendar view for date-based task overview

### 📝 Meeting Minutes (`Meeting Mngr.`)
- Dynamic split-pane editor with **live Markdown preview**
- Structured sections: Free Memo, Decisions & Rationales, Action Items
- **Task Export**: Push meeting action items directly into the Task Manager
- Export minutes as `.md` files or copy to clipboard
- Localization support (Korean / English)

### 📊 Project Manager (`Project Mngr.`)
- Multi-project dashboard with full CRUD management
- **Time Table**: Weekly / Monthly visual chart showing log schedules with milestone markers
- **Status Tab**: Department-based log tracking (Active / Done / Deleted)
- **Milestone Tab**: Up to 10 milestone slots with deadline tracking and completion status
- **Interactive HTML Export**:
  - Exports the current Time Table as a standalone, responsive HTML Gantt chart
  - Supports dynamic view modes (Weekly/Monthly) and responsive layout
  - Native Windows Save Dialog for user-defined save path
- Image attachments per log entry

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3.11/3.13, PyWebView 6.2.1, SQLite |
| **Frontend** | HTML5, Vanilla CSS3, JavaScript (ES6+) |
| **Gantt Engine** | Standalone Interactive HTML Rendering |
| **Design** | Retro-minimalist, Cascadia Code, Tokyo Night Palette |
| **Packaging** | PyInstaller 6.20.0 (single-file `.exe`) |

---

## 🚀 Getting Started (Development)

### Prerequisites
- Python 3.13+
- Windows OS (PyWebView uses WebView2 / Edge Chromium)

### Setup
```bash
# 1. Clone the repository
git clone https://github.com/wshin2000-SJman/WorkAssist.git
cd WorkAssist

# 2. Create virtual environment
python -m venv venv
.\venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run the application
python main.py
```

### Build EXE
```bash
# Generate version info (optional, run if version changed)
python version_info.py

# Build single-file executable
pyinstaller build.spec
# Output: dist/SJ_Kanban.exe
```

---

## 📁 Project Structure

```
SJ_WorkAssist/
├── main.py               # App entry point (PyWebView window setup)
├── api.py                # Python API (called from JS via pywebview.api)
├── db.py                 # SQLite database layer
├── version.py            # Version constant (e.g. "1.0.0")
├── version_info.py       # Generates file_version_info.txt for PyInstaller
├── build.spec            # PyInstaller build configuration
├── requirements.txt      # Python dependencies
├── UPDATE_LOG.md         # Feature update history
├── installer.iss         # Inno Setup installer script
└── assets/
    ├── index.html        # Main UI structure
    ├── app.js            # Frontend logic & API calls
    ├── style.css         # All styles (Tokyo Night theme)
    ├── i18n.json         # Localization strings (KO / EN)
    ├── html2canvas.min.js # Screenshot library for Excel chart export
    ├── logo.ico          # App icon
    └── Title IMG_*.webp  # Seasonal login screen images
```

---

## 🌍 Localization

Supports **Korean** and **English** via `assets/i18n.json`. Language can be switched in Settings at runtime.

---

## 📦 Distribution

Distributed as a professional installer (**`WorkAssist_Setup_v1.1.0.exe`**) created with Inno Setup:
- ✅ **Installation**: Installs as `WorkAssist.exe` in the Program Files directory
- ✅ **Shortcuts**: Automatically creates Start Menu and optional Desktop shortcuts
- ✅ **No Dependencies**: No Python installation required on target machines
- ✅ **Offline**: Works entirely without an internet connection
- ✅ **Local Data**: All data is stored securely in `%LOCALAPPDATA%\SJ_Kanban\`

---

## 📄 Version

**Current Version**: v1.1.0  
See [UPDATE_LOG.md](UPDATE_LOG.md) for full change history.

---

## © License

© 2026. [Wonseup Shin / Samjeong Automation] All rights reserved.  
Internal use only. Not for public redistribution.
