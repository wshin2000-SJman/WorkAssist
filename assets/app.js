// Global State
var i18nData = {};
var currentLang = 'en';
let allTasks = [];
let currentMonth = new Date();
let timetableBaseDate = new Date();

// --- Custom Notification System ---
let notiQueue = [];
let isNotiTyping = false;
let isShowingAlert = false;
let stareTimer = null;
let msgClearTimer = null;

function resetStareTimer() {
    if (stareTimer) clearInterval(stareTimer);
    stareTimer = setInterval(() => {
        if (!isNotiTyping && notiQueue.length === 0) {
            const gifEl = document.getElementById('noti-gif');
            if(gifEl) {
                gifEl.src = "glasses_1.gif?" + new Date().getTime();
                setTimeout(() => {
                    if (!isNotiTyping && notiQueue.length === 0 && gifEl) {
                        gifEl.src = "stare_1.gif";
                    }
                }, 3000); 
            }
        }
    }, 30000);
}

function processNotiQueue() {
    if (isNotiTyping || notiQueue.length === 0) return;
    
    const gifEl = document.getElementById('noti-gif');
    const msgEl = document.getElementById('noti-msg-text');
    const btnContainer = document.getElementById('noti-btn-container');
    if(!gifEl || !msgEl) return;

    isNotiTyping = true;
    const req = notiQueue.shift();
    msgEl.innerText = "";
    if (btnContainer) btnContainer.style.display = 'none';
    
    gifEl.src = Math.random() > 0.5 ? "chat_1.gif" : "chat_2.gif";
    
    let i = 0;
    const typeSpeed = 50; 
    
    function typeChar() {
        if (i < req.msg.length) {
            msgEl.innerText += req.msg.charAt(i);
            i++;
            setTimeout(typeChar, typeSpeed);
        } else {
            isNotiTyping = false;
            gifEl.src = "stare_1.gif";
            resetStareTimer();
            
            if (req.type === 'confirm') {
                if (btnContainer) {
                    btnContainer.style.display = 'flex';
                    const btnYes = document.getElementById('noti-btn-yes');
                    const btnNo = document.getElementById('noti-btn-no');
                    
                    const cleanup = () => {
                        btnContainer.style.display = 'none';
                        btnYes.onclick = null;
                        btnNo.onclick = null;
                        msgEl.innerText = getIdleMessage();
                        processNotiQueue();
                    };
                    
                    btnYes.onclick = () => { cleanup(); req.resolve(true); };
                    btnNo.onclick = () => { cleanup(); req.resolve(false); };
                } else {
                    req.resolve(false);
                }
            } else {
                isShowingAlert = true;
                if (msgClearTimer) clearTimeout(msgClearTimer);
                msgClearTimer = setTimeout(() => {
                    isShowingAlert = false;
                    msgEl.innerText = getIdleMessage();
                    if (req.resolve) req.resolve();
                    processNotiQueue(); 
                }, 5000); 
            }
        }
    }
    typeChar();
}

function getIdleMessage() {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    
    // 11:30 ~ 11:59
    if (h === 11 && m >= 30) {
        return i18nData[currentLang]?.msg_idle_lunch || "Lunch time is approaching.";
    }
    // 16:30 ~ 16:59
    if (h === 16 && m >= 30) {
        return i18nData[currentLang]?.msg_idle_offwork || "It's almost time to get off work.";
    }
    return "";
}

function overrideAlert() {
    window.alert = function(msg) {
        notiQueue.push({ type: 'alert', msg: String(msg) });
        processNotiQueue();
    };
}
overrideAlert();

let isConfirmActive = false;

window.customConfirm = function(msg) {
    if (isConfirmActive) return Promise.resolve(false);
    isConfirmActive = true;
    return new Promise((resolve) => {
        notiQueue.push({ 
            type: 'confirm', 
            msg: String(msg), 
            resolve: (val) => {
                isConfirmActive = false;
                resolve(val);
            } 
        });
        processNotiQueue();
    });
};

window.addEventListener('DOMContentLoaded', () => {
    const gifEl = document.getElementById('noti-gif');
    if(gifEl) {
        gifEl.src = "stare_1.gif";
        resetStareTimer();
    }
});
// ----------------------------------
// Elements
const tabBtns = document.querySelectorAll('.tab-btn');
const views = document.querySelectorAll('.view-section');
const navItems = document.querySelectorAll('.nav-item');
const pageViews = document.querySelectorAll('.page-view');
const taskModal = document.getElementById('task-modal');
const taskDetailModal = document.getElementById('task-detail-modal');
const settingsModal = document.getElementById('settings-modal');

// Initialization when pywebview is ready
window.addEventListener('pywebviewready', async function() {
    overrideAlert(); // Ensure pywebview doesn't overwrite our alert
    await loadI18n();
    applyLanguage(currentLang);
    setupEventListeners();
    setupAuthListeners();
    
    // Start Sidebar Clock
    setInterval(updateSidebarClock, 1000);
    updateSidebarClock();
    
    // Display version
    const version = await window.pywebview.api.get_app_version();
    const versionSettingsEl = document.getElementById('app-version-settings');
    if(versionSettingsEl) versionSettingsEl.innerText = 'Version: ' + version;
    const loginVersionEl = document.getElementById('login-version');
    if(loginVersionEl) loginVersionEl.innerText = 'ver' + version;

    // Set Seasonal Login Image
    setLoginImage();
});

function setLoginImage() {
    const month = new Date().getMonth() + 1; // 1-12
    const imgEl = document.getElementById('login-logo');
    if(!imgEl) return;
    
    let imgSrc = 'Title IMG_2.webp'; // default 1-7
    if (month === 12) imgSrc = 'Title IMG_DEC.webp';
    else if (month === 8) imgSrc = 'Title IMG_AUG.webp';
    else if (month >= 9 && month <= 11) imgSrc = 'Title IMG_1.webp';
    
    imgEl.src = imgSrc;
}

// Setup Event Listeners
function setupAuthListeners() {
    // Login
    const performLogin = async () => {
        const id = document.getElementById('login-id-input').value;
        const pw = document.getElementById('login-pw-input').value;
        const res = await window.pywebview.api.login(id, pw);
        if(res.status === 'success') {
            document.body.classList.add('logged-in');
            document.getElementById('login-view').style.display = 'none';
            document.getElementById('app-content').style.display = 'flex';
            await refreshTasks();
            renderCalendar();
        } else {
            if (res.message === 'User does not exist') {
                alert(i18nData[currentLang].msg_user_not_found || res.message);
            } else if (res.message === 'Incorrect password') {
                alert(i18nData[currentLang].msg_wrong_password || res.message);
            } else {
                alert(i18nData[currentLang].msg_login_fail || res.message);
            }
        }
    };

    document.getElementById('btn-do-login').addEventListener('click', performLogin);

    // Enter key listener for login
    document.getElementById('login-id-input').addEventListener('keyup', (e) => {
        if(e.key === 'Enter') performLogin();
    });
    document.getElementById('login-pw-input').addEventListener('keyup', (e) => {
        if(e.key === 'Enter') performLogin();
    });

    // Modals open
    document.getElementById('btn-show-create').addEventListener('click', () => {
        document.getElementById('create-id-modal').style.display = 'flex';
    });
    document.getElementById('btn-show-change-pw').addEventListener('click', () => {
        document.getElementById('change-pw-modal').style.display = 'flex';
    });
    document.getElementById('btn-show-hint').addEventListener('click', () => {
        document.getElementById('hint-modal').style.display = 'flex';
    });

    // Create ID
    document.getElementById('create-cancel').addEventListener('click', () => {
        document.getElementById('create-id-modal').style.display = 'none';
    });
    document.getElementById('create-save').addEventListener('click', async () => {
        const id = document.getElementById('create-id-input').value;
        const pw = document.getElementById('create-pw-input').value;
        const hint = document.getElementById('create-hint-input').value;
        if(id && pw) {
            const res = await window.pywebview.api.register(id, pw, hint);
            if(res.status === 'success') {
                alert(i18nData[currentLang].msg_success || 'Success');
                document.getElementById('create-id-modal').style.display = 'none';
            } else {
                alert(i18nData[currentLang].msg_id_exists || res.message);
            }
        }
    });

    // Change PW
    document.getElementById('change-pw-cancel').addEventListener('click', () => {
        document.getElementById('change-pw-modal').style.display = 'none';
    });
    document.getElementById('change-pw-save').addEventListener('click', async () => {
        const id = document.getElementById('change-id-input').value;
        const oldPw = document.getElementById('change-old-pw').value;
        const newPw = document.getElementById('change-new-pw').value;
        if(id && oldPw && newPw) {
            const res = await window.pywebview.api.change_password(id, oldPw, newPw);
            if(res.status === 'success') {
                alert(i18nData[currentLang].msg_success || 'Success');
                document.getElementById('change-pw-modal').style.display = 'none';
            } else {
                alert(i18nData[currentLang].msg_login_fail || res.message);
            }
        }
    });

    // Hint
    document.getElementById('hint-cancel').addEventListener('click', () => {
        document.getElementById('hint-modal').style.display = 'none';
        document.getElementById('hint-result-group').style.display = 'none';
    });
    document.getElementById('hint-submit').addEventListener('click', async () => {
        const id = document.getElementById('hint-id-input').value;
        if(id) {
            const res = await window.pywebview.api.get_hint(id);
            if(res.status === 'success') {
                document.getElementById('hint-result-display').innerText = res.hint;
                document.getElementById('hint-result-group').style.display = 'block';
            } else {
                alert(i18nData[currentLang].msg_login_fail || 'User not found');
            }
        }
    });
}

function setupEventListeners() {
    // Tabs
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            views.forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
            if(btn.dataset.target === 'calendar-view') renderCalendar();
        });
    });

    // Sidebar Navigation
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(nav => nav.classList.remove('active'));
            pageViews.forEach(page => page.classList.remove('active'));
            
            item.classList.add('active');
            const targetPage = document.getElementById(item.dataset.page);
            if(targetPage) targetPage.classList.add('active');
            
            // If switching to Kanban, refresh it
            if(item.dataset.page === 'kanban-page') refreshTasks();
            if(item.dataset.page === 'meeting-page') refreshMeetings();
            if(item.dataset.page === 'project-page') refreshProjects();
        });
    });

    // Settings Modal (Sidebar version)
    document.getElementById('btn-settings-side').addEventListener('click', () => {
        document.getElementById('lang-select-modal').value = currentLang;
        settingsModal.style.display = 'flex';
    });
    document.getElementById('settings-cancel').addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });
    document.getElementById('settings-save').addEventListener('click', () => {
        applyLanguage(document.getElementById('lang-select-modal').value);
        settingsModal.style.display = 'none';
    });
    
    // Backup & Restore
    document.getElementById('btn-manual-backup').addEventListener('click', async () => {
        settingsModal.style.display = 'none';
        await window.pywebview.api.backup_db('manual');
    });
    document.getElementById('btn-restore-backup').addEventListener('click', async () => {
        await window.pywebview.api.restore_backup();
    });
    
    // Initialize
    document.getElementById('btn-show-initialize').addEventListener('click', () => {
        document.getElementById('initialize-modal').style.display = 'flex';
    });
    document.getElementById('initialize-cancel').addEventListener('click', () => {
        document.getElementById('initialize-modal').style.display = 'none';
    });
    document.getElementById('btn-do-initialize').addEventListener('click', async () => {
        const res = await window.pywebview.api.initialize_data();
        if(res.status === 'success') {
            document.getElementById('initialize-modal').style.display = 'none';
            document.getElementById('settings-modal').style.display = 'none';
            await refreshTasks();
            alert(i18nData[currentLang].msg_success || 'Data Initialized');
        }
    });

    // Logout (Sidebar version)
    document.getElementById('btn-logout-side').addEventListener('click', async () => {
        await window.pywebview.api.logout();
        document.body.classList.remove('logged-in');
        document.getElementById('app-content').style.display = 'none';
        document.getElementById('login-view').style.display = 'flex';
        // Clear inputs
        document.getElementById('login-id-input').value = '';
        document.getElementById('login-pw-input').value = '';
        
        // Reset navigation to Kanban page for next login
        navItems.forEach(nav => nav.classList.remove('active'));
        pageViews.forEach(page => page.classList.remove('active'));
        document.querySelector('[data-page="kanban-page"]').classList.add('active');
        document.getElementById('kanban-page').classList.add('active');
    });

    // Modals
    document.getElementById('btn-add-task').addEventListener('click', () => openModal(false));
    document.getElementById('btn-urgent-task').addEventListener('click', () => openModal(true));
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', saveTask);
    document.getElementById('detail-close').addEventListener('click', () => { taskDetailModal.style.display = 'none'; });
    document.getElementById('detail-delete').addEventListener('click', async () => {
        const taskId = document.getElementById('detail-delete').dataset.id;
        if(taskId) {
            await window.pywebview.api.update_task_status(taskId, 'Deleted');
            taskDetailModal.style.display = 'none';
            await refreshTasks();
        }
    });

    document.getElementById('detail-edit').addEventListener('click', () => toggleEditMode(true));
    document.getElementById('detail-save-edit').addEventListener('click', saveTaskEdit);
    
    document.getElementById('detail-mark-done').addEventListener('click', async () => {
        const taskId = document.getElementById('detail-delete').dataset.id;
        const reviewer = document.getElementById('detail-reviewer-name').value.trim();
        const comment = document.getElementById('detail-review-comment').value.trim();
        
        if(!reviewer) {
            alert(i18nData[currentLang].ph_reviewer_name || 'Please enter reviewer name.');
            return;
        }
        if(!comment) {
            alert(i18nData[currentLang].ph_review_comment || 'Please leave a review comment to complete the task.');
            return;
        }
        
        const timestamp = new Date().toLocaleString();
        const formattedComment = `[${timestamp}] ${i18nData[currentLang].modal_reviewer || 'Reviewer'}: ${reviewer}\n${comment}`;
        
        await window.pywebview.api.save_review_and_complete(taskId, formattedComment);
        taskDetailModal.style.display = 'none';
        await refreshTasks();
    });

    // Done Search
    document.getElementById('done-search').addEventListener('input', renderDoneView);
    
    // Export CSV
    document.getElementById('btn-export-csv').addEventListener('click', async () => {
        const result = await window.pywebview.api.export_csv();
        if(result.status === 'success') {
            alert(`${i18nData[currentLang].msg_exported} ${result.path}`);
        }
    });

    // Calendar Navigation
    document.getElementById('cal-prev').addEventListener('click', () => {
        currentMonth.setMonth(currentMonth.getMonth() - 1);
        renderCalendar();
    });
    document.getElementById('cal-next').addEventListener('click', () => {
        currentMonth.setMonth(currentMonth.getMonth() + 1);
        renderCalendar();
    });

    // Board Drag and Drop Setup
    const columns = document.querySelectorAll('.kanban-col .task-list');
    columns.forEach(col => {
        col.addEventListener('dragover', e => {
            e.preventDefault();
            col.classList.add('drag-over');
        });
        col.addEventListener('dragleave', e => {
            col.classList.remove('drag-over');
        });
        col.addEventListener('drop', async e => {
            e.preventDefault();
            col.classList.remove('drag-over');
            const taskId = e.dataTransfer.getData('text/plain');
            const newStatus = col.parentElement.dataset.status;
            
            // Call API
            await window.pywebview.api.update_task_status(taskId, newStatus);
            // If dropping to Review, it's done. But spec says "Completing a task in 'Review' removes it from the board and moves it to the 'Done' database." 
            // We'll treat 'Done' as a separate status that we can transition to via a button in Review, or just let 'Done' be a status.
            // Wait, spec: "Completing a task in 'Review' removes it from the board".
            // Let's add a "Complete" button to cards in "Review", or if dragged to Done (which isn't a column). 
            // We'll add a 'Complete' button to cards in Review column.
            
            await refreshTasks();
        });
    });

    // Note Parsing Logic (Basic heuristic)
    document.getElementById('modal-content').addEventListener('blur', (e) => {
        const text = e.target.value;
        const titleMatch = text.match(/Title:\s*(.*)/i);
        const managerMatch = text.match(/Manager:\s*(.*)/i);
        const startMatch = text.match(/Start( Date)?:\s*(.*)/i);
        const dueMatch = text.match(/Due( Date)?:\s*(.*)/i);

        if(titleMatch && !document.getElementById('modal-title').value) document.getElementById('modal-title').value = titleMatch[1];
        if(managerMatch && !document.getElementById('modal-manager').value) document.getElementById('modal-manager').value = managerMatch[1];
        
        // Very basic date extraction, assumes YYYY-MM-DD
        if(startMatch && !document.getElementById('modal-start').value) {
            const d = startMatch[2].match(/\d{4}-\d{2}-\d{2}/);
            if(d) document.getElementById('modal-start').value = d[0];
        }
        if(dueMatch && !document.getElementById('modal-due').value) {
            const d = dueMatch[2].match(/\d{4}-\d{2}-\d{2}/);
            if(d) document.getElementById('modal-due').value = d[0];
        }
    });
}

// Data Fetching & Rendering
async function refreshTasks() {
    allTasks = await window.pywebview.api.get_tasks();
    renderBoard();
    renderUrgentView();
    renderDoneView();
    renderRecycleView();
    if(document.getElementById('calendar-view').classList.contains('active')) {
        renderCalendar();
    }
}

function renderBoard() {
    // Clear all lists
    document.querySelectorAll('.kanban-col .task-list').forEach(list => list.innerHTML = '');

    allTasks.forEach(task => {
        if(task.status === 'Done' || task.status === 'Deleted') return; // Don't show Done/Deleted tasks on board

        const col = document.querySelector(`.kanban-col[data-status="${task.status}"] .task-list`);
        if(col) {
            const card = document.createElement('div');
            card.className = `task-card ${task.is_urgent ? 'urgent' : ''}`;
            card.draggable = true;
            card.dataset.id = task.id;
            
            card.addEventListener('dragstart', e => {
                e.dataTransfer.setData('text/plain', task.id);
            });
            card.addEventListener('click', (e) => {
                if(e.target.tagName !== 'BUTTON') {
                    showTaskDetail(task.id);
                }
            });

            card.innerHTML = `
                <div class="task-tag">${task.task_tag || ''}</div>
                <div class="task-title">${task.title}</div>
                <div class="task-meta">
                    <span>${task.manager}</span>
                    <span>${task.due_date ? 'Due: '+task.due_date : ''}</span>
                </div>
            `;

            if(task.status === 'Review') {
                const btnDone = document.createElement('button');
                btnDone.className = 'action-btn';
                btnDone.style.marginTop = '5px';
                btnDone.innerText = i18nData[currentLang].btn_mark_done || '[ MARK DONE ]';
                btnDone.onclick = async (e) => {
                    e.stopPropagation();
                    showTaskDetail(task.id);
                    alert(i18nData[currentLang].ph_review_comment || 'Please leave a review comment to complete the task.');
                };
                card.appendChild(btnDone);
            }

            col.appendChild(card);
        }
    });
}

function renderUrgentView() {
    const tbody = document.getElementById('urgent-table-body');
    tbody.innerHTML = '';
    
    const urgentTasks = allTasks.filter(t => t.is_urgent && t.status !== 'Done' && t.status !== 'Deleted');
    urgentTasks.forEach(task => {
        const tr = document.createElement('tr');
        tr.style.color = 'var(--urgent-color)';
        tr.innerHTML = `
            <td>${task.task_tag || ''}</td>
            <td>${task.title}</td>
            <td>${task.manager}</td>
            <td>${task.due_date}</td>
            <td>${task.status}</td>
        `;
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => showTaskDetail(task.id));
        tbody.appendChild(tr);
    });
}

function renderDoneView() {
    const tbody = document.getElementById('done-table-body');
    tbody.innerHTML = '';
    
    const term = document.getElementById('done-search').value.toLowerCase();
    
    const doneTasks = allTasks.filter(t => t.status === 'Done' && 
        (t.title.toLowerCase().includes(term) || t.manager.toLowerCase().includes(term))
    );

    doneTasks.forEach(task => {
        const tr = document.createElement('tr');
        const titleStr = task.is_urgent ? `[Urgent] ${task.title}` : task.title;
        if (task.is_urgent) {
            tr.style.color = 'var(--urgent-color)';
        }
        tr.innerHTML = `
            <td>${task.task_tag || ''}</td>
            <td>${titleStr}</td>
            <td>${task.manager}</td>
            <td>${task.created_at.split('T')[0]}</td>
        `;
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => showTaskDetail(task.id));
        tbody.appendChild(tr);
    });
}

function renderRecycleView() {
    const tbody = document.getElementById('recycle-table-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    const recycleTasks = allTasks.filter(t => t.status === 'Deleted');
    
    recycleTasks.forEach(task => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${task.task_tag || ''}</td>
            <td>${task.title}</td>
            <td>${task.manager}</td>
            <td>${task.created_at.split('T')[0]}</td>
            <td>
                <button class="action-btn" onclick="restoreTask(${task.id})" style="margin-right:5px; color:var(--col-review); border-color:var(--col-review)">${i18nData[currentLang].btn_restore || '[ RESTORE ]'}</button>
                <button class="action-btn" onclick="permDeleteTask(${task.id})" style="color:var(--urgent-color); border-color:var(--urgent-color)">${i18nData[currentLang].btn_perm_delete || '[ PERM. DELETE ]'}</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.restoreTask = async function(taskId) {
    await window.pywebview.api.update_task_status(taskId, 'Note');
    await refreshTasks();
};

window.permDeleteTask = async function(taskId) {
    if(await window.customConfirm(i18nData[currentLang].msg_perm_delete || "This action is irreversible. Delete permanently?")) {
        await window.pywebview.api.delete_task(taskId);
        await refreshTasks();
    }
};
function renderCalendar() {
    const grid = document.querySelector('.calendar-grid');
    grid.innerHTML = '';
    
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    
    document.getElementById('cal-month-year').innerText = `${year}-${String(month + 1).padStart(2, '0')}`;

    // Headers
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    days.forEach(day => {
        const header = document.createElement('div');
        header.className = 'cal-day-header';
        header.innerText = day;
        grid.appendChild(header);
    });

    // Days padding
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for(let i=0; i<firstDay; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'cal-day';
        emptyDay.style.opacity = '0.3';
        grid.appendChild(emptyDay);
    }

    // Days
    for(let i=1; i<=daysInMonth; i++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'cal-day';
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        dayDiv.dataset.date = dateStr;

        // Drop logic for Calendar
        dayDiv.addEventListener('dragover', e => {
            e.preventDefault();
            dayDiv.classList.add('drag-over');
        });
        dayDiv.addEventListener('dragleave', e => {
            dayDiv.classList.remove('drag-over');
        });
        dayDiv.addEventListener('drop', async e => {
            e.preventDefault();
            dayDiv.classList.remove('drag-over');
            const taskId = e.dataTransfer.getData('text/plain');
            
            // Find task to keep start_date
            const task = allTasks.find(t => t.id == taskId);
            if(task) {
                let targetDueDate = dateStr;
                if (task.start_date && targetDueDate < task.start_date) {
                    alert(i18nData[currentLang].msg_invalid_due_date || 'Due date must be the same as or after the Start Date.');
                    targetDueDate = task.start_date;
                }
                await window.pywebview.api.update_task_dates(taskId, task.start_date, targetDueDate);
                await refreshTasks();
            }
        });

        const dateNum = document.createElement('div');
        dateNum.className = 'cal-date-num';
        dateNum.innerText = i;
        dayDiv.appendChild(dateNum);

        // Find tasks for this day
        const dayTasks = allTasks.filter(t => t.due_date === dateStr && t.status !== 'Done' && t.status !== 'Deleted');
        dayTasks.forEach(task => {
            const tDiv = document.createElement('div');
            tDiv.className = `cal-task ${task.is_urgent ? 'urgent' : ''}`;
            tDiv.dataset.status = task.status;
            tDiv.innerHTML = `
                <div class="cal-task-title">${task.title}</div>
                <div class="cal-task-tag">${task.task_tag || ''}</div>
            `;
            tDiv.draggable = true;
            tDiv.addEventListener('dragstart', e => {
                e.dataTransfer.setData('text/plain', task.id);
            });
            tDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                showTaskDetail(task.id);
            });
            dayDiv.appendChild(tDiv);
        });

        grid.appendChild(dayDiv);
    }
}

// Modal Logic
function openModal(isUrgent) {
    document.getElementById('modal-is-urgent').value = isUrgent ? '1' : '0';
    document.getElementById('modal-title').value = '';
    document.getElementById('modal-content').value = '';
    document.getElementById('modal-manager').value = '';
    document.getElementById('modal-start').value = '';
    document.getElementById('modal-due').value = '';
    
    // Set color based on urgent
    const header = document.querySelector('.modal-header');
    header.style.color = isUrgent ? 'var(--urgent-color)' : '#FFF';
    
    taskModal.style.display = 'flex';
}

function closeModal() {
    taskModal.style.display = 'none';
}

async function saveTask() {
    const isUrgent = document.getElementById('modal-is-urgent').value === '1';
    const data = {
        title: document.getElementById('modal-title').value,
        content: document.getElementById('modal-content').value,
        manager: document.getElementById('modal-manager').value,
        start_date: document.getElementById('modal-start').value,
        due_date: document.getElementById('modal-due').value,
        is_urgent: isUrgent,
        status: isUrgent ? 'Doing' : 'Note'
    };

    if(!data.title) {
        alert('Title is required!');
        return;
    }

    if (data.start_date && data.due_date && data.due_date < data.start_date) {
        alert(i18nData[currentLang].msg_invalid_due_date || 'Due date must be the same as or after the Start Date.');
        data.due_date = data.start_date;
        document.getElementById('modal-due').value = data.due_date;
    }

    const res = await window.pywebview.api.add_task(data);
    if (res.status === 'success') {
        closeModal();
        await refreshTasks();
    } else {
        if (res.message === 'tag_limit_exceeded') {
            alert(i18nData[currentLang].msg_tag_limit_exceeded || 'Daily task creation limit is 99.');
        } else {
            alert(res.message);
        }
    }
}

function toggleEditMode(isEdit) {
    const viewEls = document.querySelectorAll('.detail-view-el');
    const editEls = document.querySelectorAll('.detail-edit-el');
    const editBtn = document.getElementById('detail-edit');
    const saveBtn = document.getElementById('detail-save-edit');
    const markDoneBtn = document.getElementById('detail-mark-done');
    const deleteBtn = document.getElementById('detail-delete');

    if (isEdit) {
        viewEls.forEach(el => el.style.display = 'none');
        editEls.forEach(el => el.style.display = 'block');
        editBtn.style.display = 'none';
        saveBtn.style.display = 'inline-block';
        markDoneBtn.style.display = 'none';
        deleteBtn.style.display = 'none';

        // Fill inputs with current values
        document.getElementById('detail-title-input').value = document.getElementById('detail-title').innerText;
        document.getElementById('detail-content-input').value = document.getElementById('detail-content').innerText;
        document.getElementById('detail-manager-input').value = document.getElementById('detail-manager').innerText;
        document.getElementById('detail-start-input').value = document.getElementById('detail-start').innerText;
        document.getElementById('detail-due-input').value = document.getElementById('detail-due').innerText;
    } else {
        viewEls.forEach(el => el.style.display = 'block');
        editEls.forEach(el => el.style.display = 'none');
        editBtn.style.display = 'inline-block';
        saveBtn.style.display = 'none';
        deleteBtn.style.display = 'inline-block';
        // markDoneBtn visibility is handled by showTaskDetail
    }
}

async function saveTaskEdit() {
    const taskId = document.getElementById('detail-delete').dataset.id;
    const data = {
        title: document.getElementById('detail-title-input').value,
        content: document.getElementById('detail-content-input').value,
        manager: document.getElementById('detail-manager-input').value,
        start_date: document.getElementById('detail-start-input').value,
        due_date: document.getElementById('detail-due-input').value
    };

    if (!data.title) {
        alert('Title is required!');
        return;
    }

    if (data.start_date && data.due_date && data.due_date < data.start_date) {
        alert(i18nData[currentLang].msg_invalid_due_date || 'Due date must be the same as or after the Start Date.');
        return;
    }

    const res = await window.pywebview.api.update_task_details(taskId, data);
    if (res.status === 'success') {
        toggleEditMode(false);
        await refreshTasks();
        showTaskDetail(taskId); // Refresh detail view
    } else {
        alert(res.message);
    }
}

function showTaskDetail(taskId) {
    const task = allTasks.find(t => t.id == taskId);
    if(!task) return;
    
    document.getElementById('detail-delete').dataset.id = task.id;
    document.getElementById('detail-tag').innerText = task.task_tag || '';
    
    document.getElementById('detail-title').innerText = task.title;
    document.getElementById('detail-content').innerText = task.content || '';
    document.getElementById('detail-status').innerText = task.status || '';
    
    // Set appropriate color for status text
    const statusEl = document.getElementById('detail-status');
    const rootStyles = getComputedStyle(document.documentElement);
    if(task.status === 'Note') statusEl.style.color = rootStyles.getPropertyValue('--col-note');
    else if(task.status === 'To-do') statusEl.style.color = rootStyles.getPropertyValue('--col-todo');
    else if(task.status === 'Doing') statusEl.style.color = rootStyles.getPropertyValue('--col-doing');
    else if(task.status === 'Review') statusEl.style.color = rootStyles.getPropertyValue('--col-review');
    else if(task.status === 'Done') statusEl.style.color = '#FFF';

    document.getElementById('detail-manager').innerText = task.manager || '';
    document.getElementById('detail-start').innerText = task.start_date || '';
    document.getElementById('detail-due').innerText = task.due_date || '';
    
    const reviewGroup = document.getElementById('detail-review-group');
    const reviewerInputContainer = document.getElementById('reviewer-input-container');
    const reviewInput = document.getElementById('detail-review-comment');
    const markDoneBtn = document.getElementById('detail-mark-done');
    
    if(task.status === 'Review') {
        reviewGroup.style.display = 'flex';
        reviewerInputContainer.style.display = 'flex';
        reviewerInputContainer.style.flexDirection = 'column';
        document.getElementById('detail-reviewer-name').value = '';
        reviewInput.value = task.review_comment || '';
        reviewInput.readOnly = false;
        markDoneBtn.style.display = 'inline-block';
    } else if (task.status === 'Done') {
        reviewGroup.style.display = 'flex';
        reviewerInputContainer.style.display = 'none';
        reviewInput.value = task.review_comment || '';
        reviewInput.readOnly = true;
        markDoneBtn.style.display = 'none';
    } else {
        reviewGroup.style.display = 'none';
        markDoneBtn.style.display = 'none';
    }
    
    
    toggleEditMode(false); // Ensure we start in view mode
    taskDetailModal.style.display = 'flex';
}

// --- Meeting Minutes Logic ---
let allMeetings = [];
let currentMeetingId = null;

const meetingList = document.getElementById('meeting-list');
const meetingTabs = document.querySelectorAll('.meeting-tab');
const meetingContents = document.querySelectorAll('.meeting-content');
const decisionRows = document.getElementById('decision-rows');
const actionRows = document.getElementById('action-rows');
const markdownPreview = document.getElementById('markdown-preview');

// Real-time Preview Listeners
['meeting-title', 'meeting-date', 'meeting-location', 'meeting-participants', 'meeting-memo'].forEach(id => {
    const el = document.getElementById(id);
    if(el) {
        el.addEventListener('input', () => {
            if(el.tagName === 'TEXTAREA') autoExpand(el);
            updateMarkdownPreview();
        });
    }
});

// For dynamic rows, we update preview after adding or removing
function updatePreviewOnInput() {
    updateMarkdownPreview();
}

async function refreshMeetings() {
    allMeetings = await window.pywebview.api.get_meetings();
    renderMeetingList();
}

const meetingSearch = document.getElementById('meeting-search');
if(meetingSearch) {
    meetingSearch.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        renderMeetingList(query);
    });
}

function renderMeetingList(filter = '') {
    if(!meetingList) return;
    meetingList.innerHTML = '';
    
    const filtered = allMeetings.filter(m => 
        m.title.toLowerCase().includes(filter) || 
        m.date.toLowerCase().includes(filter)
    );

    filtered.forEach(m => {
        const item = document.createElement('div');
        item.className = 'meeting-item-wrapper';
        if(m.id === currentMeetingId) item.classList.add('active');
        
        const content = document.createElement('div');
        content.className = 'meeting-item';
        content.innerHTML = `
            <span class="m-date">${m.date}</span>
            <span class="m-title">${m.title}</span>
        `;
        content.onclick = () => loadMeeting(m.id);
        
        const delBtn = document.createElement('button');
        delBtn.className = 'btn-delete-mom';
        delBtn.innerText = '[X]';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteMOM(m.id);
        };
        
        item.appendChild(content);
        item.appendChild(delBtn);
        meetingList.appendChild(item);
    });
}

async function deleteMOM(id) {
    if(await window.customConfirm(i18nData[currentLang]?.msg_confirm_delete_meeting || 'Delete this meeting note?')) {
        await window.pywebview.api.delete_meeting(id);
        if(currentMeetingId === id) resetMeetingEditor();
        refreshMeetings();
    }
}

function loadMeeting(id) {
    const meeting = allMeetings.find(m => m.id === id);
    if(!meeting) return;
    currentMeetingId = id;
    renderMeetingList();

    document.getElementById('meeting-title').value = meeting.title;
    document.getElementById('meeting-date').value = meeting.date;
    document.getElementById('meeting-location').value = meeting.location;
    document.getElementById('meeting-participants').value = meeting.participants;
    document.getElementById('meeting-memo').value = meeting.memo || '';
    
    // Auto expand memo
    setTimeout(() => autoExpand(document.getElementById('meeting-memo')), 0);

    decisionRows.innerHTML = '';
    const decisions = JSON.parse(meeting.decisions || '[]');
    decisions.forEach(d => addDecisionRow(d));

    actionRows.innerHTML = '';
    const actions = JSON.parse(meeting.action_items || '[]');
    actions.forEach(a => addActionRow(a));

    updateMarkdownPreview();
}

function addDecisionRow(data = {issue: '', decision: '', reason: ''}) {
    const row = document.createElement('div');
    row.className = 'dynamic-row';
    row.innerHTML = `
        <button class="btn-remove">&times;</button>
        <div class="editor-row">
            <div class="editor-group"><label data-i18n="mom_issue">안건/이슈</label><textarea class="d-issue">${data.issue}</textarea></div>
        </div>
        <div class="editor-row">
            <div class="editor-group"><label data-i18n="mom_decision">결정 사항</label><textarea class="d-decision">${data.decision}</textarea></div>
        </div>
        <div class="editor-row">
            <div class="editor-group"><label data-i18n="mom_reason">결정 근거</label><textarea class="d-reason">${data.reason}</textarea></div>
        </div>
    `;
    row.querySelector('.btn-remove').onclick = () => {
        row.remove();
        updateMarkdownPreview();
    };
    row.querySelectorAll('textarea').forEach(ta => {
        ta.addEventListener('input', () => {
            autoExpand(ta);
            updateMarkdownPreview();
        });
        // Initial expand if loading data
        setTimeout(() => autoExpand(ta), 0);
    });
    decisionRows.appendChild(row);
    applyLanguage(currentLang);
    updateMarkdownPreview();
}

function autoExpand(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

function addActionRow(data = {}) {
    const row = document.createElement('div');
    row.className = 'dynamic-row';
    row.innerHTML = `
        <button class="btn-remove">&times;</button>
        <div class="editor-row">
            <div class="editor-group"><label data-i18n="modal_title">Title</label><input type="text" class="a-title" value="${data.title || ''}"></div>
        </div>
        <div class="editor-row">
            <div class="editor-group"><label data-i18n="modal_content">Content</label><textarea class="a-content">${data.content || ''}</textarea></div>
        </div>
        <div class="editor-row-multi">
            <div class="editor-group"><label data-i18n="modal_manager">Manager</label><input type="text" class="a-manager" value="${data.manager || ''}"></div>
            <div class="editor-group"><label data-i18n="modal_start_date">Start Date</label><input type="date" class="a-start" value="${data.start_date || ''}"></div>
            <div class="editor-group"><label data-i18n="modal_due_date">Due Date</label><input type="date" class="a-due" value="${data.due_date || ''}"></div>
        </div>
        <div class="editor-row" style="margin-top: 10px; display: flex; justify-content: flex-end;">
            <button class="action-btn btn-export-task" style="font-size: 0.7em;">[ TASK EXPORT ]</button>
        </div>
    `;
    row.querySelector('.btn-remove').onclick = () => {
        row.remove();
        updateMarkdownPreview();
    };
    row.querySelector('.btn-export-task').onclick = () => exportActionItemToTask(row);

    row.querySelectorAll('textarea, input').forEach(el => {
        el.addEventListener('input', () => {
            if(el.tagName === 'TEXTAREA') autoExpand(el);
            updateMarkdownPreview();
        });
        if(el.tagName === 'TEXTAREA') setTimeout(() => autoExpand(el), 0);
    });
    actionRows.appendChild(row);
    applyLanguage(currentLang);
    updateMarkdownPreview();
}

if(document.getElementById('btn-add-decision')) document.getElementById('btn-add-decision').onclick = () => addDecisionRow();
if(document.getElementById('btn-add-action')) document.getElementById('btn-add-action').onclick = () => addActionRow();

if(document.getElementById('btn-new-meeting')) document.getElementById('btn-new-meeting').onclick = () => resetMeetingEditor();
if(document.getElementById('btn-reset-meeting')) document.getElementById('btn-reset-meeting').onclick = () => resetMeetingEditor();

async function exportActionItemToTask(row) {
    console.log("Exporting action item as task...");
    const title = row.querySelector('.a-title').value;
    const content = row.querySelector('.a-content').value;
    const manager = row.querySelector('.a-manager').value;
    const start_date = row.querySelector('.a-start').value;
    const due_date = row.querySelector('.a-due').value;

    if(!title || !content || !manager || !start_date || !due_date) {
        alert(currentLang === 'en' ? 'All fields must be completed.' : '모든 항목이 작성되어야 합니다.');
        return;
    }

    try {
        const res = await window.pywebview.api.add_task({
            title: title,
            content: content,
            manager: manager,
            start_date: start_date,
            due_date: due_date
        });
        console.log("Add task response:", res);
        if(res.status === 'success') {
            alert(currentLang === 'en' ? 'Exported to Task Manager successfully.' : 'Task Manager로 성공적으로 내보냈습니다.');
        } else {
            alert("Error: " + res.message);
        }
    } catch (e) {
        console.error("Export failed", e);
        alert("Export failed: " + e);
    }
}

function resetMeetingEditor() {
    currentMeetingId = null;
    document.getElementById('meeting-title').value = '';
    document.getElementById('meeting-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('meeting-location').value = '';
    document.getElementById('meeting-participants').value = '';
    document.getElementById('meeting-memo').value = '';
    document.getElementById('meeting-memo').style.height = 'auto';
    decisionRows.innerHTML = '';
    actionRows.innerHTML = '';
    markdownPreview.innerText = '';
    renderMeetingList();
}

function updateMarkdownPreview() {
    const title = document.getElementById('meeting-title').value || 'Untitled';
    const date = document.getElementById('meeting-date').value;
    const location = document.getElementById('meeting-location').value;
    const participants = document.getElementById('meeting-participants').value;
    const memo = document.getElementById('meeting-memo').value;

    const lang = i18nData[currentLang];

    let md = `# 📝 ${title}\n\n`;
    md += `**${lang.mom_label_date}** ${date}\n`;
    md += `**${lang.mom_label_location}** ${location}\n`;
    md += `**${lang.mom_label_participants}** ${participants}\n\n`;

    if(memo) {
        md += `## ${lang.mom_free_memo}\n${memo}\n\n`;
    }

    md += `## ${lang.mom_decisions_header}\n`;
    const dRows = decisionRows.querySelectorAll('.dynamic-row');
    if(dRows.length > 0) {
        dRows.forEach(row => {
            md += `- **${row.querySelector('.d-issue').value}**\n`;
            md += `  - ${lang.mom_decision}: ${row.querySelector('.d-decision').value}\n`;
            md += `  - ${lang.mom_reason}: ${row.querySelector('.d-reason').value}\n`;
        });
    } else {
        md += `*(${currentLang === 'en' ? 'None' : '없음'})*\n`;
    }

    md += `\n## ${lang.mom_actions_header}\n`;
    const aRows = actionRows.querySelectorAll('.dynamic-row');
    if(aRows.length > 0) {
        aRows.forEach((row, index) => {
            const t = row.querySelector('.a-title').value || '(No Title)';
            const c = row.querySelector('.a-content').value;
            const m = row.querySelector('.a-manager').value;
            const s = row.querySelector('.a-start').value;
            const d = row.querySelector('.a-due').value;
            
            md += `${index + 1}. **${t}**\n`;
            if(c) md += `   - ${lang.modal_content} ${c}\n`;
            if(m) md += `   - ${lang.modal_manager} ${m}\n`;
            if(s || d) md += `   - ${lang.mom_label_date} ${s} ~ ${d}\n`;
            md += `\n`;
        });
    } else {
        md += `*(${currentLang === 'en' ? 'None' : '없음'})*\n`;
    }

    markdownPreview.innerText = md;
    return md;
}

if(document.getElementById('btn-save-meeting')) document.getElementById('btn-save-meeting').onclick = async () => {
    const decisions = [];
    decisionRows.querySelectorAll('.dynamic-row').forEach(row => {
        decisions.push({
            issue: row.querySelector('.d-issue').value,
            decision: row.querySelector('.d-decision').value,
            reason: row.querySelector('.d-reason').value
        });
    });

    const actions = [];
    actionRows.querySelectorAll('.dynamic-row').forEach(row => {
        actions.push({
            title: row.querySelector('.a-title').value,
            content: row.querySelector('.a-content').value,
            manager: row.querySelector('.a-manager').value,
            start_date: row.querySelector('.a-start').value,
            due_date: row.querySelector('.a-due').value
        });
    });

    const data = {
        id: currentMeetingId,
        title: document.getElementById('meeting-title').value,
        date: document.getElementById('meeting-date').value,
        location: document.getElementById('meeting-location').value,
        participants: document.getElementById('meeting-participants').value,
        memo: document.getElementById('meeting-memo').value,
        decisions: JSON.stringify(decisions),
        action_items: JSON.stringify(actions)
    };

    const res = await window.pywebview.api.save_meeting(data);
    if(res.status === 'success') {
        currentMeetingId = res.id;
        alert('Saved successfully.');
        refreshMeetings();
    }
};

if(document.getElementById('btn-copy-md')) document.getElementById('btn-copy-md').onclick = () => {
    const md = updateMarkdownPreview();
    navigator.clipboard.writeText(md);
    alert('Markdown copied to clipboard.');
};

if(document.getElementById('btn-export-md')) document.getElementById('btn-export-md').onclick = async () => {
    const decisions = [];
    decisionRows.querySelectorAll('.dynamic-row').forEach(row => {
        decisions.push({
            issue: row.querySelector('.d-issue').value,
            decision: row.querySelector('.d-decision').value,
            reason: row.querySelector('.d-reason').value
        });
    });

    const actions = [];
    actionRows.querySelectorAll('.dynamic-row').forEach(row => {
        actions.push({
            title: row.querySelector('.a-title').value,
            content: row.querySelector('.a-content').value,
            manager: row.querySelector('.a-manager').value,
            start_date: row.querySelector('.a-start').value,
            due_date: row.querySelector('.a-due').value
        });
    });

    const data = {
        title: document.getElementById('meeting-title').value,
        date: document.getElementById('meeting-date').value,
        location: document.getElementById('meeting-location').value,
        participants: document.getElementById('meeting-participants').value,
        memo: document.getElementById('meeting-memo').value,
        decisions: JSON.stringify(decisions),
        action_items: JSON.stringify(actions)
    };

    // Prompt user to select a folder
    const selectedFolder = await window.pywebview.api.select_folder();
    if (!selectedFolder) return; // User cancelled

    data.save_dir = selectedFolder;

    const res = await window.pywebview.api.export_meeting_md(data);
    if(res.status === 'success') {
        alert(`Exported successfully to: ${res.path}`);
    }
};

if(document.getElementById('btn-export-all-md')) document.getElementById('btn-export-all-md').onclick = async () => {
    // Prompt user to select a folder
    const selectedFolder = await window.pywebview.api.select_folder();
    if (!selectedFolder) return; // User cancelled

    const res = await window.pywebview.api.export_all_meetings_md(selectedFolder);
    if(res.status === 'success') {
        alert(`Successfully exported ${res.count} meeting notes to: ${selectedFolder}`);
    }
};

// Localization
async function loadI18n() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout
        
        const response = await fetch('i18n.json', { signal: controller.signal });
        clearTimeout(timeoutId);
        i18nData = await response.json();
    } catch (e) {
        console.error("Failed to load i18n", e);
        // Fallback to empty object to prevent app from breaking
        i18nData = {};
    }
}

function updateSidebarClock() {
    const clockDateEl = document.getElementById('clock-date');
    const clockDayEl = document.getElementById('clock-day');
    const clockTimeEl = document.getElementById('clock-time');
    if (!clockDateEl || !clockTimeEl) return;

    const now = new Date();
    const daysKR = ['일', '월', '화', '수', '목', '금', '토'];
    const daysEN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = currentLang === 'kr' ? daysKR : daysEN;
    
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    const day = days[now.getDay()];
    
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    clockDateEl.innerText = `${year}/${month}/${date}`;
    if (clockDayEl) clockDayEl.innerText = `(${day})`;
    clockTimeEl.innerText = `${hours}:${minutes}:${seconds}`;

    // Scheduled Idle Messages
    const idleMsg = getIdleMessage();
    const msgEl = document.getElementById('noti-msg-text');
    
    if (!isNotiTyping && notiQueue.length === 0 && !isConfirmActive && !isShowingAlert && msgEl) {
        if (msgEl.innerText !== idleMsg) {
            msgEl.innerText = idleMsg;
            const gifEl = document.getElementById('noti-gif');
            if (idleMsg !== "" && gifEl) {
                gifEl.src = "stare_1.gif"; 
            }
        }
    }
}

function applyLanguage(lang) {
    currentLang = lang;
    updateSidebarClock();
    if(!i18nData[lang]) return;

    // Standard text replacement
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if(i18nData[lang][key]) {
            el.innerText = i18nData[lang][key];
        }
    });

    // Placeholder replacement
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        const key = el.getAttribute('data-i18n-ph');
        if(i18nData[lang][key]) {
            el.placeholder = i18nData[lang][key];
        }
    });
    // Re-render project components
    if(currentProjectId) {
        ensurePMLogButtons();
        const pmTimetableTab = document.getElementById('pm-timetable-tab');
        if(pmTimetableTab && pmTimetableTab.style.display !== 'none') {
            renderTimeTable();
        }
        refreshStatusLogs();
    }
}

// --- Project Manager Logic ---
let allProjects = [];
let currentProjectId = null;

function getDeptDisplayName(deptCode) {
    const p = allProjects.find(x => x.id === currentProjectId);
    if(!p) return deptCode;
    if(deptCode === 'Mech') return p.dept1_name || '[DPT. 1]';
    if(deptCode === 'Control') return p.dept2_name || '[DPT. 2]';
    if(deptCode === 'Elec') return p.dept3_name || '[DPT. 3]';
    if(deptCode === 'Sales') return p.dept4_name || '[DPT. 4]';
    return deptCode;
}

async function refreshProjects() {
    allProjects = await window.pywebview.api.get_projects();
    renderProjectList();
    if(currentProjectId) {
        loadProject(currentProjectId);
    } else if(allProjects.length > 0) {
        loadProject(allProjects[0].id);
    } else {
        document.getElementById('project-dashboard').style.display = 'none';
    }
}

function renderProjectList() {
    const list = document.getElementById('project-list');
    if(!list) return;
    list.innerHTML = '';
    
    const searchVal = document.getElementById('project-search')?.value.toLowerCase() || '';
    const filtered = allProjects.filter(p => (p.name || '').toLowerCase().includes(searchVal));

    filtered.forEach(p => {
        const wrapper = document.createElement('div');
        wrapper.className = 'project-item-wrapper' + (p.id === currentProjectId ? ' active' : '');
        
        const item = document.createElement('div');
        item.className = 'project-item';
        item.innerText = p.name || 'Untitled';
        item.onclick = () => loadProject(p.id);
        
        const doneBtn = document.createElement('button');
        doneBtn.className = 'btn-done-project';
        doneBtn.innerText = '[DONE]';
        doneBtn.onclick = async (e) => {
            e.stopPropagation();
            if(await window.customConfirm(i18nData[currentLang]?.msg_confirm_done_project || 'Mark this project as DONE?')) {
                await window.pywebview.api.mark_project_done(p.id);
                if(currentProjectId === p.id) currentProjectId = null;
                refreshProjects();
            }
        };
        
        const delBtn = document.createElement('button');
        delBtn.className = 'btn-delete-project';
        delBtn.innerText = '[X]';
        delBtn.onclick = async (e) => {
            e.stopPropagation();
            if(await window.customConfirm(i18nData[currentLang]?.msg_confirm_delete_project || 'Delete this project? All logs will be deleted.')) {
                await window.pywebview.api.delete_project(p.id);
                if(currentProjectId === p.id) currentProjectId = null;
                refreshProjects();
            }
        };
        
        wrapper.appendChild(item);
        wrapper.appendChild(doneBtn);
        wrapper.appendChild(delBtn);
        list.appendChild(wrapper);
    });
}

async function loadProject(id) {
    currentProjectId = id;
    ensurePMLogButtons();
    document.getElementById('project-done-view').style.display = 'none';
    document.getElementById('project-deleted-view').style.display = 'none';
    renderProjectList();
    
    const p = allProjects.find(x => x.id === id);
    if(!p) return;
    
    document.getElementById('project-dashboard').style.display = 'flex';
    document.getElementById('project-name').value = p.name;
    document.getElementById('project-manager').value = p.manager;
    document.getElementById('project-client').value = p.client;
    document.getElementById('project-desc').value = p.description;
    
    document.getElementById('project-dept1-name').value = p.dept1_name || '[DPT. 1]';
    document.getElementById('project-dept2-name').value = p.dept2_name || '[DPT. 2]';
    document.getElementById('project-dept3-name').value = p.dept3_name || '[DPT. 3]';
    document.getElementById('project-dept4-name').value = p.dept4_name || '[DPT. 4]';
    
    // Update headers
    document.getElementById('pm-dept1-header').innerText = p.dept1_name || '[DPT. 1]';
    document.getElementById('pm-dept2-header').innerText = p.dept2_name || '[DPT. 2]';
    document.getElementById('pm-dept3-header').innerText = p.dept3_name || '[DPT. 3]';
    document.getElementById('pm-dept4-header').innerText = p.dept4_name || '[DPT. 4]';
    
    const activeTab = document.querySelector('.pm-tab.active');
    const targetTab = activeTab ? activeTab.dataset.target : 'pm-active-tab';
    
    if(targetTab === 'pm-timetable-tab') {
        await renderTimeTable();
        await renderMilestones(id);
    } else if(targetTab === 'pm-milestone-tab') {
        await renderMilestones(id);
    } else {
        await refreshStatusLogs();
    }
}

async function showDoneProjects() {
    currentProjectId = null;
    renderProjectList();
    
    document.getElementById('project-dashboard').style.display = 'none';
    document.getElementById('project-deleted-view').style.display = 'none';
    document.getElementById('project-done-view').style.display = 'flex';
    
    const doneProjects = await window.pywebview.api.get_projects('done');
    const tbody = document.getElementById('pm-done-projects-table-body');
    tbody.innerHTML = '';
    
    doneProjects.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:bold;">${p.name}</td>
            <td>${p.manager}</td>
            <td>${p.client}</td>
            <td style="font-size:0.8em; color:#565f89;">${p.created_at}</td>
            <td></td>
        `;
        const actionTd = tr.querySelector('td:last-child');
        
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'action-btn';
        restoreBtn.innerText = '[RESTORE]';
        restoreBtn.style.color = 'var(--col-review)';
        restoreBtn.onclick = async () => {
            await window.pywebview.api.restore_project(p.id);
            showDoneProjects();
            refreshProjects();
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'action-btn';
        delBtn.innerText = '[PERM. DELETE]';
        delBtn.style.color = 'var(--urgent-color)';
        delBtn.onclick = async () => {
            if(await window.customConfirm(i18nData[currentLang]?.msg_confirm_perm_delete_project || 'Are you sure you want to PERMANENTLY delete this project and all its logs?')) {
                await window.pywebview.api.delete_project_permanent(p.id);
                showDoneProjects();
            }
        };
        
        actionTd.appendChild(restoreBtn);
        actionTd.appendChild(delBtn);
        tbody.appendChild(tr);
    });
}

async function showDeletedProjects() {
    currentProjectId = null;
    renderProjectList();
    
    document.getElementById('project-dashboard').style.display = 'none';
    document.getElementById('project-done-view').style.display = 'none';
    document.getElementById('project-deleted-view').style.display = 'flex';
    
    const deletedProjects = await window.pywebview.api.get_projects('deleted');
    const tbody = document.getElementById('pm-deleted-projects-table-body');
    tbody.innerHTML = '';
    
    deletedProjects.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:bold;">${p.name}</td>
            <td>${p.manager}</td>
            <td>${p.client}</td>
            <td style="font-size:0.8em; color:#565f89;">${p.created_at}</td>
            <td></td>
        `;
        const actionTd = tr.querySelector('td:last-child');
        
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'action-btn';
        restoreBtn.innerText = '[RESTORE]';
        restoreBtn.style.color = 'var(--col-review)';
        restoreBtn.onclick = async () => {
            await window.pywebview.api.restore_project(p.id);
            showDeletedProjects();
            refreshProjects();
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'action-btn';
        delBtn.innerText = '[PERM. DELETE]';
        delBtn.style.color = 'var(--urgent-color)';
        delBtn.onclick = async () => {
            if(await window.customConfirm(i18nData[currentLang]?.msg_confirm_perm_delete_project || 'Are you sure you want to PERMANENTLY delete this project and all its logs?')) {
                await window.pywebview.api.delete_project_permanent(p.id);
                showDeletedProjects();
            }
        };
        
        actionTd.appendChild(restoreBtn);
        actionTd.appendChild(delBtn);
        tbody.appendChild(tr);
    });
}

const btnNewProject = document.getElementById('btn-new-project');
if(btnNewProject) {
    btnNewProject.addEventListener('click', async () => {
        const res = await window.pywebview.api.save_project({name: 'New Project'});
        if(res.status === 'success') {
            await refreshProjects();
            loadProject(res.id);
        }
    });
}

const btnRefreshProjectsMain = document.getElementById('btn-refresh-projects-main');
if(btnRefreshProjectsMain) {
    btnRefreshProjectsMain.addEventListener('click', async () => {
        const btn = btnRefreshProjectsMain;
        btn.disabled = true;
        btn.innerText = i18nData[currentLang]?.pm_btn_refresh_loading || '[ ... ]';
        await refreshProjects();
        btn.disabled = false;
        btn.innerText = i18nData[currentLang]?.pm_btn_refresh || '[ REFRESH ]';
    });
}

const btnDeleteProject = document.getElementById('btn-delete-project');
if(btnDeleteProject) {
    btnDeleteProject.addEventListener('click', async () => {
        if(!currentProjectId) return;
        if(await window.customConfirm(i18nData[currentLang]?.msg_confirm_perm_delete || 'Delete?')) {
            await window.pywebview.api.delete_project(currentProjectId);
            currentProjectId = null;
            await refreshProjects();
        }
    });
}

// Auto-save Project Info (Debounce)
let projectSaveTimeout = null;
['project-name', 'project-manager', 'project-client', 'project-desc', 'project-dept1-name', 'project-dept2-name', 'project-dept3-name', 'project-dept4-name'].forEach(id => {
    const el = document.getElementById(id);
    if(el) {
        el.addEventListener('input', () => {
            if(projectSaveTimeout) clearTimeout(projectSaveTimeout);
            projectSaveTimeout = setTimeout(async () => {
                if(!currentProjectId) return;
                const data = {
                    id: currentProjectId,
                    name: document.getElementById('project-name').value,
                    manager: document.getElementById('project-manager').value,
                    client: document.getElementById('project-client').value,
                    description: document.getElementById('project-desc').value,
                    dept1_name: document.getElementById('project-dept1-name').value,
                    dept2_name: document.getElementById('project-dept2-name').value,
                    dept3_name: document.getElementById('project-dept3-name').value,
                    dept4_name: document.getElementById('project-dept4-name').value
                };
                await window.pywebview.api.save_project(data);
                allProjects = await window.pywebview.api.get_projects();
                renderProjectList();
                // Update headers immediately
                document.getElementById('pm-dept1-header').innerText = data.dept1_name || '[DPT. 1]';
                document.getElementById('pm-dept2-header').innerText = data.dept2_name || '[DPT. 2]';
                document.getElementById('pm-dept3-header').innerText = data.dept3_name || '[DPT. 3]';
                document.getElementById('pm-dept4-header').innerText = data.dept4_name || '[DPT. 4]';
            }, 1000);
        });
    }
});

// Status Logs
async function refreshStatusLogs() {
    if(!currentProjectId) return;
    const logs = await window.pywebview.api.get_status_logs(currentProjectId);
    
    const activeLogs = logs.filter(l => l.status === 'active' || !l.status);
    const doneLogs = logs.filter(l => l.status === 'done');
    const deletedLogs = logs.filter(l => l.status === 'deleted');
    
    const depts = ['Mech', 'Control', 'Elec', 'Sales'];
    for(const dept of depts) {
        const list = document.getElementById(`log-list-${dept}`);
        if(!list) continue;
        list.innerHTML = '';
        const deptLogs = activeLogs.filter(l => l.department === dept);
        
        for(const log of deptLogs) {
            const item = document.createElement('div');
            item.className = 'log-item';
            
            let html = `<div class="log-item-header">
                <span class="log-time">[${log.timestamp}]</span>
                <span style="color: #7AA2F7; font-weight: bold; margin-left: 5px;">[${log.tag}]</span>
            </div>`;
            
            if(log.title) {
                html += `<div style="color: var(--accent-color); font-weight: bold; margin: 5px 0;">${log.title}</div>`;
            }
            if(log.manager) {
                html += `<div style="font-size: 0.85em; color: #aaa;">Manager: ${log.manager}</div>`;
            }
            if(log.start_date || log.due_date) {
                html += `<div style="font-size: 0.85em; color: #888;">${log.start_date || '?'} ~ ${log.due_date || '?'}</div>`;
            }
            if(log.text_content) {
                html += `<div class="log-text" style="margin-top: 5px; white-space: pre-wrap;">${log.text_content}</div>`;
            }
            item.innerHTML = html;
            
            if(log.image_path) {
                const img = document.createElement('img');
                img.className = 'log-image-thumb';
                img.src = await window.pywebview.api.get_local_image_base64(log.image_path);
                img.onclick = () => {
                    document.getElementById('image-viewer-img').src = img.src;
                    document.getElementById('image-viewer-modal').style.display = 'flex';
                };
                item.appendChild(img);
            }
            
            const delBtn = document.createElement('button');
            delBtn.className = 'log-delete-btn';
            delBtn.innerText = '[X]';
            delBtn.title = "Move to Deleted";
            delBtn.onclick = async () => {
                if(await window.customConfirm(i18nData[currentLang]?.msg_confirm_move_deleted || 'Move this log to Deleted?')) {
                    await window.pywebview.api.mark_status_log_deleted(log.id);
                    refreshStatusLogs();
                }
            };
            item.appendChild(delBtn);
            
            const editBtn = document.createElement('button');
            editBtn.className = 'log-delete-btn';
            editBtn.style.right = '95px';
            editBtn.style.color = 'var(--col-doing)';
            editBtn.innerText = i18nData[currentLang]?.btn_edit || '[ EDIT ]';
            editBtn.onclick = () => openPMModal(log.department, log);
            item.appendChild(editBtn);

            const doneBtn = document.createElement('button');
            doneBtn.className = 'log-delete-btn';
            doneBtn.style.right = '35px';
            doneBtn.style.color = 'var(--accent-color)';
            doneBtn.innerText = i18nData[currentLang]?.pm_btn_done || '[ DONE ]';
            doneBtn.onclick = async () => {
                if(await window.customConfirm(i18nData[currentLang]?.msg_confirm_done || 'Mark this log as done?')) {
                    await window.pywebview.api.mark_status_log_done(log.id);
                    refreshStatusLogs();
                }
            };
            item.appendChild(doneBtn);
            
            list.appendChild(item);
        }
        // scroll to bottom
        list.scrollTop = list.scrollHeight;
    }
    
    // Render Done Table
    await renderStatusTable('pm-done-table-body', doneLogs, 'pm_done_search_localized', false);
    
    // Render Deleted Table
    await renderStatusTable('pm-deleted-table-body', deletedLogs, 'pm_deleted_search_localized', true);
}

async function renderStatusTable(tbodyId, logs, searchId, isDeleted) {
    const tbody = document.getElementById(tbodyId);
    if(!tbody) return;
    tbody.innerHTML = '';
    
    const searchEl = document.getElementById(searchId);
    const term = searchEl ? searchEl.value.toLowerCase() : '';
    
    const filteredLogs = logs.filter(l => {
        const tagMatch = (l.tag || '').toLowerCase().includes(term);
        const contentMatch = (l.text_content || '').toLowerCase().includes(term);
        
        // Localized Dept search
        const deptKey = 'dept_' + (l.department || '').toLowerCase();
        const localizedDept = (i18nData[currentLang][deptKey] || l.department || '').toLowerCase();
        const deptMatch = localizedDept.includes(term) || (l.department || '').toLowerCase().includes(term);
        
        return tagMatch || contentMatch || deptMatch;
    });
    
    const sorted = [...filteredLogs].reverse(); // newest first
    for(const log of sorted) {
        const tr = document.createElement('tr');
        
        let contentHtml = log.text_content;
        if(log.image_path) {
            contentHtml += `<br><span class="img-preview-link" style="color:var(--col-doing); cursor:pointer; font-size:0.8em; text-decoration: underline;">[ View Image ]</span>`;
        }
        
        const deptName = getDeptDisplayName(log.department);
        
        let deptColor = 'var(--text-color)';
        if (log.department === 'Mech') deptColor = 'var(--col-doing)';
        else if (log.department === 'Control') deptColor = 'var(--col-review)';
        else if (log.department === 'Elec') deptColor = 'var(--col-todo)';
        else if (log.department === 'Sales') deptColor = 'var(--urgent-color)';

        tr.innerHTML = `
            <td style="font-size:0.9em; font-weight:bold; color:var(--col-doing);">${log.tag || ''}</td>
            <td style="font-size:0.9em; font-weight:bold; color:${deptColor};">${deptName}</td>
            <td style="font-size:0.8em; color:#565f89;">${log.timestamp}</td>
            <td style="white-space: pre-wrap;">${contentHtml}</td>
            <td></td>
        `;
        
        const actionTd = tr.querySelector('td:last-child');
        
        // Restore Button
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'action-btn';
        restoreBtn.style.color = 'var(--col-review)';
        restoreBtn.style.borderColor = 'var(--col-review)';
        restoreBtn.style.fontSize = '0.75em';
        restoreBtn.style.marginRight = '5px';
        restoreBtn.innerText = i18nData[currentLang].btn_restore || '[ RESTORE ]';
        restoreBtn.onclick = async () => {
            await window.pywebview.api.restore_status_log(log.id);
            refreshStatusLogs();
        };
        if(isDeleted || log.status === 'done') {
            actionTd.appendChild(restoreBtn);
        }

        // Delete Button
        const delBtn = document.createElement('button');
        delBtn.className = 'action-btn';
        delBtn.style.color = 'var(--urgent-color)';
        delBtn.style.borderColor = 'var(--urgent-color)';
        delBtn.style.fontSize = '0.75em';
        if(isDeleted) {
            delBtn.innerText = i18nData[currentLang].btn_perm_delete || '[ PERM. DELETE ]';
            delBtn.onclick = async () => {
                const msg = i18nData[currentLang].msg_perm_delete || "This action is irreversible. Delete permanently?";
                if(await window.customConfirm(msg)) {
                    await window.pywebview.api.delete_status_log_permanent(log.id); // New API for perm delete
                    refreshStatusLogs();
                }
            };
        } else {
            delBtn.innerText = '[X]';
            delBtn.title = "Move to Deleted";
            delBtn.onclick = async () => {
                if(await window.customConfirm(i18nData[currentLang]?.msg_confirm_move_deleted || 'Move this log to Deleted?')) {
                    await window.pywebview.api.mark_status_log_deleted(log.id);
                    refreshStatusLogs();
                }
            };
        }
        actionTd.appendChild(delBtn);
        
        // Image View Listener
        if(log.image_path) {
            tr.querySelector('.img-preview-link').onclick = async () => {
                const b64 = await window.pywebview.api.get_local_image_base64(log.image_path);
                document.getElementById('image-viewer-img').src = b64;
                document.getElementById('image-viewer-modal').style.display = 'flex';
            };
        }
        
        tbody.appendChild(tr);
    }
}

function ensurePMLogButtons() {
    ['Mech', 'Control', 'Elec', 'Sales'].forEach(dept => {
        const col = document.querySelector(`.status-col.${dept.toLowerCase()}`);
        if(col && !col.querySelector('.pm-add-log-btn')) {
            // Remove old input area if it exists
            const oldArea = col.querySelector('.log-input-area');
            if(oldArea) oldArea.remove();
            
            const btn = document.createElement('button');
            btn.className = 'pm-add-log-btn';
            btn.dataset.dept = dept;
            btn.dataset.i18n = 'pm_btn_add_log';
            btn.style.width = '100%';
            btn.style.border = '1px dotted #333';
            btn.style.background = 'transparent';
            btn.style.color = '#888';
            btn.style.padding = '10px';
            btn.style.cursor = 'pointer';
            btn.style.fontFamily = "'Cascadia Code', monospace";
            btn.innerText = i18nData[currentLang]?.pm_btn_add_log || '[ ADD LOG ]';
            btn.onclick = () => openPMModal(dept);
            col.appendChild(btn);
        }
    });
}

// Log Modal Logic
let currentPMDept = null;
let currentEditingLogId = null;

function openPMModal(dept, log = null) {
    currentPMDept = dept;
    currentEditingLogId = log ? log.id : null;
    
    const deptName = getDeptDisplayName(dept);
    
    if(log) {
        document.getElementById('pm-log-modal-header').innerText = `[ ${i18nData[currentLang].btn_edit || 'EDIT LOG'} - ${deptName.toUpperCase()} ]`;
        document.getElementById('pm-log-title').value = log.title || '';
        document.getElementById('pm-log-content').value = log.text_content || '';
        document.getElementById('pm-log-manager').value = log.manager || '';
        document.getElementById('pm-log-start').value = log.start_date || '';
        document.getElementById('pm-log-due').value = log.due_date || '';
        document.getElementById('pm-log-img-path').value = log.image_path || '';
        document.getElementById('pm-log-img-preview').innerText = log.image_path ? "Attached: " + log.image_path.split('\\').pop().split('/').pop() : '';
    } else {
        document.getElementById('pm-log-modal-header').innerText = `[ ${i18nData[currentLang].modal_new_task || 'NEW LOG'} - ${deptName.toUpperCase()} ]`;
        document.getElementById('pm-log-title').value = '';
        document.getElementById('pm-log-content').value = '';
        document.getElementById('pm-log-manager').value = '';
        document.getElementById('pm-log-start').value = new Date().toISOString().split('T')[0];
        document.getElementById('pm-log-due').value = new Date().toISOString().split('T')[0];
        document.getElementById('pm-log-img-path').value = '';
        document.getElementById('pm-log-img-preview').innerText = '';
    }
    document.getElementById('pm-log-modal').style.display = 'flex';
}

document.querySelectorAll('.pm-add-log-btn').forEach(btn => {
    btn.onclick = () => openPMModal(btn.dataset.dept);
});

document.getElementById('pm-log-cancel').onclick = () => {
    document.getElementById('pm-log-modal').style.display = 'none';
};

document.getElementById('pm-log-due').onchange = () => {
    const start = document.getElementById('pm-log-start').value;
    const due = document.getElementById('pm-log-due').value;
    if(start && due && due < start) {
        alert(i18nData[currentLang].msg_invalid_due_date || "Due Date cannot be earlier than Start Date.");
        document.getElementById('pm-log-due').value = start;
    }
};

document.getElementById('pm-log-start').onchange = () => {
    const start = document.getElementById('pm-log-start').value;
    const due = document.getElementById('pm-log-due').value;
    if(start && due && due < start) {
        document.getElementById('pm-log-due').value = start;
    }
};

document.getElementById('pm-log-upload-img').onclick = async () => {
    if(!currentProjectId) return;
    const res = await window.pywebview.api.upload_project_image(currentProjectId);
    if(res.status === 'success') {
        document.getElementById('pm-log-img-path').value = res.path;
        document.getElementById('pm-log-img-preview').innerText = "Attached: " + res.path.split('\\').pop().split('/').pop();
    }
};

document.getElementById('pm-log-save').onclick = async () => {
    if(!currentProjectId || !currentPMDept) return;
    
    const start = document.getElementById('pm-log-start').value;
    const due = document.getElementById('pm-log-due').value;
    if(start && due && due < start) {
        alert(i18nData[currentLang].msg_invalid_due_date || "Due Date cannot be earlier than Start Date.");
        return;
    }

    const data = {
        project_id: currentProjectId,
        department: currentPMDept,
        title: document.getElementById('pm-log-title').value.trim(),
        text_content: document.getElementById('pm-log-content').value.trim(),
        manager: document.getElementById('pm-log-manager').value.trim(),
        start_date: start,
        due_date: due,
        image_path: document.getElementById('pm-log-img-path').value
    };
    
    if(!data.title && !data.text_content && !data.image_path) {
        alert("Please enter at least a title or content.");
        return;
    }

    if(data.start_date && data.due_date && data.due_date < data.start_date) {
        alert(i18nData[currentLang].msg_invalid_due_date || "Due Date cannot be earlier than Start Date.");
        return;
    }
    
    if(currentEditingLogId) {
        data.id = currentEditingLogId;
        await window.pywebview.api.update_status_log(data);
    } else {
        await window.pywebview.api.save_status_log(data);
    }
    
    document.getElementById('pm-log-modal').style.display = 'none';
    refreshStatusLogs();
    renderTimeTable();
    
    // Refresh detail area if it was open for the edited log
    if(currentEditingLogId && currentEditingLogId === currentDetailLogId) {
        refreshPMTimetableLogDetail(currentDetailLogId);
    }
};

// PM Done/Deleted Search Listeners
const pmDoneSearch = document.getElementById('pm_done_search_localized');
if(pmDoneSearch) pmDoneSearch.addEventListener('input', refreshStatusLogs);
const pmDeletedSearch = document.getElementById('pm_deleted_search_localized');
if(pmDeletedSearch) pmDeletedSearch.addEventListener('input', refreshStatusLogs);

// PM Timetable Scale & Filter Listeners
const pmTimetableScale = document.getElementById('pm-timetable-scale');
if(pmTimetableScale) pmTimetableScale.addEventListener('change', renderTimeTable);
const pmTimetableShowDeleted = document.getElementById('pm-timetable-show-deleted');
if(pmTimetableShowDeleted) pmTimetableShowDeleted.addEventListener('change', renderTimeTable);

// PM Timetable Nav
const pmTimetablePrev = document.getElementById('pm-timetable-prev');
if(pmTimetablePrev) pmTimetablePrev.onclick = () => {
    const scale = document.getElementById('pm-timetable-scale').value;
    if(scale === 'weekly') timetableBaseDate.setDate(timetableBaseDate.getDate() - 1);
    else timetableBaseDate.setMonth(timetableBaseDate.getMonth() - 1);
    renderTimeTable();
};
const pmTimetableNext = document.getElementById('pm-timetable-next');
if(pmTimetableNext) pmTimetableNext.onclick = () => {
    const scale = document.getElementById('pm-timetable-scale').value;
    if(scale === 'weekly') timetableBaseDate.setDate(timetableBaseDate.getDate() + 1);
    else timetableBaseDate.setMonth(timetableBaseDate.getMonth() + 1);
    renderTimeTable();
};

// Project Search Listener
const projectSearch = document.getElementById('project-search');
if(projectSearch) projectSearch.addEventListener('input', renderProjectList);

const btnShowDoneProjects = document.getElementById('btn-show-done-projects');
if(btnShowDoneProjects) btnShowDoneProjects.onclick = showDoneProjects;

const btnShowDeletedProjects = document.getElementById('btn-show-deleted-projects');
if(btnShowDeletedProjects) btnShowDeletedProjects.onclick = showDeletedProjects;



const btnExportHtml = document.getElementById('pm-timetable-export-html');
if(btnExportHtml) {
    btnExportHtml.addEventListener('click', async () => {
        if(!currentProjectId) return;
        const result = await window.pywebview.api.export_project_html(currentProjectId);
        if(result.status === 'success') {
            const msg = i18nData[currentLang].msg_exported || "Exported successfully to:";
            alert(`${msg}\n${result.path}`);
        } else {
            if(result.message !== 'User cancelled export.') {
                alert(`Export failed: ${result.message}`);
            }
        }
    });
}

// PM Tabs Switching
document.querySelectorAll('.pm-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.pm-tab').forEach(t => {
            t.classList.remove('active');
            t.style.color = '#888';
        });
        document.querySelectorAll('.pm-tab-content').forEach(c => c.style.display = 'none');
        
        tab.classList.add('active');
        tab.style.color = 'var(--text-color)';
        const target = document.getElementById(tab.dataset.target);
        if(target) target.style.display = 'flex';
        
        const controls = document.getElementById('pm-timetable-controls');
        
        if(tab.dataset.target === 'pm-timetable-tab') {
            if(controls) controls.style.display = 'flex';
            renderTimeTable();
            renderMilestones(currentProjectId);
        } else if(tab.dataset.target === 'pm-milestone-tab') {
            if(controls) controls.style.display = 'none';
            renderMilestones(currentProjectId);
        } else if(tab.dataset.target === 'pm-active-tab') {
            if(controls) controls.style.display = 'none';
            refreshStatusLogs();
        } else {
            if(controls) controls.style.display = 'none';
            refreshStatusLogs();
        }
    });
});

async function renderTimeTable() {
    if(!currentProjectId) return;
    const logs = await window.pywebview.api.get_status_logs(currentProjectId);
    const milestones = await window.pywebview.api.get_milestones(currentProjectId);
    const container = document.getElementById('pm-timetable-container');
    const scaleSelect = document.getElementById('pm-timetable-scale');
    if(!scaleSelect || !container) return;
    const scale = scaleSelect.value;
    
    container.innerHTML = '';
    
    // Determine date range and scale
    const now = new Date();
    let startDate, days;
    
    if(scale === 'weekly') {
        startDate = new Date(timetableBaseDate);
        startDate.setDate(startDate.getDate() - 3); // Center around base
        startDate.setHours(0,0,0,0);
        days = 7;
    } else {
        // Monthly view = 12 months range
        startDate = new Date(timetableBaseDate.getFullYear(), timetableBaseDate.getMonth() - 5, 1);
        days = 12; // Show 12 months
    }

    function calculatePct(date) {
        if(scale === 'weekly') {
            const diffTime = date.getTime() - startDate.getTime();
            const diffDays = diffTime / (1000 * 3600 * 24);
            if(diffDays >= -1 && diffDays <= 8) { // buffer
                return (diffDays / 7) * 100;
            }
        } else {
            const monthDiff = (date.getFullYear() - startDate.getFullYear()) * 12 + (date.getMonth() - startDate.getMonth());
            if(monthDiff >= -1 && monthDiff <= 13) {
                const day = date.getDate();
                const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
                return ((monthDiff + (day / daysInMonth)) / 12) * 100;
            }
        }
        return -1;
    }
    
    const header = document.createElement('div');
    header.className = 'timetable-header';
    
    const yHeader = document.createElement('div');
    yHeader.className = 'timetable-y-axis-header';
    header.appendChild(yHeader);
    
    const xAxis = document.createElement('div');
    xAxis.className = 'timetable-x-axis';
    xAxis.style.position = 'relative';
    
    if(milestones.length > 0) {
        const sorted = [...milestones].filter(m => m.deadline).sort((a,b) => new Date(a.deadline) - new Date(b.deadline));
        sorted.forEach((m, idx) => {
            const mDate = new Date(m.deadline);
            const pct = calculatePct(mDate);
            if(pct >= 0 && pct <= 100) {
                const line = document.createElement('div');
                line.className = 'milestone-line';
                if(m.is_done) line.classList.add('is-done');
                line.style.left = pct + '%';
                line.style.height = '1000px'; 
                line.style.top = '0';
                
                const label = document.createElement('div');
                label.className = 'milestone-line-label';
                label.innerText = m.name;
                // Stagger labels below header text (approx 35px down)
                label.style.top = (32 + (idx % 3) * 20) + 'px';
                line.appendChild(label);
                
                xAxis.appendChild(line);
            }
        });
    }
    
    const dayNames = currentLang === 'kr' ? ['일', '월', '화', '수', '목', '금', '토'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = currentLang === 'kr' ? 
        ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'] : 
        ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    for(let i=0; i<days; i++) {
        const dayCol = document.createElement('div');
        dayCol.className = 'timetable-day-col';
        
        if(scale === 'weekly') {
            const d = new Date(startDate);
            d.setDate(startDate.getDate() + i);
            if(d.toDateString() === now.toDateString()) dayCol.classList.add('today');
            const m = d.getMonth() + 1;
            const day = d.getDate();
            const dayName = dayNames[d.getDay()];
            dayCol.innerText = `${m}/${day} (${dayName})`;
            
            // Highlight if milestone
            const dStr = getLocalDateString(d);
            const dayMilestones = milestones.filter(ms => ms.deadline === dStr);
            if(dayMilestones.length > 0) {
                dayCol.classList.add('milestone-highlight');
                if(dayMilestones.every(ms => ms.is_done)) {
                    dayCol.classList.add('is-done');
                }
            }
        } else {
            // Monthly view labels with Year
            const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
            const y = d.getFullYear();
            const m = d.getMonth();
            dayCol.innerText = `${y} ${monthNames[m]}`;
            if(y === now.getFullYear() && m === now.getMonth()) dayCol.classList.add('today');
        }
        xAxis.appendChild(dayCol);
    }
    header.appendChild(xAxis);
    container.appendChild(header);
    
    const body = document.createElement('div');
    body.className = 'timetable-body';
    
    const depts = ['Mech', 'Control', 'Elec', 'Sales'];
    const deptColors = {
        'Mech': 'var(--col-doing)',
        'Control': 'var(--col-review)',
        'Elec': 'var(--col-todo)',
        'Sales': 'var(--urgent-color)'
    };
    const deptI18nKeys = {
        'Mech': 'dept_mech',
        'Control': 'dept_control',
        'Elec': 'dept_elec',
        'Sales': 'dept_sales'
    };

    depts.forEach(dept => {
        const track = document.createElement('div');
        track.className = 'timetable-track';
        
        const label = document.createElement('div');
        label.className = 'timetable-track-label';
        const deptDisplayName = getDeptDisplayName(dept);
        label.innerText = `[ ${deptDisplayName.toUpperCase()} ]`;
        label.style.color = deptColors[dept] || '#aaa';
        track.appendChild(label);
        
        const content = document.createElement('div');
        content.className = 'timetable-track-content';
        content.style.backgroundSize = `${(100/days)}% 100%`;
        
        const showDeleted = document.getElementById('pm-timetable-show-deleted')?.checked;
        
        let deptLogs = logs.filter(l => l.department === dept);
        if(!showDeleted) {
            deptLogs = deptLogs.filter(l => l.status !== 'deleted');
        }
        
        // Sort by time
        deptLogs.sort((a, b) => new Date(a.timestamp.replace(' ', 'T')) - new Date(b.timestamp.replace(' ', 'T')));
        
        const placedMarkers = [];

        deptLogs.forEach(log => {
            let leftPct = -1;
            let widthPct = -1;

            const sDateStr = log.start_date;
            const dDateStr = log.due_date;
            const logDate = new Date(log.timestamp.replace(' ', 'T'));

            if(sDateStr && dDateStr && sDateStr !== dDateStr) {
                // Range display
                const s = new Date(sDateStr);
                const d = new Date(dDateStr);
                d.setHours(23,59,59,999); // End of day

                leftPct = calculatePct(s);
                const rightPct = calculatePct(d);
                if(leftPct !== -1 && rightPct !== -1) {
                    widthPct = rightPct - leftPct;
                    if(widthPct < 0.5) widthPct = 0.5; // Minimum visibility
                } else if(leftPct !== -1) {
                    widthPct = 100 - leftPct; // overflow right
                } else if(rightPct !== -1) {
                    widthPct = rightPct; // overflow left
                    leftPct = 0;
                }
            } else {
                // Point display
                const targetDate = sDateStr ? new Date(sDateStr) : logDate;
                leftPct = calculatePct(targetDate);
            }
            
            if(leftPct !== -1) {
                // Overlap prevention (vertical stacking)
                let lane = 0;
                const minDistance = 2; // % distance
                while(placedMarkers.some(m => Math.abs(m.left - leftPct) < minDistance && m.lane === lane)) {
                    lane++;
                }
                placedMarkers.push({left: leftPct, lane: lane});
                
                const laneOffsets = [0, -16, 16, -24, 24];
                const finalOffset = laneOffsets[lane % laneOffsets.length];

                const marker = document.createElement('div');
                marker.className = widthPct !== -1 ? 'timetable-log-range' : 'timetable-log-marker';
                marker.dataset.dept = dept;
                
                marker.style.left = leftPct + '%';
                if(widthPct !== -1) {
                    marker.style.width = widthPct + '%';
                }
                marker.style.top = (30 + finalOffset) + 'px'; // Base at 50% (30px)
                marker.style.backgroundColor = deptColors[dept] || 'var(--accent-color)';
                
                const tooltipEl = document.getElementById('global-timetable-tooltip');
                const imgText = i18nData[currentLang].pm_status_log_image_attached || 'Image attached';
                let logText = log.text_content || `[ ${imgText} ]`;
                let tooltipContent = `[${log.timestamp}]<br>${logText.replace(/\n/g, '<br>')}`;
                
                if(log.status === 'deleted') {
                    marker.classList.add('deleted');
                    tooltipContent = `<span style="text-decoration: line-through; opacity: 0.6;">[${log.timestamp}]<br>${logText.replace(/\n/g, '<br>')}</span>`;
                } else if(log.status === 'done') {
                    marker.classList.add('done');
                    const doneTag = i18nData[currentLang].pm_status_done || 'DONE';
                    tooltipContent = `<span style="color: #7AA2F7; font-weight:bold;">[${doneTag}]</span><br>[${log.timestamp}]<br>${logText.replace(/\n/g, '<br>')}`;
                }
                
                marker.onmouseenter = (e) => {
                    tooltipEl.innerHTML = tooltipContent;
                    tooltipEl.style.display = 'block';
                    tooltipEl.style.left = (e.clientX + 15) + 'px';
                    tooltipEl.style.top = (e.clientY + 15) + 'px';
                };
                
                marker.onmousemove = (e) => {
                    tooltipEl.style.left = (e.clientX + 15) + 'px';
                    tooltipEl.style.top = (e.clientY + 15) + 'px';
                };
                
                marker.onmouseleave = () => {
                    tooltipEl.style.display = 'none';
                };
                
                marker.onclick = () => {
                    refreshPMTimetableLogDetail(log.id);
                };
                
                content.appendChild(marker);
            }
        });
        
        track.appendChild(content);
        body.appendChild(track);
    });
    
    
    container.appendChild(body);
}

// Image Viewer Close
const imgViewerClose = document.getElementById('image-viewer-close');
if(imgViewerClose) {
    imgViewerClose.addEventListener('click', () => {
        document.getElementById('image-viewer-modal').style.display = 'none';
    });
}

let currentDetailLogId = null;
async function refreshPMTimetableLogDetail(logId) {
    if(!logId) return;
    currentDetailLogId = logId;
    
    // Fetch latest logs to get updated data
    const logs = await window.pywebview.api.get_status_logs(currentProjectId);
    const log = logs.find(l => l.id === logId);
    if(!log) {
        document.getElementById('pm-timetable-log-detail').style.display = 'none';
        currentDetailLogId = null;
        return;
    }

    const detailArea = document.getElementById('pm-timetable-log-detail');
    const header = document.getElementById('pm-timetable-detail-header');
    const contentArea = document.getElementById('pm-timetable-detail-content');
    const imgContainer = document.getElementById('pm-timetable-detail-image');
    
    detailArea.style.display = 'flex';
    let statusTag = '';
    if(log.status === 'done') statusTag = ` [${i18nData[currentLang].pm_status_done || 'DONE'}]`;
    else if(log.status === 'deleted') statusTag = ` [${i18nData[currentLang].pm_status_deleted || 'DELETED'}]`;
    
    const deptName = getDeptDisplayName(log.department);
    header.innerText = `[${deptName.toUpperCase()}] ${log.tag || ''} - ${log.timestamp}${statusTag}`;
    
    let html = '';
    if(log.title) html += `<div style="font-weight: bold; color: var(--accent-color); font-size: 1.1em; margin-bottom: 5px;">${log.title}</div>`;
    if(log.manager) html += `<div style="font-size: 0.9em; color: #aaa;">Manager: ${log.manager}</div>`;
    if(log.start_date || log.due_date) html += `<div style="font-size: 0.9em; color: #888;">Schedule: ${log.start_date || '?'} ~ ${log.due_date || '?'}</div>`;
    if(log.text_content) html += `<div style="margin-top: 8px; white-space: pre-wrap; color: #ddd;">${log.text_content}</div>`;
    
    contentArea.innerHTML = html;
    
    imgContainer.innerHTML = '';
    if(log.image_path) {
        const img = document.createElement('img');
        img.style.height = '80px';
        img.style.border = '1px solid #333';
        img.style.cursor = 'pointer';
        img.src = await window.pywebview.api.get_local_image_base64(log.image_path);
        img.onclick = () => {
            document.getElementById('image-viewer-img').src = img.src;
            document.getElementById('image-viewer-modal').style.display = 'flex';
        };
        imgContainer.appendChild(img);
    }

    const editBtn = document.getElementById('pm-timetable-detail-edit');
    const doneBtn = document.getElementById('pm-timetable-detail-done');
    const restoreBtn = document.getElementById('pm-timetable-detail-restore');
    const delBtn = document.getElementById('pm-timetable-detail-delete');
    
    editBtn.style.display = (log.status === 'done' || log.status === 'deleted') ? 'none' : 'block';
    doneBtn.style.display = (log.status === 'done' || log.status === 'deleted') ? 'none' : 'block';
    restoreBtn.style.display = (log.status === 'done' || log.status === 'deleted') ? 'block' : 'none';
    delBtn.style.display = (log.status === 'deleted') ? 'none' : 'block';
    
    editBtn.onclick = () => {
        openPMModal(log.department, log);
    };
    
    doneBtn.onclick = async () => {
        if(await window.customConfirm(i18nData[currentLang].msg_confirm_done || "Mark as DONE?")) {
            await window.pywebview.api.mark_status_log_done(log.id);
            refreshStatusLogs();
            renderTimeTable();
            refreshPMTimetableLogDetail(log.id);
        }
    };

    restoreBtn.onclick = async () => {
        if(await window.customConfirm(i18nData[currentLang].msg_confirm_restore || "Restore this log?")) {
            await window.pywebview.api.restore_status_log(log.id);
            refreshStatusLogs();
            renderTimeTable();
            refreshPMTimetableLogDetail(log.id);
        }
    };
    
    delBtn.onclick = async () => {
        if(await window.customConfirm(i18nData[currentLang].msg_confirm_delete || "Delete this log?")) {
            await window.pywebview.api.delete_status_log(log.id);
            refreshStatusLogs();
            renderTimeTable();
            refreshPMTimetableLogDetail(log.id);
        }
    };
}

// Helper for local YYYY-MM-DD
function getLocalDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Milestones Logic
async function renderMilestones(projectId) {
    if(!projectId) return;
    const milestones = await window.pywebview.api.get_milestones(projectId);
    
    // 1. Populate Management Tab
    // Reset all 10 slots
    for(let i=1; i<=10; i++) {
        const row = document.querySelector(`#milestone-management-list .milestone-row[data-slot="${i}"]`);
        if(!row) continue;
        
        const nameInput = row.querySelector('.ms-name');
        const deadlineInput = row.querySelector('.ms-deadline');
        const contentInput = row.querySelector('.ms-content');
        const saveBtn = row.querySelector('.btn-ms-save');
        const editBtn = row.querySelector('.btn-ms-edit');
        const doneBtn = row.querySelector('.btn-ms-done');
        
        nameInput.value = '';
        deadlineInput.value = '';
        contentInput.value = '';
        
        nameInput.disabled = false;
        deadlineInput.disabled = false;
        contentInput.disabled = false;
        
        saveBtn.style.display = 'inline-block';
        editBtn.style.display = 'none';
        doneBtn.style.display = 'none';
        doneBtn.innerText = i18nData[currentLang].pm_btn_done || '[ DONE ]';
        row.classList.remove('saved');
        row.classList.remove('is-done');
        row.style.opacity = '1';
    }
    
    // Populate slots
    milestones.forEach(m => {
        const row = document.querySelector(`#milestone-management-list .milestone-row[data-slot="${m.slot_number}"]`);
        if(!row) return;
        
        const nameInput = row.querySelector('.ms-name');
        const deadlineInput = row.querySelector('.ms-deadline');
        const contentInput = row.querySelector('.ms-content');
        const saveBtn = row.querySelector('.btn-ms-save');
        const editBtn = row.querySelector('.btn-ms-edit');
        const doneBtn = row.querySelector('.btn-ms-done');
        
        nameInput.value = m.name || '';
        deadlineInput.value = m.deadline || '';
        contentInput.value = m.content || '';
        
        if(m.is_saved) {
            nameInput.disabled = true;
            deadlineInput.disabled = true;
            contentInput.disabled = true;
            saveBtn.style.display = 'none';
            editBtn.style.display = 'inline-block';
            doneBtn.style.display = 'inline-block';
            row.classList.add('saved');
            
            if(m.is_done) {
                row.classList.add('is-done');
                row.style.opacity = '0.6';
                doneBtn.innerText = i18nData[currentLang].pm_btn_completed || '[ COMPLETED ]';
                doneBtn.style.color = 'var(--text-color)';
            } else {
                doneBtn.innerText = i18nData[currentLang].pm_btn_done || '[ DONE ]';
                doneBtn.style.color = 'var(--accent-color)';
            }
        }
    });

    // 2. Populate Read-only list in Time Table
    const listContainer = document.getElementById('pm-timetable-ms-list');
    if(listContainer) {
        listContainer.innerHTML = '';
        const savedMs = milestones.filter(m => m.is_saved && m.name && m.deadline);
        if(savedMs.length === 0) {
            const noMsg = i18nData[currentLang].msg_no_milestones || "No milestones registered.";
            listContainer.innerHTML = `<div style="color: #666; font-size: 0.9em; font-style: italic;">${noMsg}</div>`;
        } else {
            savedMs.sort((a,b) => new Date(a.deadline) - new Date(b.deadline));
            savedMs.forEach(m => {
                const item = document.createElement('div');
                item.style.fontSize = '0.95em';
                item.style.padding = '12px 20px';
                item.style.background = m.is_done ? 'rgba(86, 95, 137, 0.1)' : 'rgba(158, 206, 106, 0.05)';
                item.style.borderLeft = m.is_done ? '4px solid #565f89' : '4px solid var(--col-review)';
                item.style.borderRadius = '2px';
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.whiteSpace = 'nowrap';
                item.style.overflow = 'hidden';
                item.style.textOverflow = 'ellipsis';
                item.style.marginBottom = '10px';
                item.style.opacity = m.is_done ? '0.6' : '1';
                
                const doneMark = m.is_done ? `<span style="color: #565f89; margin-right: 10px; font-weight: bold;">[COMPLETED]</span>` : '';
                const textStyle = m.is_done ? 'text-decoration: line-through; color: #565f89;' : 'color: #fff;';

                item.innerHTML = `
                    <span style="color: ${m.is_done ? '#565f89' : 'var(--col-review)'}; font-weight: bold; width: 120px; flex-shrink: 0; ${m.is_done ? 'text-decoration: line-through;' : ''}">[ ${m.deadline} ]</span>
                    ${doneMark}
                    <span style="${textStyle} margin-left: 10px; font-weight: bold; flex-shrink: 0;">${m.name}</span>
                    ${m.content ? `<span style="color: #666; margin-left: 30px; font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; ${m.is_done ? 'text-decoration: line-through;' : ''}">- ${m.content}</span>` : ''}
                `;
                listContainer.appendChild(item);
            });
        }
    }
}

// Initialize Milestone Listeners
document.querySelectorAll('.btn-ms-save').forEach(btn => {
    btn.onclick = async (e) => {
        const row = e.target.closest('.milestone-row');
        const slot = parseInt(row.dataset.slot);
        const name = row.querySelector('.ms-name').value.trim();
        const deadline = row.querySelector('.ms-deadline').value;
        const content = row.querySelector('.ms-content').value.trim();
        
        if(!name) {
            alert((i18nData[currentLang].pm_milestone_name || "Name") + " is required.");
            return;
        }

        if(!deadline) {
            alert((i18nData[currentLang].pm_milestone_deadline || "Deadline") + " is required.");
            return;
        }

        // Check for duplicate dates
        const milestones = await window.pywebview.api.get_milestones(currentProjectId);
        const isDuplicate = milestones.some(m => m.slot_number !== slot && m.deadline === deadline);
        if(isDuplicate) {
            alert(currentLang === 'kr' ? '하나의 목표일에 여러개의 마일스톤을 설정할 수 없습니다.' : 'Cannot set multiple milestones on the same target date.');
            return;
        }
        
        await window.pywebview.api.save_milestone({
            project_id: currentProjectId,
            slot_number: slot,
            name: name,
            deadline: deadline,
            content: content,
            is_saved: true
        });
        
        renderMilestones(currentProjectId);
        renderTimeTable(); // Refresh timetable to show the new milestone line/highlight
    };
});

document.querySelectorAll('.btn-ms-edit').forEach(btn => {
    btn.onclick = (e) => {
        const row = e.target.closest('.milestone-row');
        row.querySelector('.ms-name').disabled = false;
        row.querySelector('.ms-deadline').disabled = false;
        row.querySelector('.ms-content').disabled = false;
        row.querySelector('.btn-ms-save').style.display = 'inline-block';
        row.querySelector('.btn-ms-edit').style.display = 'none';
        row.classList.remove('saved');
    };
});

document.querySelectorAll('.btn-ms-delete').forEach(btn => {
    btn.onclick = async (e) => {
        if(!await window.customConfirm(i18nData[currentLang].msg_confirm_delete || "Delete?")) return;
        const row = e.target.closest('.milestone-row');
        const slot = parseInt(row.dataset.slot);
        
        await window.pywebview.api.delete_milestone(currentProjectId, slot);
        renderMilestones(currentProjectId);
    };
});

document.querySelectorAll('.btn-ms-done').forEach(btn => {
    btn.onclick = async (e) => {
        const row = e.target.closest('.milestone-row');
        const slot = parseInt(row.dataset.slot);
        const milestones = await window.pywebview.api.get_milestones(currentProjectId);
        const m = milestones.find(ms => ms.slot_number === slot);
        
        if(!m) return;
        
        // Toggle is_done
        const newDoneState = !m.is_done;
        
        await window.pywebview.api.save_milestone({
            project_id: currentProjectId,
            slot_number: slot,
            name: m.name,
            deadline: m.deadline,
            content: m.content,
            is_saved: true,
            is_done: newDoneState
        });
        
        renderMilestones(currentProjectId);
        renderTimeTable();
    };
});
