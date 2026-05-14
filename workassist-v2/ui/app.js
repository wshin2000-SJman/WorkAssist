// Tauri API access
let invoke;

try {
    if (window.__TAURI__) {
        invoke = window.__TAURI__.core.invoke;
        console.log("Tauri API Loaded Successfully");
    } else {
        console.error("Tauri API not found. window.__TAURI__ is undefined.");
    }
} catch (e) {
    console.error("Error initializing Tauri API:", e);
}

let currentTasks = [];
let currentMeetings = [];
let currentProjects = [];
let currentView = 'nav-dashboard';
let draggingTaskId = null;

let currentUser = null;

const init = () => {
    console.log('WorkAssist UI Initialized');
    setupAuth();
    
    if (!invoke) {
        console.error("Critical: Tauri Backend not connected. Check DevTools for details.");
        return;
    }

    // Navigation logic
    const navItems = document.querySelectorAll('.nav-item');
    const pageTitle = document.getElementById('page-title');
    const views = document.querySelectorAll('.view');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            console.log("Navigating to:", item.id);
            navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            currentView = item.id;
            const viewName = item.textContent.trim();
            pageTitle.textContent = viewName;
            
            const targetViewId = `view-${item.id.replace('nav-', '')}`;
            views.forEach(v => v.classList.add('hidden'));
            const targetView = document.getElementById(targetViewId);
            if (targetView) targetView.classList.remove('hidden');
            
            loadView(item.id);
        });
    });

    setupModals();
    initDragAndDrop();
};

function setupAuth() {
    const formLogin = document.getElementById('form-login');
    const loginIdInput = document.getElementById('login-id');
    const loginPwInput = document.getElementById('login-pw');
    const viewLogin = document.getElementById('view-login');
    const appContainer = document.querySelector('.app-container');

    if (formLogin) {
        formLogin.onsubmit = async (e) => {
            e.preventDefault();
            const username = loginIdInput.value;
            const password = loginPwInput.value;

            if (!username || !password) {
                alert('Please enter both ID and Password');
                return;
            }

            try {
                // Use passwordHash to match Rust's snake_case -> JS camelCase naming
                const user = await invoke('login', { username, passwordHash: password });
                if (user) {
                    console.log("Login Success:", user);
                    currentUser = user;
                    viewLogin.classList.add('hidden');
                    appContainer.classList.remove('hidden');
                    loadDashboard();
                    refreshStats(); // Call both just in case
                } else {
                    alert('Invalid ID or Password');
                }
            } catch (err) {
                console.error("Login Error:", err);
                alert('Login failed: ' + err);
            }
        };
    }

    const btnShowSignup = document.getElementById('btn-show-signup');
    const btnShowHint = document.getElementById('btn-show-hint');
    const btnShowChangePw = document.getElementById('btn-show-change-pw');
    const modalSignup = document.getElementById('modal-signup');
    const modalChangePw = document.getElementById('modal-change-pw');

    if (btnShowSignup) {
        btnShowSignup.onclick = () => {
            modalSignup.classList.remove('hidden');
            document.getElementById('signup-id').value = '';
            document.getElementById('signup-pw').value = '';
            document.getElementById('signup-hint').value = '';
        };
    }

    if (btnShowChangePw) {
        btnShowChangePw.onclick = () => {
            modalChangePw.classList.remove('hidden');
            document.getElementById('change-pw-id').value = '';
            document.getElementById('change-pw-old').value = '';
            document.getElementById('change-pw-new').value = '';
            document.getElementById('change-pw-hint').value = '';
        };
    }
    
    const modalHint = document.getElementById('modal-hint');
    if (btnShowHint) {
        btnShowHint.onclick = () => {
            modalHint.classList.remove('hidden');
            document.getElementById('hint-display').classList.add('hidden');
            document.getElementById('hint-query-id').value = '';
        };
    }

    const btnGetHintSubmit = document.getElementById('btn-get-hint-submit');
    if (btnGetHintSubmit) {
        btnGetHintSubmit.onclick = async () => {
            const id = document.getElementById('hint-query-id').value;
            if (!id) return alert('Please enter ID.');
            try {
                const hint = await invoke('get_password_hint', { username: id });
                const display = document.getElementById('hint-display');
                const text = document.getElementById('hint-text');
                if (hint) {
                    text.textContent = hint;
                    display.classList.remove('hidden');
                } else {
                    alert('No hint found for this user.');
                }
            } catch (err) { alert('Error fetching hint.'); }
        };
    }

    // Signup form
    document.getElementById('form-signup').onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('signup-id').value;
        const pw = document.getElementById('signup-pw').value;
        const hint = document.getElementById('signup-hint').value;
        try {
            await invoke('create_user', { username: id, passwordHash: pw, hint });
            alert('Account created successfully!');
            modalSignup.classList.add('hidden');
        } catch (err) { alert('Failed to create account.'); }
    };

    // Change PW form
    document.getElementById('form-change-pw').onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('change-pw-id').value;
        const oldPw = document.getElementById('change-pw-old').value;
        const newPw = document.getElementById('change-pw-new').value;
        const newHint = document.getElementById('change-pw-hint').value;
        try {
            const success = await invoke('change_password', { username: id, oldHash: oldPw, newHash: newPw, newHint: newHint });
            if (success) {
                alert('Password updated!');
                modalChangePw.classList.add('hidden');
            } else {
                alert('Incorrect ID or current password.');
            }
        } catch (err) { alert('Failed to update password.'); }
    };

    // Logout
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.onclick = () => {
            if (confirm('Are you sure you want to logout?')) {
                currentUser = null;
                appContainer.classList.add('hidden');
                viewLogin.classList.remove('hidden');
                viewLogin.style.opacity = '1';
                
                // Reset inputs
                document.getElementById('login-id').value = '';
                document.getElementById('login-pw').value = '';
            }
        };
    }

    const navSettings = document.getElementById('nav-settings');
    const modalSettings = document.getElementById('modal-settings');
    if (navSettings) {
        navSettings.onclick = (e) => {
            e.preventDefault();
            modalSettings.classList.remove('hidden');
        };
    }

    const btnManualBackup = document.getElementById('btn-manual-backup');
    if (btnManualBackup) {
        btnManualBackup.onclick = async () => {
            try {
                // In Tauri v2, dialog is often via plugin-dialog
                const path = await window.__TAURI__.dialog.save({
                    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
                    defaultPath: 'sjworkassist_v2_manual_backup.db'
                });
                
                if (path) {
                    await invoke('manual_backup', { path });
                    alert('Manual backup successful!');
                }
            } catch (err) {
                console.error('Backup error:', err);
                alert('Backup failed. Make sure you are running in Tauri.');
            }
        };
    }

    const btnImportDb = document.getElementById('btn-import-db');
    if (btnImportDb) {
        btnImportDb.onclick = async () => {
            if (confirm('Importing a database will overwrite your current data. The app will restart after import. Continue?')) {
                try {
                    const path = await window.__TAURI__.dialog.open({
                        multiple: false,
                        filters: [{ name: 'SQLite Database', extensions: ['db'] }]
                    });
                    
                    if (path) {
                        await invoke('import_db', { path });
                        alert('Import successful! The app will now close. Please restart it.');
                        // Close app to ensure new DB is loaded correctly on next start
                        window.close(); 
                    }
                } catch (err) {
                    console.error('Import error:', err);
                    alert('Import failed.');
                }
            }
        };
    }

    const btnInitializeDb = document.getElementById('btn-initialize-db');
    if (btnInitializeDb) {
        btnInitializeDb.onclick = async () => {
            const confirmed1 = confirm('WARNING: This will permanently delete all your tasks, meetings, and projects. This action cannot be undone. Are you sure?');
            if (confirmed1) {
                const confirmed2 = confirm('FINAL WARNING: Are you absolutely sure you want to initialize all data?');
                if (confirmed2) {
                    try {
                        await invoke('initialize_data');
                        alert('Data initialized successfully.');
                        // Refresh UI
                        location.reload(); 
                    } catch (err) {
                        console.error('Initialization error:', err);
                    }
                }
            }
        };
    }

    // Initialize external links
    document.querySelectorAll('.about-link').forEach(link => {
        link.onclick = async (e) => {
            e.preventDefault();
            const url = link.getAttribute('data-url') || link.getAttribute('href');
            if (!url || url === '#') return;
            
            try {
                // In Tauri v2 with shell plugin
                if (window.__TAURI__ && window.__TAURI__.shell) {
                    await window.__TAURI__.shell.open(url);
                } else {
                    window.open(url, '_blank');
                }
            } catch (err) {
                console.error('Failed to open link:', err);
                window.open(url, '_blank');
            }
        };
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

function setupModals() {
    const modalTask = document.getElementById('modal-task');
    const btnNewTask = document.getElementById('btn-new-task');
    const btnCloseTask = document.getElementById('btn-close-modal');
    const formTask = document.getElementById('form-task');
    const btnCancelTask = document.getElementById('btn-cancel-task');
    const btnCancelMeeting = document.getElementById('btn-cancel-meeting');

    const modalMeeting = document.getElementById('modal-meeting');
    const btnNewMeeting = document.getElementById('btn-new-meeting');
    const btnCloseMeeting = document.getElementById('btn-close-meeting');
    const formMeeting = document.getElementById('form-meeting');

    if (btnNewTask) {
        btnNewTask.addEventListener('click', () => { 
            console.log("Opening New Task Modal");
            // Reset for new task
            closeTask(); // Use existing reset logic
            modalTask.classList.remove('hidden'); 
            document.getElementById('task-title').focus(); 
        });
    }

    const closeTask = () => { 
        modalTask.classList.add('hidden'); 
        formTask.reset(); 
        document.getElementById('task-id').value = '';
        document.getElementById('task-tag-display').textContent = '';
        document.getElementById('task-tag-display').classList.add('hidden');
        document.getElementById('task-modal-title').textContent = 'Create New Task';
        modalTask.querySelector('button[type="submit"]').textContent = 'Create Task';
        
        const btnDelModal = document.getElementById('btn-delete-task-modal');
        if (btnDelModal) btnDelModal.classList.add('hidden');

        const statusGroup = document.getElementById('task-status-group');
        if (statusGroup) statusGroup.classList.add('hidden');
    };
    
    const btnDelModal = document.getElementById('btn-delete-task-modal');
    if (btnDelModal) {
        btnDelModal.onclick = () => {
            const taskId = Number(document.getElementById('task-id').value);
            if (taskId && confirm('Are you sure you want to delete this task?')) {
                deleteTask(taskId);
                closeTask();
            }
        };
    }
    if (btnCloseTask) btnCloseTask.addEventListener('click', closeTask);
    if (btnCancelTask) btnCancelTask.addEventListener('click', closeTask);

    const closeMeeting = () => { 
        modalMeeting.classList.add('hidden'); 
        formMeeting.reset();
    };
    if (btnCloseMeeting) btnCloseMeeting.addEventListener('click', closeMeeting);
    if (btnCancelMeeting) btnCancelMeeting.addEventListener('click', closeMeeting);

    if (formTask) {
        formTask.addEventListener('submit', async (e) => {
            e.preventDefault();
            const taskId = document.getElementById('task-id').value;
            const newTask = {
                id: taskId ? parseInt(taskId) : null,
                owner_id: 1, 
                title: document.getElementById('task-title').value,
                content: document.getElementById('task-content').value, 
                manager: document.getElementById('task-manager').value,
                start_date: document.getElementById('task-start').value, 
                due_date: document.getElementById('task-due').value,
                status: 'Note', 
                is_urgent: document.getElementById('task-urgent').checked,
                created_at: "", 
                review_comment: "", 
                task_tag: "",
                is_deleted: false
            };

            // Mandatory fields validation
            if (!newTask.title || !newTask.content || !newTask.manager || !newTask.start_date || !newTask.due_date) {
                alert("Please fill in all fields (Title, Content, Manager, Start Date, and Due Date).");
                return;
            }

            // Date validation
            if (newTask.due_date && newTask.start_date && newTask.due_date < newTask.start_date) {
                alert("Due date cannot be earlier than start date.");
                return;
            }

            try {
                if (taskId) {
                    // Update existing task
                    const existingTask = currentTasks.find(t => t.id === parseInt(taskId));
                    if (existingTask) {
                        newTask.status = existingTask.status;
                        newTask.is_deleted = existingTask.is_deleted;
                        newTask.review_comment = existingTask.review_comment;
                        newTask.task_tag = existingTask.task_tag;
                    }
                    await invoke('update_task', { task: newTask });
                } else {
                    // Add new task
                    await invoke('add_task', { task: newTask });
                }
                closeTask();
                currentView === 'nav-kanban' ? await refreshKanban() : await refreshStats();
            } catch (err) { console.error("Save Task Error:", err); }
        });
    }

    if (btnNewMeeting) {
        btnNewMeeting.addEventListener('click', () => {
            document.getElementById('meeting-id').value = '';
            formMeeting.reset();
            document.getElementById('meeting-modal-title').textContent = 'Create New Minutes';
            modalMeeting.classList.remove('hidden');
        });
    }

    // Already handled above

    if (formMeeting) {
        formMeeting.addEventListener('submit', async (e) => {
            e.preventDefault();
            const meetingData = {
                id: document.getElementById('meeting-id').value ? parseInt(document.getElementById('meeting-id').value) : null,
                owner_id: 1, title: document.getElementById('meeting-title').value,
                date: document.getElementById('meeting-date').value, location: document.getElementById('meeting-location').value,
                participants: document.getElementById('meeting-participants').value, decisions: "", action_items: "",
                memo: document.getElementById('meeting-memo').value, created_at: ""
            };
            try {
                await invoke('save_meeting', { meeting: meetingData });
                closeMeeting();
                await refreshMinutes();
            } catch (err) { console.error("Save Meeting Error:", err); }
        });
    }

    // Track mousedown to prevent closing on drags
    let modalClickStartedOnOverlay = false;
    window.addEventListener('mousedown', (e) => {
        modalClickStartedOnOverlay = (e.target === modalTask || e.target === modalMeeting || e.target === document.getElementById('modal-review'));
    });

    window.addEventListener('click', (e) => {
        if (!modalClickStartedOnOverlay) return; // Ignore if click started inside modal

        if (e.target === modalTask) closeTask();
        if (e.target === modalMeeting) closeMeeting();
        if (e.target === document.getElementById('modal-review')) {
            document.getElementById('modal-review').classList.add('hidden');
        }
    });

    const btnTrashBin = document.getElementById('btn-trash-bin');
    const btnBackKanban = document.getElementById('btn-back-kanban');

    if (btnTrashBin) {
        btnTrashBin.addEventListener('click', () => {
            loadView('nav-trash');
        });
    }

    if (btnBackKanban) {
        btnBackKanban.addEventListener('click', () => {
            loadView('nav-kanban');
        });
    }

    // Review Modal Setup
    const modalReview = document.getElementById('modal-review');
    const formReview = document.getElementById('form-review');
    const btnCancelReview = document.getElementById('btn-cancel-review');

    if (btnCancelReview) {
        btnCancelReview.addEventListener('click', () => {
            modalReview.classList.add('hidden');
            formReview.reset();
        });
    }

    if (formReview) {
        formReview.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = Number(document.getElementById('review-task-id').value);
            const name = document.getElementById('reviewer-name').value;
            const comment = document.getElementById('review-comment').value;
            
            const reviewText = `[Reviewer: ${name}] ${comment}`;
            
            try {
                const task = currentTasks.find(t => t.id === id);
                if (task) {
                    const updatedTask = { ...task, review_comment: reviewText };
                    await invoke('update_task', { task: updatedTask });
                    await invoke('delete_task', { taskId: id });
                    modalReview.classList.add('hidden');
                    formReview.reset();
                    await refreshKanban();
                }
            } catch (err) {
                console.error("Review Process Error:", err);
                alert("Failed to process review.");
            }
        });
    }
}

function openReviewModal(taskId) {
    document.getElementById('review-task-id').value = taskId;
    document.getElementById('modal-review').classList.remove('hidden');
    document.getElementById('reviewer-name').focus();
}

async function deleteTask(taskId) {
    try {
        await invoke('delete_task', { taskId });
        await refreshKanban();
        await refreshStats(); // Update count
    } catch (err) {
        console.error("Delete Error:", err);
        alert("Failed to delete task.");
    }
}

async function loadDeletedTasks() {
    const body = document.getElementById('trash-list-body');
    body.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';
    try {
        const deletedTasks = await invoke('get_deleted_tasks');
        body.innerHTML = '';
        if (deletedTasks.length === 0) {
            body.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 40px; color: var(--text-muted)">No deleted tasks found.</td></tr>';
            return;
        }
        deletedTasks.forEach(t => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="font-family: monospace; font-size: 12px; color: var(--accent-color)">${t.task_tag || '-'}</td>
                <td>${t.title}</td>
                <td><span class="status-badge">${t.status}</span></td>
                <td>${t.manager || '-'}</td>
                <td>${t.created_at.split('T')[0]}</td>
                <td>${t.review_comment || '-'}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-restore" data-id="${t.id}">🔄 Restore</button>
                        <button class="btn-hard-del" data-id="${t.id}">🔥 Permanent</button>
                    </div>
                </td>
            `;
            body.appendChild(row);
        });

        // Add listeners
        body.querySelectorAll('.btn-restore').forEach(btn => {
            btn.onclick = () => restoreTask(Number(btn.dataset.id));
        });
        body.querySelectorAll('.btn-hard-del').forEach(btn => {
            btn.onclick = () => {
                if (confirm('Permanently delete this task? This cannot be undone.')) {
                    hardDeleteTask(Number(btn.dataset.id));
                }
            };
        });
    } catch (err) {
        console.error("Load Deleted Tasks Error:", err);
        body.innerHTML = '<tr><td colspan="7" style="color:red">Failed to load data.</td></tr>';
    }
}

async function restoreTask(taskId) {
    try {
        await invoke('restore_task', { taskId });
        await loadDeletedTasks();
        await refreshStats();
    } catch (err) {
        console.error("Restore Error:", err);
        alert("Failed to restore task.");
    }
}

async function hardDeleteTask(taskId) {
    try {
        await invoke('hard_delete_task', { taskId });
        await loadDeletedTasks();
        await refreshStats();
    } catch (err) {
        console.error("Hard Delete Error:", err);
        alert("Failed to permanently delete task.");
    }
}

async function loadView(viewId) {
    console.log("Loading view:", viewId);
    
    // Update active nav and title manually for direct calls
    const titles = {
        'nav-dashboard': 'Dashboard',
        'nav-kanban': 'Task Manager',
        'nav-trash': 'Trash Bin',
        'nav-minutes': 'Meeting Minutes',
        'nav-pm': 'Project Master'
    };

    const pageTitle = document.getElementById('page-title');
    if (pageTitle && titles[viewId]) {
        pageTitle.textContent = titles[viewId];
    }

    // Update active sidebar item
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.classList.toggle('active', nav.id === viewId);
    });

    // Toggle view visibility
    const targetViewId = `view-${viewId.replace('nav-', '')}`;
    document.querySelectorAll('.view').forEach(v => {
        v.classList.toggle('hidden', v.id !== targetViewId);
    });

    if (viewId === 'nav-kanban') {
        await refreshKanban();
        initDragAndDrop();
    } else if (viewId === 'nav-trash') {
        await loadDeletedTasks();
    }
    else if (viewId === 'nav-minutes') await refreshMinutes();
    else if (viewId === 'nav-pm') await refreshProjects();
    else if (viewId === 'nav-dashboard') await refreshStats();
}

async function refreshStats() {
    console.log("Refreshing stats...");
    try {
        const t = await invoke('get_task_count');
        const m = await invoke('get_meeting_count');
        const p = await invoke('get_project_count');
        document.getElementById('stat-tasks').textContent = t;
        document.getElementById('stat-meetings').textContent = m;
        document.getElementById('stat-projects').textContent = p;
    } catch (err) { console.error("Refresh Stats Error:", err); }
}

async function refreshKanban() {
    try {
        currentTasks = await invoke('get_tasks');
        renderKanban();
    } catch (err) { console.error("Refresh Kanban Error:", err); }
}

async function loadDashboard() {
    await loadView('nav-dashboard');
}

function renderKanban() {
    const cols = document.querySelectorAll('.kanban-column');
    cols.forEach(c => { c.querySelector('.task-list').innerHTML = ''; c.querySelector('.count').textContent = '0'; });
    currentTasks.forEach(t => {
        let displayStatus = t.status;
        if (displayStatus === 'Review') displayStatus = 'Done'; // Map Review status to Done column
        
        const col = document.querySelector(`.kanban-column[data-status="${displayStatus}"]`);
        if (col) {
            col.querySelector('.task-list').appendChild(createTaskCard(t));
            const count = col.querySelector('.count');
            count.textContent = parseInt(count.textContent) + 1;
        }
    });
}

function createTaskCard(t) {
    const card = document.createElement('a');
    card.href = 'javascript:void(0)';
    card.className = `task-card ${t.is_urgent ? 'urgent' : ''}`;
    card.dataset.id = t.id;
    card.innerHTML = `
        <div class="task-title">${t.title}</div>
        <div class="task-desc">${t.content || ''}</div>
        <div class="task-meta">
            <div class="task-date"><span>📅</span> ${t.due_date || '-'}</div>
        </div>
        <div class="task-actions">
            ${(t.status === 'Done' || t.status === 'Review')
                ? `<button class="btn-task-review compact" data-id="${t.id}" title="Review & Archive">🔍</button>`
                : `<button class="btn-task-del compact" data-id="${t.id}" title="Delete">🗑️</button>`
            }
        </div>
    `;

    // Click on buttons shouldn't trigger card click
    card.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = Number(btn.dataset.id);
            if (btn.classList.contains('btn-task-del')) {
                if (confirm('Are you sure you want to delete this task?')) {
                    deleteTask(id);
                }
            } else if (btn.classList.contains('btn-task-review')) {
                openReviewModal(id);
            }
        });
    });
    
    card.addEventListener('click', (e) => {
        e.preventDefault();
        const taskId = t.id;
        document.getElementById('task-id').value = taskId;
        document.getElementById('task-title').value = t.title;
        document.getElementById('task-content').value = t.content || '';
        document.getElementById('task-manager').value = t.manager || '';
        document.getElementById('task-urgent').checked = t.is_urgent;
        document.getElementById('task-start').value = t.start_date || '';
        document.getElementById('task-due').value = t.due_date || '';
        
        // Show current status with color
        const statusGroup = document.getElementById('task-status-group');
        if (statusGroup) statusGroup.classList.remove('hidden');

        const statusInfo = document.getElementById('task-status-info');
        if (statusInfo) {
            let displayStatus = t.status;
            if (displayStatus === 'Review') displayStatus = 'Done';
            
            statusInfo.textContent = displayStatus;
            // Clear existing status classes
            statusInfo.classList.remove('status-note', 'status-todo', 'status-doing', 'status-done');
            // Add new status class
            const lowerStatus = displayStatus.toLowerCase().replace('-', '');
            statusInfo.classList.add(`status-${lowerStatus}`);
        }

        // Show task tag in badge
        const tagDisplay = document.getElementById('task-tag-display');
        if (tagDisplay) {
            tagDisplay.textContent = t.task_tag || '';
            if (t.task_tag) tagDisplay.classList.remove('hidden');
            else tagDisplay.classList.add('hidden');
        }
        
        document.getElementById('task-modal-title').textContent = 'Edit Task';
        document.querySelector('#modal-task button[type="submit"]').textContent = 'Update Task';
        
        const btnDelModal = document.getElementById('btn-delete-task-modal');
        if (btnDelModal) {
            btnDelModal.classList.remove('hidden');
            if (t.status === 'Done') {
                btnDelModal.textContent = 'Approve & Delete';
                btnDelModal.className = 'btn btn-success'; // Green style
                btnDelModal.onclick = () => {
                    openReviewModal(taskId);
                    closeTask();
                };
            } else {
                btnDelModal.textContent = 'Delete Task';
                btnDelModal.className = 'btn btn-danger-outline'; // Red style
                btnDelModal.onclick = () => {
                    if (confirm('Are you sure you want to delete this task?')) {
                        deleteTask(taskId);
                        closeTask();
                    }
                };
            }
        }
        
        const modalTask = document.getElementById('modal-task');
        modalTask.classList.remove('hidden');
    });
    
    return card;
}

async function refreshMinutes() {
    try {
        currentMeetings = await invoke('get_meetings');
        const list = document.getElementById('minutes-list');
        list.innerHTML = '';
        currentMeetings.forEach(m => {
            const card = document.createElement('div');
            card.className = 'meeting-card';
            card.innerHTML = `<div class="meeting-date-badge">${m.date || 'No Date'}</div><div class="meeting-title">${m.title}</div><div class="meeting-info"><span>📍 ${m.location || 'Remote'}</span><span>👥 ${m.participants || 'N/A'}</span></div>`;
            card.addEventListener('click', () => {
                document.getElementById('meeting-id').value = m.id;
                document.getElementById('meeting-title').value = m.title;
                document.getElementById('meeting-date').value = m.date;
                document.getElementById('meeting-location').value = m.location;
                document.getElementById('meeting-participants').value = m.participants;
                document.getElementById('meeting-memo').value = m.memo;
                document.getElementById('meeting-modal-title').textContent = 'Edit Minutes';
                document.getElementById('modal-meeting').classList.remove('hidden');
            });
            list.appendChild(card);
        });
    } catch (err) { console.error("Refresh Minutes Error:", err); }
}

async function refreshProjects() {
    try {
        currentProjects = await invoke('get_projects');
        const list = document.getElementById('project-list');
        list.innerHTML = '';
        currentProjects.forEach(p => {
            const item = document.createElement('div');
            item.className = 'project-item';
            item.innerHTML = `<h4>${p.name}</h4><div class="client">${p.client || 'Internal Project'}</div>`;
            item.addEventListener('click', () => loadProjectDetails(p, item));
            list.appendChild(item);
        });
    } catch (err) { console.error("Refresh Projects Error:", err); }
}

async function loadProjectDetails(project, element) {
    document.querySelectorAll('.project-item').forEach(i => i.classList.remove('active'));
    element.classList.add('active');

    const details = document.getElementById('pm-details');
    details.innerHTML = `
        <div class="detail-header">
            <h2>${project.name}</h2>
            <p>${project.description || 'No description available'}</p>
        </div>
        <div class="timeline" id="project-timeline">
            <p style="color: var(--text-secondary)">Loading timeline...</p>
        </div>
    `;

    try {
        const logs = await invoke('get_status_logs', { projectId: project.id });
        renderTimeline(logs);
    } catch (err) { console.error("Load Project Details Error:", err); }
}

function renderTimeline(logs) {
    const timeline = document.getElementById('project-timeline');
    if (logs.length === 0) {
        timeline.innerHTML = '<p style="color: var(--text-secondary)">No status logs found for this project.</p>';
        return;
    }
    timeline.innerHTML = '';
    logs.forEach(log => {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        item.innerHTML = `
            <div class="timeline-dot"></div>
            <div class="status-log-card">
                <div class="log-tag">${log.department}</div>
                <div class="log-meta">
                    <span>👤 ${log.manager || 'N/A'}</span>
                    <span>🕒 ${log.timestamp || 'N/A'}</span>
                </div>
                <div class="log-content">${log.text_content}</div>
            </div>
        `;
        timeline.appendChild(item);
    });
}

function initDragAndDrop() {
    const board = document.querySelector('.kanban-board');
    if (!board) return;

    let ghost = null;
    let originalCard = null;
    let startX, startY;
    let currentColumn = null;

    board.addEventListener('mousedown', (e) => {
        const card = e.target.closest('.task-card');
        if (!card) return;

        // Start dragging after a small threshold to allow normal clicks
        originalCard = card;
        startX = e.clientX;
        startY = e.clientY;

        // Calculate offset from mouse to card top-left
        const rect = originalCard.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;

        const onMouseMove = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;

            if (!ghost && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
                draggingTaskId = Number(originalCard.dataset.id);
                
                ghost = originalCard.cloneNode(true);
                ghost.classList.add('drag-ghost');
                ghost.style.width = rect.width + 'px';
                ghost.style.height = rect.height + 'px';
                ghost.style.margin = '0'; // Reset margin
                document.body.appendChild(ghost);
                
                originalCard.classList.add('dragging');
            }

            if (ghost) {
                // Use transform for hardware acceleration and smooth movement
                const x = moveEvent.clientX - offsetX;
                const y = moveEvent.clientY - offsetY;
                ghost.style.transform = `translate(${x}px, ${y}px) rotate(3deg)`;
                ghost.style.left = '0';
                ghost.style.top = '0';

                // Find column under mouse
                ghost.style.visibility = 'hidden'; // Use visibility instead of display for smoother detection
                const overElement = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
                ghost.style.visibility = 'visible';

                const col = overElement ? overElement.closest('.kanban-column') : null;
                
                document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drag-over'));
                if (col) {
                    col.classList.add('drag-over');
                    currentColumn = col;
                } else {
                    currentColumn = null;
                }
            }
        };

        const onKeyDown = (keyEvent) => {
            if (keyEvent.key === 'Escape') {
                cancelDrag();
            }
        };

        const cancelDrag = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('keydown', onKeyDown);

            if (ghost) {
                ghost.remove();
                ghost = null;
                originalCard.classList.remove('dragging');
            }
            document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drag-over'));
            draggingTaskId = null;
            currentColumn = null;
        };

        const onMouseUp = async () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);

            if (ghost) {
                ghost.remove();
                ghost = null;
                originalCard.classList.remove('dragging');

                if (currentColumn && draggingTaskId !== null) {
                    const status = currentColumn.dataset.status;
                    const id = draggingTaskId;
                    const taskIndex = currentTasks.findIndex(t => t.id === id);

                    if (taskIndex !== -1 && currentTasks[taskIndex].status !== status) {
                        const oldStatus = currentTasks[taskIndex].status;
                        currentTasks[taskIndex].status = status;
                        renderKanban();
                        try {
                            await invoke('update_task_status', { taskId: id, newStatus: status });
                        } catch (err) {
                            console.error("Drag Drop Error:", err);
                            currentTasks[taskIndex].status = oldStatus;
                            renderKanban();
                        }
                    }
                }
                document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drag-over'));
            }
            draggingTaskId = null;
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        window.addEventListener('keydown', onKeyDown);
    });
}
