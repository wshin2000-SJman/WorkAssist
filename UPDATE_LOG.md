# WorkAssist Update Log

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
