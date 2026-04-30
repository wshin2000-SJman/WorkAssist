// Global State
let i18nData = {};
let currentLang = 'en';
let allTasks = [];
let currentMonth = new Date();

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
    await loadI18n();
    applyLanguage(currentLang);
    setupEventListeners();
    setupAuthListeners();
    
    // Display version
    const version = await window.pywebview.api.get_app_version();
    document.getElementById('app-version-login').innerText = version;
    document.getElementById('app-version-main').innerText = version;
});

// Setup Event Listeners
function setupAuthListeners() {
    // Login
    document.getElementById('btn-do-login').addEventListener('click', async () => {
        const id = document.getElementById('login-id-input').value;
        const pw = document.getElementById('login-pw-input').value;
        const res = await window.pywebview.api.login(id, pw);
        if(res.status === 'success') {
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
    if(confirm(i18nData[currentLang].msg_perm_delete || "This action is irreversible. Delete permanently?")) {
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
    if(confirm('Delete this meeting note?')) {
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
        const response = await fetch('i18n.json');
        i18nData = await response.json();
    } catch (e) {
        console.error("Failed to load i18n", e);
    }
}

function applyLanguage(lang) {
    currentLang = lang;
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
}
