# WorkAssist Update Log

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
