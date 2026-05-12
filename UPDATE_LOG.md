# WorkAssist Update Log

## [2026-05-12] - v1.2.0 (Backup & Data Protection)

### 1. Advanced Database Backup System
- **Three-Tier Backup Strategy**:
    - **Closing Backup**: Automatically saves the database state every time the application is closed.
    - **Periodic Backup**: Automatically performs a background backup every **15 minutes**.
    - **Manual Backup**: Users can now trigger an immediate backup via the `Settings > Data Management` section.
- **Smart Rotation**: Periodic backups automatically manage disk space by keeping only the latest 3 versions.
- **Restore Functionality**: Added a `[Restore Backup]` feature in Settings, allowing users to roll back to any previous `.db` file from the `backups` folder.

### 2. Database Branding & Migration
- **Consistency**: Renamed the core database file from `sjkanban.db` to `sjworkassist.db`.
- **Seamless Transition**: Implemented an automatic migration logic that detects legacy `sjkanban.db` files and renames them on startup, ensuring no data loss during the transition.

### 3. UI/UX & Notification Enhancements
- **Global Notification Visibility**: Redesigned the modal overlay system to ensure the sidebar notification area remains bright and readable even when a modal (like Settings) is active.
- **Sidebar Alignment**: Unified the width of the character portrait and notification message box (160px) for a more professional and symmetrical look.
- **Fixed Notification Overwrite**: Resolved a race condition where idle messages (like lunch/off-work alerts) would immediately overwrite active system notifications.
- **JS Visibility Fix**: Changed global variable declarations in `app.js` to ensure they are accessible to the `pywebview` engine for reliable i18n rendering.

### 4. Localization
- Full Korean/English translation support added for all backup/restore buttons, status notifications, and confirmation messages.

## [2026-05-11] - Hotfix
- **macOS Export Fix**: Resolved an issue where exporting the HTML Gantt Chart on macOS failed with a `FileExistsError` due to the native file save dialog returning a directory path instead of a file path.


## [2026-05-09] - v1.1.0 (Minor Update)

### 1. Interactive HTML Gantt Chart Export
- **New Export Engine**: Completely replaced the old Excel-based export with a standalone, interactive HTML Gantt chart system.
- **Dynamic Views**: Exported Gantt charts now support real-time toggling between **Weekly** and **Monthly** modes.
- **Responsive Design**: The exported HTML is fully responsive, adjusting date columns and layout based on screen size.
- **Fixed Department Mapping**: Resolved an issue where custom department names from project settings were not correctly reflected in exported charts.

### 2. Performance & Stability Enhancements
- **SQLite WAL Mode**: Enabled Write-Ahead Logging for the database, preventing "Application Not Responding" hangs caused by database locks during concurrent operations.
- **Asynchronous Startup**: Moved the desktop shortcut creation process to a background thread to ensure immediate application window response on startup.
- **Robust i18n Loading**: Added a timeout and fallback mechanism for localization file fetching to prevent UI freezes in slow environments.
- **GUI Engine Optimization**: Improved stability by allowing `pywebview` to automatically select the best available rendering engine (EdgeWebView2/Chromium).

### 3. UI/UX & Branding
- **Company Branding**: Added the Samjeong Automation (BDH) logo to the `Settings > About` section.
- **Layout Fixes**: Resolved alignment issues between department rows and date headers in the Time Table view.
- **Gantt Visibility**: Increased the maximum number of visible dates in Weekly mode to utilize available screen width effectively.

### 4. Dependency Cleanup
- Removed `openpyxl` from dependencies as the transition to HTML export is complete.
- Optimized asset handling for seasonal login images and new branding assets.
- **Data Folder Migration**: Renamed the local data storage directory from `SJ_Kanban` to `SJ_WorkAssist` for better brand alignment.
- **Default Tutorial Account**: Included a pre-configured 'tutorial' account (ID: `tutorial` / PW: `1234`) to help new users get started immediately.

## [2026-05-04]

### 1. Excel Export Enhancement
- Integrated `openpyxl` for native Excel file generation.
- Added support for exporting Timetable logs and milestones into separate sheets.
- **Visual Chart Export**: Added the ability to capture the visual Timetable chart (including markers and milestones) and insert it into a 'Chart' worksheet in the Excel file.
- Fixed a critical bug where `db.get_project_by_id` was missing, causing export failures.
- Optimized the file save process using a native Windows File Dialog for reliability in packaged environments.

### 2. UI/UX Improvements
- **Responsive Layout**: Applied full-screen vertical scrolling to the Project Manager main area to ensure content visibility on smaller screens.
- **Login Convenience**: Added Enter key support to ID and Password input fields on the login screen.
- **Visual Polish**: Adjusted button colors and active states for better readability and consistency across the PM module.

### 3. Stability & Packaging
- Resolved issues with library dependencies (`openpyxl`, `Pillow`) in the PyInstaller build.
- Refined the build process to include necessary assets like `html2canvas`.
