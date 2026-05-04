import os

html_path = 'assets/index.html'

with open(html_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
found_tooltip = False
for line in lines:
    new_lines.append(line)
    if 'id="global-timetable-tooltip"' in line:
        found_tooltip = True
        break

if found_tooltip:
    new_lines.append('\n')
    new_lines.append('    <!-- Project Log Modal -->\n')
    new_lines.append('    <div class="modal-overlay" id="pm-log-modal">\n')
    new_lines.append('        <div class="modal">\n')
    new_lines.append('            <div class="modal-header" id="pm-log-modal-header">[ NEW LOG ]</div>\n')
    new_lines.append('            <div class="form-group">\n')
    new_lines.append('                <label data-i18n="modal_title">Title:</label>\n')
    new_lines.append('                <input type="text" id="pm-log-title">\n')
    new_lines.append('            </div>\n')
    new_lines.append('            <div class="form-group">\n')
    new_lines.append('                <label data-i18n="modal_content">Content:</label>\n')
    new_lines.append('                <textarea id="pm-log-content" data-i18n-ph="pm_ph_log" placeholder="Enter status update..."></textarea>\n')
    new_lines.append('            </div>\n')
    new_lines.append('            <div class="form-group">\n')
    new_lines.append('                <label data-i18n="modal_manager">Manager:</label>\n')
    new_lines.append('                <input type="text" id="pm-log-manager">\n')
    new_lines.append('            </div>\n')
    new_lines.append('            <div class="form-row">\n')
    new_lines.append('                <div class="form-group half">\n')
    new_lines.append('                    <label data-i18n="modal_start">Start Date:</label>\n')
    new_lines.append('                    <input type="date" id="pm-log-start">\n')
    new_lines.append('                </div>\n')
    new_lines.append('                <div class="form-group half">\n')
    new_lines.append('                    <label data-i18n="modal_due">Due Date:</label>\n')
    new_lines.append('                    <input type="date" id="pm-log-due">\n')
    new_lines.append('                </div>\n')
    new_lines.append('            </div>\n')
    new_lines.append('            <div class="form-group">\n')
    new_lines.append('                <button class="action-btn" id="pm-log-upload-img" data-i18n="pm_btn_upload_img">[ UPLOAD IMAGE ]</button>\n')
    new_lines.append('                <input type="hidden" id="pm-log-img-path">\n')
    new_lines.append('                <span id="pm-log-img-preview" style="font-size:0.8em; color:#888; margin-top:5px; display:block;"></span>\n')
    new_lines.append('            </div>\n')
    new_lines.append('            <div class="modal-actions">\n')
    new_lines.append('                <button class="action-btn" id="pm-log-cancel" data-i18n="modal_cancel">[ CANCEL ]</button>\n')
    new_lines.append('                <button class="action-btn" id="pm-log-save" data-i18n="modal_save">[ SAVE ]</button>\n')
    new_lines.append('            </div>\n')
    new_lines.append('        </div>\n')
    new_lines.append('    </div>\n')
    new_lines.append('\n')
    new_lines.append('    <script src="app.js"></script>\n')
    new_lines.append('</body>\n')
    new_lines.append('</html>\n')

    with open(html_path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print("Successfully fixed index.html")
else:
    print("Could not find anchor in index.html")
