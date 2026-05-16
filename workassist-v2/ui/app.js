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
let currentCalendarDate = new Date();

let currentUser = null;

async function askConfirm(message, title = "Confirm") {
    if (!window.__TAURI__ || !window.__TAURI__.dialog) {
        return confirm(message);
    }
    return await window.__TAURI__.dialog.ask(message, {
        title: title,
        kind: 'warning'
    });
}

const init = () => {
    console.log('WorkAssist UI Initialized');
    setupAuth();
    initFeatureToggles();
    
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
            
            if (item.id === 'nav-settings') {
                document.getElementById('modal-settings').classList.remove('hidden');
                return;
            }

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

    // Dashboard Card Navigation
    const cardTasks = document.getElementById('card-tasks');
    if (cardTasks) cardTasks.onclick = () => loadView('nav-kanban');
    const cardMeetings = document.getElementById('card-meetings');
    if (cardMeetings) cardMeetings.onclick = () => loadView('nav-minutes');
    const cardProjects = document.getElementById('card-projects');
    if (cardProjects) cardProjects.onclick = () => loadView('nav-pm');

    // Minutes Search logic
    const minutesSearch = document.getElementById('minutes-search');
    const minutesSearchType = document.getElementById('minutes-search-type');
    
    const handleMinutesSearch = () => {
        const query = (minutesSearch ? minutesSearch.value : '').toLowerCase();
        const type = minutesSearchType ? minutesSearchType.value : 'all';
        
        const filtered = currentMeetings.filter(m => {
            const title = (m.title || '').toLowerCase();
            const tag = (m.meeting_tag || '').toLowerCase();
            const content = ((m.memo || '') + (m.decisions || '') + (m.action_items || '') + (m.location || '')).toLowerCase();
            const participants = (m.participants || '').toLowerCase();
            
            if (type === 'title') return title.includes(query) || tag.includes(query);
            if (type === 'content') return content.includes(query);
            if (type === 'participants') return participants.includes(query);
            return title.includes(query) || tag.includes(query) || content.includes(query) || participants.includes(query);
        });
        renderMeetingsList(filtered);
    };

    if (minutesSearchType) minutesSearchType.addEventListener('change', handleMinutesSearch);
    
    // Kanban Search logic
    const kanbanSearch = document.getElementById('kanban-search');
    const kanbanSearchType = document.getElementById('kanban-search-type');
    
    if (kanbanSearch) kanbanSearch.addEventListener('input', () => renderKanban());
    if (kanbanSearchType) kanbanSearchType.addEventListener('change', () => renderKanban());
    
    // Minutes Trash Bin Navigation
    const btnMinutesTrash = document.getElementById('btn-minutes-trash');
    if (btnMinutesTrash) {
        btnMinutesTrash.onclick = () => {
            document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
            document.getElementById('view-minutes-trash').classList.remove('hidden');
            loadDeletedMeetings();
        };
    }

    const btnBackMinutes = document.getElementById('btn-back-minutes');
    if (btnBackMinutes) {
        btnBackMinutes.onclick = () => {
            document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
            document.getElementById('view-minutes').classList.remove('hidden');
        };
    }

    setupModals();
    setupSettings();
    setupKanbanTabs();
    initDragAndDrop();

    // Global escape key listener
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllModals();
        }
    });
};

async function initFeatureToggles() {
    try {
        const enabledFeatures = await invoke('plugin:engine|get_enabled_features');
        console.log("Enabled Features:", enabledFeatures);

        const featureMap = {
            'kanban': { nav: 'nav-kanban', stat: 'stat-tasks' },
            'minutes': { nav: 'nav-minutes', stat: 'stat-meetings' },
            'pm': { nav: 'nav-pm', stat: 'stat-projects' }
        };

        Object.keys(featureMap).forEach(feature => {
            if (!enabledFeatures.includes(feature)) {
                const config = featureMap[feature];
                // Hide nav item
                const navItem = document.getElementById(config.nav);
                if (navItem) navItem.style.display = 'none';
                
                // Hide dashboard stat card
                const statVal = document.getElementById(config.stat);
                if (statVal) {
                    const card = statVal.closest('.stat-card');
                    if (card) card.style.display = 'none';
                }
                
                console.log(`Feature [${feature}] disabled - UI updated.`);
            }
        });
    } catch (err) {
        console.error("Error toggling features:", err);
    }
}

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
                const user = await invoke('plugin:auth|login', { username, passwordHash: password });
                if (user) {
                    console.log("Login Success. User ID:", user.id);
                    currentUser = user;
                    viewLogin.style.opacity = '0';
                    setTimeout(() => {
                        viewLogin.classList.add('hidden');
                        appContainer.classList.remove('hidden');
                        
                        // Update sidebar user info
                        document.getElementById('sidebar-user-name').textContent = currentUser.username;
                        const avatar = document.querySelector('.sidebar-footer .avatar');
                        if (avatar) avatar.textContent = currentUser.username.substring(0, 2).toUpperCase();
                        
                        loadDashboard();
                        refreshStats();
                    }, 500);
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
            document.getElementById('change-pw-id').value = currentUser ? currentUser.username : '';
            document.getElementById('change-pw-old').value = '';
            document.getElementById('change-new-pw').value = '';
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
                const hint = await invoke('plugin:auth|get_password_hint', { username: id });
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
    const formSignup = document.getElementById('form-signup');
    if (formSignup) {
        formSignup.onsubmit = async (e) => {
            e.preventDefault();
            const id = document.getElementById('signup-id').value;
            const pw = document.getElementById('signup-pw').value;
            const hint = document.getElementById('signup-hint').value;
            console.log("Attempting signup for:", id);
            try {
                await invoke('plugin:auth|create_user', { username: id, passwordHash: pw, hint });
                alert('Account created successfully!');
                modalSignup.classList.add('hidden');
            } catch (err) { 
                console.error("Signup Error:", err);
                alert('Failed to create account: ' + err); 
            }
        };
    }

    // Change PW form
    const formChangePw = document.getElementById('form-change-pw');
    if (formChangePw) {
        formChangePw.onsubmit = async (e) => {
            e.preventDefault();
            const id = document.getElementById('change-pw-id').value;
            const oldPw = document.getElementById('change-pw-old').value;
            const newPw = document.getElementById('change-new-pw').value;
            const newHint = document.getElementById('change-pw-hint').value;
            try {
                const success = await invoke('plugin:auth|change_password', { 
                    username: id, 
                    oldHash: oldPw, 
                    newHash: newPw, 
                    newHint: newHint 
                });
                if (success) {
                    alert('Password updated!');
                    modalChangePw.classList.add('hidden');
                } else {
                    alert('Incorrect ID or current password.');
                }
            } catch (err) { 
                console.error("Change PW Error:", err);
                alert('Failed to update password: ' + err); 
            }
        };
    }

    // Logout
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.onclick = async () => {
            if (await askConfirm('Are you sure you want to logout?')) {
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

    const btnCloseSignup = document.getElementById('btn-close-signup');
    const btnCancelSignup = document.getElementById('btn-cancel-signup');
    if (btnCloseSignup) btnCloseSignup.onclick = () => modalSignup.classList.add('hidden');
    if (btnCancelSignup) btnCancelSignup.onclick = () => modalSignup.classList.add('hidden');

    const btnCloseHint = document.getElementById('btn-close-hint-modal');
    const btnCloseHintOk = document.getElementById('btn-close-hint-ok');
    if (btnCloseHint) btnCloseHint.onclick = () => modalHint.classList.add('hidden');
    if (btnCloseHintOk) btnCloseHintOk.onclick = () => modalHint.classList.add('hidden');

    const btnCancelChangePw = document.getElementById('btn-cancel-change-pw');
    if (btnCancelChangePw) btnCancelChangePw.onclick = () => modalChangePw.classList.add('hidden');

    const btnSync = document.getElementById('btn-sync');
    if (btnSync) {
        btnSync.onclick = async () => {
            console.log("Global Sync Triggered");
            const btnText = btnSync.textContent;
            btnSync.textContent = "Syncing...";
            btnSync.disabled = true;
            try {
                await refreshStats();
                await loadView(currentView);
                setTimeout(() => {
                    btnSync.textContent = "Synced!";
                    setTimeout(() => {
                        btnSync.textContent = btnText;
                        btnSync.disabled = false;
                    }, 1000);
                }, 500);
            } catch (err) {
                console.error("Sync Error:", err);
                btnSync.textContent = "Error";
                btnSync.disabled = false;
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

function closeTask() { 
    const modalTask = document.getElementById('modal-task');
    const formTask = document.getElementById('form-task');
    if (!modalTask || !formTask) return;

    modalTask.classList.add('hidden'); 
    formTask.reset(); 
    
    // Reset read-only state
    const inputs = formTask.querySelectorAll('input, textarea');
    inputs.forEach(input => input.disabled = false);
    
    const submitBtn = formTask.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.style.display = 'block';

    const cancelBtn = document.getElementById('btn-cancel-task');
    if (cancelBtn) cancelBtn.textContent = 'Cancel';

    document.getElementById('task-id').value = '';
    const tagDisplay = document.getElementById('task-tag-display');
    if (tagDisplay) {
        tagDisplay.textContent = '';
        tagDisplay.classList.add('hidden');
    }
    const modalTitle = document.getElementById('task-modal-title');
    if (modalTitle) modalTitle.textContent = 'Create New Task';
    
    const btnDelModal = document.getElementById('btn-delete-task-modal');
    if (btnDelModal) {
        btnDelModal.classList.add('hidden');
        btnDelModal.onclick = null;
    }

    const statusGroup = document.getElementById('task-status-group');
    if (statusGroup) statusGroup.classList.add('hidden');

    const reviewGroup = document.getElementById('task-review-group');
    if (reviewGroup) reviewGroup.classList.add('hidden');
}

function closeMeeting() { 
    const modalMeeting = document.getElementById('modal-meeting');
    const formMeeting = document.getElementById('form-meeting');
    if (!modalMeeting || !formMeeting) return;

    modalMeeting.classList.add('hidden'); 
    formMeeting.reset();
}

function closeReview() {
    const modalReview = document.getElementById('modal-review');
    const formReview = document.getElementById('form-review');
    if (modalReview) {
        modalReview.classList.add('hidden');
        if (formReview) formReview.reset();
    }
}

function closeProject() {
    const modalProject = document.getElementById('modal-project');
    const formProject = document.getElementById('form-project');
    if (modalProject) {
        modalProject.classList.add('hidden');
        if (formProject) formProject.reset();
    }
}

function closeAllModals() {
    closeTask();
    closeMeeting();
    closeReview();
    closeProject();
    
    // Hide other non-form or simple modals
    const others = ['modal-settings', 'modal-signup', 'modal-hint', 'modal-change-pw', 'modal-about', 'modal-privacy', 'modal-terms', 'modal-contact'];
    others.forEach(id => {
        const m = document.getElementById(id);
        if (m) {
            m.classList.add('hidden');
            const form = m.querySelector('form');
            if (form) form.reset();
        }
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

    console.log("Modal Elements Init Check:", { modalTask, btnNewTask, formTask });

    const modalMeeting = document.getElementById('modal-meeting');
    const btnNewMeeting = document.getElementById('btn-new-meeting');
    const btnCloseMeeting = document.getElementById('btn-close-meeting');
    const formMeeting = document.getElementById('form-meeting');

    const btnExportMd = document.getElementById('btn-export-md');
    if (btnExportMd) {
        btnExportMd.onclick = async () => {
            const meetingData = {
                id: null,
                owner_id: null,
                title: document.getElementById('meeting-title').value,
                date: document.getElementById('meeting-date').value + ' ' + document.getElementById('meeting-time').value,
                location: document.getElementById('meeting-location').value,
                participants: document.getElementById('meeting-participants').value,
                memo: document.getElementById('meeting-memo').value,
                decisions: document.getElementById('meeting-decisions').value,
                action_items: document.getElementById('meeting-actions').value,
                created_at: "",
                meeting_tag: document.getElementById('meeting-tag').value || ""
            };

            if (!meetingData.title) {
                alert("Please enter a meeting title before exporting.");
                return;
            }

            try {
                // 1. Generate MD content via backend
                const mdContent = await invoke('plugin:minutes|export_meeting_md', { meeting: meetingData });
                
                // 2. Open Save Dialog
                if (window.__TAURI__ && window.__TAURI__.dialog) {
                    const savePath = await window.__TAURI__.dialog.save({
                        filters: [{ name: 'Markdown', extensions: ['md'] }],
                        defaultPath: `Meeting_${meetingData.meeting_tag || 'Minutes'}.md`
                    });

                    if (savePath) {
                        // 3. Write file via backend
                        await invoke('plugin:minutes|save_text_file', { path: savePath, content: mdContent });
                        alert("Export Successful!\nSaved to: " + savePath);
                    }
                } else {
                    console.log("Mock Export (No Tauri):", mdContent);
                    alert("Export logic only works in the desktop app.");
                }
            } catch (err) {
                console.error("Export Error:", err);
                alert("Failed to export: " + err);
            }
        };
    }
    // Privacy Modal
    const modalPrivacy = document.getElementById('modal-privacy');
    const linkPrivacy = document.getElementById('link-privacy');
    const btnClosePrivacy = document.getElementById('btn-close-privacy');

    if (linkPrivacy && modalPrivacy) {
        linkPrivacy.onclick = (e) => {
            e.preventDefault();
            modalPrivacy.classList.remove('hidden');
        };
    }
    if (btnClosePrivacy && modalPrivacy) {
        btnClosePrivacy.onclick = () => {
            modalPrivacy.classList.add('hidden');
        };
    }

    // Terms Modal
    const modalTerms = document.getElementById('modal-terms');
    const linkTerms = document.getElementById('link-terms');
    const btnCloseTerms = document.getElementById('btn-close-terms');

    if (linkTerms && modalTerms) {
        linkTerms.onclick = (e) => {
            e.preventDefault();
            modalTerms.classList.remove('hidden');
        };
    }
    if (btnCloseTerms && modalTerms) {
        btnCloseTerms.onclick = () => {
            modalTerms.classList.add('hidden');
        };
    }

    // Contact Modal
    const modalContact = document.getElementById('modal-contact');
    const linkContact = document.getElementById('link-contact');
    const btnCloseContact = document.getElementById('btn-close-contact');

    if (linkContact && modalContact) {
        linkContact.onclick = (e) => {
            e.preventDefault();
            modalContact.classList.remove('hidden');
        };
    }
    if (btnCloseContact && modalContact) {
        btnCloseContact.onclick = () => {
            modalContact.classList.add('hidden');
        };
    }

    // About Modal
    const modalAbout = document.getElementById('modal-about');
    const btnTypingStatus = document.querySelector('.typing-status');
    const btnCloseAbout = document.getElementById('btn-close-about');

    if (btnTypingStatus && modalAbout) {
        btnTypingStatus.onclick = () => {
            modalAbout.classList.remove('hidden');
        };
    }

    if (btnCloseAbout && modalAbout) {
        btnCloseAbout.onclick = () => {
            modalAbout.classList.add('hidden');
        };
    }

    if (btnNewTask) {
        btnNewTask.onclick = () => { 
            console.log("Opening New Task Modal");
            // Reset for new task
            closeTask(); // Use existing reset logic
            modalTask.classList.remove('hidden'); 
            document.getElementById('task-title').focus(); 
        };
    }

    
    const btnDelModal = document.getElementById('btn-delete-task-modal');
    if (btnDelModal) {
        btnDelModal.onclick = async () => {
            const taskId = Number(document.getElementById('task-id').value);
            if (taskId && await askConfirm('Are you sure you want to delete this task?')) {
                deleteTask(taskId);
                closeTask();
            }
        };
    }
    if (btnCloseTask) btnCloseTask.onclick = closeTask;
    if (btnCancelTask) btnCancelTask.onclick = closeTask;

    if (btnCloseMeeting) btnCloseMeeting.onclick = closeMeeting;
    if (btnCancelMeeting) btnCancelMeeting.onclick = closeMeeting;

    if (formTask) {
        formTask.onsubmit = async (e) => {
            e.preventDefault();
            console.log("Task Form Submitted!");
            const taskId = document.getElementById('task-id').value;
            const newTask = {
                id: taskId ? parseInt(taskId) : null,
                owner_id: currentUser.id, 
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
                    await invoke('plugin:kanban|update_task', { task: newTask });
                } else {
                    // Add new task
                    await invoke('plugin:kanban|add_task', { task: newTask });
                }
                closeTask();
                
                // Always refresh stats for the dashboard numbers
                await refreshStats();
                
                // If we are on Kanban or Trash, refresh tasks
                if (currentView === 'nav-kanban' || currentView === 'nav-trash') {
                    await refreshKanban();
                }
            } catch (err) { 
                console.error("Save Task Error:", err); 
            }
        };
    }

    if (btnNewMeeting) {
        btnNewMeeting.onclick = () => {
            document.getElementById('meeting-id').value = '';
            document.getElementById('meeting-tag').value = '';
            document.getElementById('meeting-tag-display').textContent = '';
            document.getElementById('meeting-tag-display').classList.add('hidden');
            formMeeting.reset();
            document.getElementById('meeting-modal-title').textContent = 'Create New Minutes';
            modalMeeting.classList.remove('hidden');
        };
    }

    if (formMeeting) {
        formMeeting.onsubmit = async (e) => {
            e.preventDefault();
            const meetingData = {
                id: document.getElementById('meeting-id').value ? parseInt(document.getElementById('meeting-id').value) : null,
                owner_id: currentUser.id, title: document.getElementById('meeting-title').value,
                date: document.getElementById('meeting-date').value + ' ' + document.getElementById('meeting-time').value, 
                location: document.getElementById('meeting-location').value,
                participants: document.getElementById('meeting-participants').value, 
                decisions: document.getElementById('meeting-decisions').value, 
                action_items: document.getElementById('meeting-actions').value,
                memo: document.getElementById('meeting-memo').value, 
                meeting_tag: document.getElementById('meeting-tag').value || "",
                created_at: ""
            };
            try {
                await invoke('plugin:minutes|save_meeting', { meeting: meetingData });
                closeMeeting();
                await refreshMinutes();
            } catch (err) { console.error("Save Meeting Error:", err); }
        };
    }

    // Track mousedown to prevent closing on drags
    let modalClickStartedOnOverlay = false;
    const modalProject = document.getElementById('modal-project');
    window.addEventListener('mousedown', (e) => {
        modalClickStartedOnOverlay = (e.target === modalTask || e.target === modalMeeting || e.target === modalProject || e.target === document.getElementById('modal-review'));
    });

    window.addEventListener('click', (e) => {
        if (!modalClickStartedOnOverlay) return; // Ignore if click started inside modal

        if (e.target === modalTask) closeTask();
        if (e.target === modalMeeting) closeMeeting();
        if (e.target === modalProject) closeProject();
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
        btnCancelReview.addEventListener('click', closeReview);
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
                    await invoke('plugin:kanban|update_task', { task: updatedTask });
                    await invoke('plugin:kanban|delete_task', { taskId: id });
                    modalReview.classList.add('hidden');
                    formReview.reset();
                    await refreshKanban();
                }
            } catch (err) {
                console.error("Review Process Error:", err);
            }
        });
    }

    // Project Modal Setup
    const btnNewProject = document.getElementById('btn-new-project');
    const formProject = document.getElementById('form-project');
    const btnCloseProject = document.getElementById('btn-close-project');
    const btnCancelProject = document.getElementById('btn-cancel-project');

    if (btnNewProject) {
        btnNewProject.onclick = () => {
            document.getElementById('project-id').value = '';
            formProject.reset();
            document.getElementById('project-modal-title').textContent = 'Register New Project';
            modalProject.classList.remove('hidden');
        };
    }

    if (btnCloseProject) btnCloseProject.onclick = closeProject;
    if (btnCancelProject) btnCancelProject.onclick = closeProject;

    if (formProject) {
        formProject.onsubmit = async (e) => {
            e.preventDefault();
            const projectData = {
                id: null,
                owner_id: currentUser.id,
                name: document.getElementById('project-name').value,
                description: document.getElementById('project-desc').value,
                manager: document.getElementById('project-manager').value,
                client: document.getElementById('project-client').value,
                created_at: "",
                status: 'active',
                dept1_name: document.getElementById('project-dept1').value,
                dept2_name: document.getElementById('project-dept2').value,
                dept3_name: document.getElementById('project-dept3').value,
                dept4_name: document.getElementById('project-dept4').value
            };
            try {
                await invoke('plugin:pm|add_project', { project: projectData });
                closeProject();
                await refreshProjects();
            } catch (err) { console.error("Add Project Error:", err); }
        };
    }

    // Milestone Modal
    const formMilestone = document.getElementById('form-milestone');
    const btnCloseMs = document.getElementById('btn-close-ms-modal');
    const btnCancelMs = document.getElementById('btn-cancel-ms');
    if (btnCloseMs) btnCloseMs.onclick = () => document.getElementById('modal-milestone').classList.add('hidden');
    if (btnCancelMs) btnCancelMs.onclick = () => document.getElementById('modal-milestone').classList.add('hidden');

    if (formMilestone) {
        formMilestone.onsubmit = async (e) => {
            e.preventDefault();
            const milestone = {
                id: document.getElementById('ms-id').value ? parseInt(document.getElementById('ms-id').value) : null,
                project_id: parseInt(document.getElementById('ms-project-id').value),
                slot_number: parseInt(document.getElementById('ms-slot-number').value),
                name: document.getElementById('ms-name').value,
                deadline: document.getElementById('ms-deadline').value,
                content: document.getElementById('ms-content').value,
                is_saved: true,
                is_done: document.getElementById('ms-is-done').checked
            };
            try {
                await invoke('plugin:pm|save_milestone', { milestone });
                document.getElementById('modal-milestone').classList.add('hidden');
                loadProjectDetails(milestone.project_id); // Refresh
            } catch (err) { console.error("Save Milestone Error:", err); }
        };
    }

    // Status Log Modal
    const formLog = document.getElementById('form-log');
    const btnCloseLog = document.getElementById('btn-close-log-modal');
    const btnCancelLog = document.getElementById('btn-cancel-log');
    if (btnCloseLog) btnCloseLog.onclick = () => document.getElementById('modal-log').classList.add('hidden');
    if (btnCancelLog) btnCancelLog.onclick = () => document.getElementById('modal-log').classList.add('hidden');

    if (formLog) {
        formLog.onsubmit = async (e) => {
            e.preventDefault();
            const log = {
                id: null,
                project_id: parseInt(document.getElementById('log-project-id').value),
                owner_id: currentUser.id,
                department: document.getElementById('log-department').value,
                text_content: document.getElementById('log-content').value,
                image_path: "",
                timestamp: "",
                status: 'active',
                tag: "",
                title: document.getElementById('log-title').value,
                manager: document.getElementById('log-manager').value,
                start_date: "",
                due_date: ""
            };
            try {
                await invoke('plugin:pm|add_status_log', { log });
                document.getElementById('modal-log').classList.add('hidden');
                loadProjectDetails(log.project_id); // Refresh
            } catch (err) { console.error("Add Log Error:", err); }
        };
    }

    // PM Tabs
    const pmTabs = document.querySelectorAll('.pm-tab');
    pmTabs.forEach(tab => {
        tab.onclick = () => {
            pmTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const targetTab = tab.getAttribute('data-tab');
            document.querySelectorAll('.pm-tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`tab-${targetTab}`).classList.add('active');
        };
    });
}

function setupSettings() {
    const modalSettings = document.getElementById('modal-settings');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const btnCloseSettingsOk = document.getElementById('btn-close-settings-ok');

    const closeSettings = () => modalSettings.classList.add('hidden');

    if (btnCloseSettings) btnCloseSettings.onclick = closeSettings;
    if (btnCloseSettingsOk) btnCloseSettingsOk.onclick = closeSettings;

    // Database Actions
    const btnManualBackup = document.getElementById('btn-manual-backup');
    const btnImportDb = document.getElementById('btn-import-db');
    const btnOpenBackupDir = document.getElementById('btn-open-backup-dir');
    const btnInitializeDb = document.getElementById('btn-initialize-db');

    if (btnImportDb) {
        btnImportDb.onclick = async () => {
            try {
                const selected = await window.__TAURI__.dialog.open({
                    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
                    multiple: false,
                });
                if (selected) {
                    await invoke('plugin:engine|import_db', { path: selected, user: currentUser });
                    alert("Database imported successfully. The application will now reload to apply changes.");
                    window.location.reload();
                }
            } catch (err) { alert("Import Failed: " + err); }
        };
    }

    if (btnManualBackup) {
        btnManualBackup.onclick = async () => {
            try {
                const path = await window.__TAURI__.dialog.save({
                    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
                    defaultPath: 'sjworkassist_v2_manual_backup.db'
                });
                
                if (path) {
                    const msg = await invoke('plugin:engine|manual_backup', { path });
                    alert(msg);
                }
            } catch (err) { alert("Backup Failed: " + err); }
        };
    }

    if (btnOpenBackupDir) {
        btnOpenBackupDir.onclick = async () => {
            try {
                await invoke('plugin:engine|open_backup_folder');
            } catch (err) { console.error("Open Folder Error:", err); }
        };
    }

    if (btnInitializeDb) {
        btnInitializeDb.onclick = async () => {
            if (await askConfirm("Are you sure? All your data will be permanently deleted!")) {
                try {
                    await invoke('plugin:engine|initialize_data', { user: currentUser });
                    alert("Database Initialized.");
                    window.location.reload();
                } catch (err) { alert("Init Failed: " + err); }
            }
        };
    }

    // Demo Actions
    const btnSeedDemo = document.getElementById('btn-seed-demo');
    const btnClearDemo = document.getElementById('btn-clear-demo');

    if (btnSeedDemo) {
        btnSeedDemo.onclick = async () => {
            if (await askConfirm('Load rich demo data? This will add several tasks, projects, and meetings.')) {
                try {
                    await invoke('plugin:engine|seed_demo_data_cmd');
                    alert('Demo data loaded successfully!');
                    window.location.reload();
                } catch (err) { alert("Seed Failed: " + err); }
            }
        };
    }

    if (btnClearDemo) {
        btnClearDemo.onclick = async () => {
            if (await askConfirm('Clear all demo data? Only data marked as demo will be removed.')) {
                try {
                    await invoke('plugin:engine|clear_demo_data_cmd');
                    alert("Database cleared.");
                    window.location.reload();
                } catch (err) { alert("Clear Failed: " + err); }
            }
        };
    }
}

function setupKanbanTabs() {
    const tabs = document.querySelectorAll('#view-kanban .view-tab');
    tabs.forEach(tab => {
        tab.onclick = () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const target = tab.getAttribute('data-view');
            document.querySelectorAll('.kanban-tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`kanban-content-${target}`).classList.add('active');
            
            if (target === 'schedule') {
                renderSchedule();
            } else if (target === 'calendar') {
                renderCalendar();
            } else {
                renderKanban();
            }
        };
    });

    // Calendar Navigation
    const prevBtn = document.getElementById('calendar-prev');
    const nextBtn = document.getElementById('calendar-next');
    if (prevBtn) {
        prevBtn.onclick = () => {
            currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
            renderCalendar();
        };
    }
    if (nextBtn) {
        nextBtn.onclick = () => {
            currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
            renderCalendar();
        };
    }

    // Schedule Navigation
    const schedPrev = document.getElementById('schedule-prev');
    const schedNext = document.getElementById('schedule-next');
    if (schedPrev) {
        schedPrev.onclick = () => {
            currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
            renderSchedule();
        };
    }
    if (schedNext) {
        schedNext.onclick = () => {
            currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
            renderSchedule();
        };
    }
}

function openReviewModal(taskId) {
    document.getElementById('review-task-id').value = taskId;
    document.getElementById('modal-review').classList.remove('hidden');
    document.getElementById('reviewer-name').focus();
}

async function deleteTask(taskId) {
    try {
        await invoke('plugin:kanban|delete_task', { taskId });
        await refreshKanban();
        await refreshStats(); // Update count
    } catch (err) {
        console.error("Delete Error:", err);
    }
}

async function loadDeletedTasks() {
    const body = document.getElementById('trash-list-body');
    body.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';
    try {
        const deletedTasks = await invoke('plugin:kanban|get_deleted_tasks', { ownerId: currentUser.id });
        body.innerHTML = '';
        if (deletedTasks.length === 0) {
            body.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 40px; color: var(--text-muted)">No deleted tasks found.</td></tr>';
            return;
        }
        deletedTasks.forEach(t => {
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.onclick = () => openTaskModal(t, true);

            const statusClass = t.status.toLowerCase().replace('-', '');
            const isDone = t.status === 'Done' || t.status === 'Review';
            
            if (isDone) row.classList.add('completed-row');
            
            const statusIcon = isDone ? '✅' : '🗑️';
            const titleStyle = isDone ? 'font-weight: 700; color: #10b981;' : '';

            row.innerHTML = `
                <td style="font-family: monospace; font-size: 12px; color: var(--accent-color)">${t.task_tag || '-'}</td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span>${statusIcon}</span>
                        <span style="${titleStyle}">${t.title}</span>
                    </div>
                </td>
                <td><span class="status-badge ${statusClass}">${t.status}</span></td>
                <td>${t.manager || '-'}</td>
                <td>${t.created_at.split('T')[0]}</td>
                <td><div class="review-text-cell" title="${t.review_comment || ''}">${t.review_comment || '-'}</div></td>
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
            btn.onclick = (e) => {
                e.stopPropagation();
                restoreTask(Number(btn.dataset.id));
            };
        });
        body.querySelectorAll('.btn-hard-del').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                if (await askConfirm('Permanently delete this task? This cannot be undone.')) {
                    hardDeleteTask(Number(btn.dataset.id));
                }
            };
        });
    } catch (err) {
        console.error("Load Deleted Tasks Error:", err);
    }
}

async function restoreTask(taskId) {
    try {
        await invoke('plugin:kanban|restore_task', { taskId });
        await loadDeletedTasks();
        await refreshStats();
    } catch (err) {
        console.error("Restore Error:", err);
    }
}

async function hardDeleteTask(taskId) {
    try {
        await invoke('plugin:kanban|hard_delete_task_cmd', { taskId });
        await loadDeletedTasks();
        await refreshStats();
    } catch (err) {
        console.error("Hard Delete Error:", err);
    }
}

async function loadView(viewId) {
    
    // Update active nav and title manually for direct calls
    const titles = {
        'nav-dashboard': 'Dashboard',
        'nav-kanban': 'Task Manager',
        'nav-trash': 'Trash Bin',
        'nav-minutes': 'Minutes Manager',
        'nav-pm': 'Project Manager'
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
        const activeTab = document.querySelector('#view-kanban .view-tab.active');
        const activeView = activeTab ? activeTab.getAttribute('data-view') : 'board';
        
        await refreshKanban();
        if (activeView === 'schedule') renderSchedule();
        else renderKanban();
        
        initDragAndDrop();
    } else if (viewId === 'nav-trash') {
        await loadDeletedTasks();
    }
    else if (viewId === 'nav-minutes') await refreshMinutes();
    else if (viewId === 'nav-pm') await refreshProjects();
    else if (viewId === 'nav-dashboard') await refreshStats();
}

async function refreshStats() {
    try {
        // Fetch fresh tasks to ensure accuracy
        const tasks = await invoke('plugin:kanban|get_tasks', { ownerId: currentUser.id });
        currentTasks = tasks; // Sync global state

        const m = await invoke('plugin:minutes|get_meeting_count', { ownerId: currentUser.id });
        const p = await invoke('plugin:pm|get_project_count', { ownerId: currentUser.id });
        
        // Calculate pending tasks (Not Done and Not Review)
        const pendingTasks = tasks.filter(t => t.status !== 'Done' && t.status !== 'Review');
        const pendingCount = pendingTasks.length;

        // Update Dashboard
        const statTasks = document.getElementById('stat-tasks');
        if (statTasks) {
            statTasks.textContent = pendingCount;
            // Optionally update the label to be more clear
            const label = statTasks.previousElementSibling;
            if (label && label.classList.contains('stat-label')) {
                label.textContent = 'Pending Tasks';
            }
        }
        
        document.getElementById('stat-meetings').textContent = m;
        document.getElementById('stat-projects').textContent = p;

        updateSidebarStatus(tasks);
    } catch (err) { console.error("Refresh Stats Error:", err); }
}

function updateSidebarStatus(tasks) {
    const pendingTasks = tasks.filter(t => t.status !== 'Done' && t.status !== 'Review');
    const pendingCount = pendingTasks.length;
    const statusEl = document.getElementById('sidebar-status-info');
    if (statusEl) statusEl.textContent = `v2.1.0 | ${pendingCount} Pending`;
}

async function refreshKanban() {
    try {
        currentTasks = await invoke('plugin:kanban|get_tasks', { ownerId: currentUser.id });
        renderKanban();
        updateSidebarStatus(currentTasks);
    } catch (err) { 
        console.error("Refresh Kanban Error:", err); 
    }
}

function renderSchedule() {
    const timelineDays = document.getElementById('schedule-timeline-days');
    const scheduleBody = document.getElementById('schedule-body');
    const monthYear = document.getElementById('schedule-month-year');
    if (!timelineDays || !scheduleBody) return;

    // Use shared currentCalendarDate
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // Update Month/Year display
    if (monthYear) {
        monthYear.textContent = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(currentCalendarDate);
    }
    
    // Render header days
    timelineDays.innerHTML = '';
    for (let i = 1; i <= daysInMonth; i++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'day-cell';
        dayCell.textContent = i;
        timelineDays.appendChild(dayCell);
    }

    // Render task rows
    scheduleBody.innerHTML = '';
    if (currentTasks.length === 0) {
        scheduleBody.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary)">No tasks found for schedule.</div>';
        return;
    }

    currentTasks.forEach(t => {
        const row = document.createElement('div');
        row.className = 'schedule-row';
        
        const start = t.start_date ? new Date(t.start_date) : null;
        const due = t.due_date ? new Date(t.due_date) : null;
        
        row.innerHTML = `
            <div class="schedule-task-info">
                <div class="schedule-task-title">${t.title}</div>
                <div class="schedule-task-meta">${t.manager || '-'} | ${t.status}</div>
            </div>
            <div class="schedule-timeline-row">
                <div class="schedule-bar-container"></div>
            </div>
        `;

        const barContainer = row.querySelector('.schedule-bar-container');
        
        if (start && due) {
            // Check if task falls within current month
            if (start.getFullYear() === year && start.getMonth() === month) {
                const startDay = start.getDate();
                const dueDay = due.getDate();
                const duration = Math.max(1, dueDay - startDay + 1);
                
                const bar = document.createElement('div');
                const statusClass = t.status.toLowerCase().replace('-', '');
                bar.className = `schedule-bar ${statusClass}${t.is_urgent ? ' urgent' : ''}`;
                
                // Position based on day width (40px)
                bar.style.left = `${(startDay - 1) * 40}px`;
                bar.style.width = `${duration * 40 - 4}px`; // Small gap
                
                bar.innerHTML = `<span class="bar-label">${t.is_urgent ? '🚨 ' : ''}${t.title}</span>`;
                bar.onclick = () => openTaskModal(t, false);
                barContainer.appendChild(bar);
            }
        }
        
        scheduleBody.appendChild(row);
    });
}

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const monthYear = document.getElementById('calendar-month-year');
    if (!grid || !monthYear) return;

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    
    monthYear.textContent = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(currentCalendarDate);

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevDaysInMonth = new Date(year, month, 0).getDate();

    grid.innerHTML = '';

    // Previous month's days
    for (let i = firstDay - 1; i >= 0; i--) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day-cell other-month';
        cell.innerHTML = `<div class="day-number">${prevDaysInMonth - i}</div>`;
        grid.appendChild(cell);
    }

    // Current month's days
    const today = new Date();
    for (let i = 1; i <= daysInMonth; i++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day-cell';
        if (year === today.getFullYear() && month === today.getMonth() && i === today.getDate()) {
            cell.classList.add('today');
        }
        
        cell.innerHTML = `<div class="day-number">${i}</div>`;
        
        // Find tasks for this day (based on due_date)
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const tasksForDay = currentTasks.filter(t => t.due_date === dateStr);
        
        tasksForDay.forEach(t => {
            const taskEl = document.createElement('div');
            const statusClass = t.status.toLowerCase().replace('-', '');
            taskEl.className = `calendar-task-item ${statusClass}${t.is_urgent ? ' urgent' : ''}`;
            taskEl.textContent = (t.is_urgent ? '🚨 ' : '') + t.title;
            taskEl.title = `${t.title} (${t.status})`;
            taskEl.onclick = (e) => {
                e.stopPropagation();
                openTaskModal(t, false);
            };
            cell.appendChild(taskEl);
        });

        grid.appendChild(cell);
    }

    // Next month's days to fill the grid (total 42 cells for 6 weeks)
    const totalCells = 42;
    const remainingCells = totalCells - grid.children.length;
    for (let i = 1; i <= remainingCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day-cell other-month';
        cell.innerHTML = `<div class="day-number">${i}</div>`;
        grid.appendChild(cell);
    }
}

async function loadDashboard() {
    await loadView('nav-dashboard');
}

function openTaskModal(t, readOnly = false) {
    const taskId = t.id;
    document.getElementById('task-id').value = taskId || '';
    document.getElementById('task-title').value = t.title || '';
    document.getElementById('task-content').value = t.content || '';
    document.getElementById('task-manager').value = t.manager || '';
    document.getElementById('task-urgent').checked = t.is_urgent || false;
    document.getElementById('task-start').value = t.start_date || '';
    document.getElementById('task-due').value = t.due_date || '';
    
    // Show current status with color
    const statusGroup = document.getElementById('task-status-group');
    if (statusGroup) statusGroup.classList.remove('hidden');

    const statusInfo = document.getElementById('task-status-info');
    if (statusInfo) {
        let displayStatus = t.status || 'Note';
        // We show the actual status to match the list view exactly
        statusInfo.textContent = displayStatus;
        
        // Clear all possible status classes
        statusInfo.classList.remove('status-note', 'status-todo', 'status-doing', 'status-done', 'status-review');
        
        // Add new status class based on actual status
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

    // Show review comment if exists
    const reviewGroup = document.getElementById('task-review-group');
    const reviewDisplay = document.getElementById('task-review-display');
    if (reviewGroup && reviewDisplay) {
        if (t.review_comment) {
            reviewDisplay.textContent = t.review_comment;
            reviewGroup.classList.remove('hidden');
        } else {
            reviewGroup.classList.add('hidden');
        }
    }
    
    document.getElementById('task-modal-title').textContent = readOnly ? 'Task Details (Read Only)' : (taskId ? 'Edit Task' : 'Create New Task');
    
    const submitBtn = document.querySelector('#modal-task button[type="submit"]');
    if (submitBtn) {
        submitBtn.textContent = taskId ? 'Update Task' : 'Create Task';
        submitBtn.style.display = readOnly ? 'none' : 'block';
    }

    const cancelBtn = document.getElementById('btn-cancel-task');
    if (cancelBtn) {
        cancelBtn.textContent = readOnly ? 'Close' : 'Cancel';
    }
    
    const btnDelModal = document.getElementById('btn-delete-task-modal');
    if (btnDelModal) {
        if (readOnly) {
            btnDelModal.classList.add('hidden');
        } else if (taskId) {
            btnDelModal.classList.remove('hidden');
            if (t.status === 'Done') {
                btnDelModal.textContent = 'Approve & Delete';
                btnDelModal.className = 'btn btn-success'; // Green style
                btnDelModal.onclick = async () => {
                    openReviewModal(taskId);
                    closeTask();
                };
            } else {
                btnDelModal.textContent = 'Delete Task';
                btnDelModal.className = 'btn btn-danger-outline'; // Red style
                btnDelModal.onclick = async () => {
                    if (await askConfirm('Are you sure you want to delete this task?')) {
                        deleteTask(taskId);
                        closeTask();
                    }
                };
            }
        } else {
            btnDelModal.classList.add('hidden');
        }
    }

    // Handle read-only state for inputs
    const formTask = document.getElementById('form-task');
    const inputs = formTask.querySelectorAll('input, textarea');
    inputs.forEach(input => {
        input.disabled = readOnly;
    });
    
    const modalTask = document.getElementById('modal-task');
    modalTask.classList.remove('hidden');
}

function renderKanban() {
    const query = (document.getElementById('kanban-search')?.value || '').toLowerCase();
    const type = document.getElementById('kanban-search-type')?.value || 'all';

    const cols = document.querySelectorAll('.kanban-column');
    cols.forEach(c => { 
        const list = c.querySelector('.task-list');
        if (list) list.innerHTML = ''; 
        const count = c.querySelector('.count');
        if (count) count.textContent = '0'; 
    });

    const filteredTasks = currentTasks.filter(t => {
        if (!query) return true;
        const title = (t.title || '').toLowerCase();
        const content = (t.content || '').toLowerCase();
        const manager = (t.manager || '').toLowerCase();
        const tag = (t.task_tag || '').toLowerCase();

        if (type === 'title') return title.includes(query) || tag.includes(query);
        if (type === 'content') return content.includes(query);
        if (type === 'manager') return manager.includes(query);
        return title.includes(query) || tag.includes(query) || content.includes(query) || manager.includes(query);
    });

    filteredTasks.forEach(t => {
        let displayStatus = t.status;
        
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
    card.href = '#';
    card.onclick = (e) => e.preventDefault();
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
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = Number(btn.dataset.id);
            if (btn.classList.contains('btn-task-del')) {
                if (await askConfirm('Are you sure you want to delete this task?')) {
                    deleteTask(id);
                }
            } else if (btn.classList.contains('btn-task-review')) {
                openReviewModal(id);
            }
        });
    });
    
    card.addEventListener('click', (e) => {
        e.preventDefault();
        openTaskModal(t, false);
    });
    
    return card;
}

async function refreshMinutes() {
    try {
        currentMeetings = await invoke('plugin:minutes|get_meetings', { ownerId: currentUser.id });
        const searchInput = document.getElementById('minutes-search');
        const searchType = document.getElementById('minutes-search-type');
        const query = searchInput ? searchInput.value.toLowerCase() : '';
        const type = searchType ? searchType.value : 'all';
        
        if (query) {
            const filtered = currentMeetings.filter(m => {
                const title = (m.title || '').toLowerCase();
                const tag = (m.meeting_tag || '').toLowerCase();
                const content = ((m.memo || '') + (m.decisions || '') + (m.action_items || '') + (m.location || '')).toLowerCase();
                const participants = (m.participants || '').toLowerCase();
                
                if (type === 'title') return title.includes(query) || tag.includes(query);
                if (type === 'content') return content.includes(query);
                if (type === 'participants') return participants.includes(query);
                return title.includes(query) || tag.includes(query) || content.includes(query) || participants.includes(query);
            });
            renderMeetingsList(filtered);
        } else {
            renderMeetingsList(currentMeetings);
        }
    } catch (err) { console.error("Refresh Minutes Error:", err); }
}

function renderMeetingsList(meetings) {
    const list = document.getElementById('minutes-list');
    if (!list) return;
    list.innerHTML = '';
    
    meetings.forEach(m => {
        const card = document.createElement('div');
        card.className = 'meeting-card';
        card.dataset.id = m.id;
        const tagBadge = m.meeting_tag ? `<span class="tag-badge-mini">${m.meeting_tag}</span>` : '';
        card.innerHTML = `
            <div class="meeting-date-badge">${m.date || 'No Date'}</div> 
            ${tagBadge} 
            <div class="meeting-title">${m.title}</div>
            <div class="meeting-info">
                <span>📍 ${m.location || 'Remote'}</span>
                <span>👥 ${m.participants || 'N/A'}</span>
            </div>
            <div class="meeting-actions-mini">
                <button class="btn-icon delete-meeting-btn" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        
        card.addEventListener('click', () => {
            document.getElementById('meeting-id').value = m.id;
            document.getElementById('meeting-title').value = m.title;
            const [mDate, mTime] = (m.date || '').split(' ');
            document.getElementById('meeting-date').value = mDate || '';
            document.getElementById('meeting-time').value = mTime || '';
            document.getElementById('meeting-location').value = m.location;
            document.getElementById('meeting-participants').value = m.participants;
            document.getElementById('meeting-memo').value = m.memo;
            document.getElementById('meeting-decisions').value = m.decisions || '';
            document.getElementById('meeting-actions').value = m.action_items || '';
            
            // Handle tag display
            const tagEl = document.getElementById('meeting-tag-display');
            if (tagEl) {
                if (m.meeting_tag) {
                    tagEl.textContent = m.meeting_tag;
                    tagEl.classList.remove('hidden');
                } else {
                    tagEl.textContent = '';
                    tagEl.classList.add('hidden');
                }
            }

            document.getElementById('meeting-modal-title').textContent = 'Edit Minutes';
            document.getElementById('modal-meeting').classList.remove('hidden');
        });

        const delBtn = card.querySelector('.delete-meeting-btn');
        if (delBtn) {
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm('Move this meeting to Trash?')) {
                    deleteMeeting(m.id);
                }
            };
        }

        list.appendChild(card);
    });
}

async function deleteMeeting(meetingId) {
    try {
        await invoke('plugin:minutes|delete_meeting', { meetingId });
        await refreshMinutes();
    } catch (err) {
        console.error("Delete Meeting Error:", err);
    }
}

async function loadDeletedMeetings() {
    const body = document.getElementById('minutes-trash-list-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
    try {
        const deletedMeetings = await invoke('plugin:minutes|get_deleted_meetings', { ownerId: currentUser.id });
        body.innerHTML = '';
        if (deletedMeetings.length === 0) {
            body.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px; color: var(--text-muted)">No deleted meetings found.</td></tr>';
            return;
        }
        deletedMeetings.forEach(m => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="tag-badge-mini">${m.meeting_tag || '-'}</span></td>
                <td>${m.title}</td>
                <td>${m.date || '-'}</td>
                <td>
                    <button class="btn-icon restore-btn" title="Restore">
                        <i class="fas fa-undo"></i>
                    </button>
                    <button class="btn-icon hard-delete-btn" title="Delete Permanently">
                        <i class="fas fa-times"></i>
                    </button>
                </td>
            `;
            tr.querySelector('.restore-btn').onclick = () => restoreMeeting(m.id);
            tr.querySelector('.hard-delete-btn').onclick = () => hardDeleteMeeting(m.id);
            body.appendChild(tr);
        });
    } catch (err) {
        console.error("Load Deleted Meetings Error:", err);
    }
}

async function restoreMeeting(meetingId) {
    try {
        await invoke('plugin:minutes|restore_meeting', { meetingId });
        await loadDeletedMeetings();
        await refreshMinutes();
    } catch (err) {
        console.error("Restore Meeting Error:", err);
    }
}

async function hardDeleteMeeting(meetingId) {
    if (confirm('Permanently delete this meeting? This action cannot be undone.')) {
        try {
            await invoke('plugin:minutes|hard_delete_meeting_cmd', { meetingId });
            await loadDeletedMeetings();
        } catch (err) {
            console.error("Hard Delete Meeting Error:", err);
        }
    }
}

async function refreshProjects() {
    try {
        currentProjects = await invoke('plugin:pm|get_projects', { ownerId: currentUser.id });
        const list = document.getElementById('project-list');
        list.innerHTML = '';
        currentProjects.forEach(p => {
            const item = document.createElement('div');
            item.className = 'project-item';
            item.innerHTML = `<h4>${p.name}</h4><div class="client">${p.client || 'Internal Project'}</div>`;
            item.addEventListener('click', () => loadProjectDetails(p.id));
            list.appendChild(item);
        });
        
        // Auto-select first project if available
        if (currentProjects.length > 0 && !document.querySelector('.project-item.active')) {
            loadProjectDetails(currentProjects[0].id);
        }
    } catch (err) { console.error("Refresh Projects Error:", err); }
}

async function loadProjectDetails(projectId) {
    const project = currentProjects.find(p => p.id === projectId);
    if (!project) return;

    // Highlight active item
    document.querySelectorAll('.project-item').forEach(item => {
        const title = item.querySelector('h4').textContent;
        if (title === project.name) item.classList.add('active');
        else item.classList.remove('active');
    });

    // Update Header Info
    document.getElementById('detail-project-name').textContent = project.name;
    document.getElementById('detail-project-meta').textContent = `Client: ${project.client || '-'} | Manager: ${project.manager || '-'}`;

    // Update Status Tab
    document.getElementById('detail-project-desc').textContent = project.description || 'No description available.';
    document.getElementById('detail-dept1').textContent = `Slot 1: ${project.dept1_name || 'N/A'}`;
    document.getElementById('detail-dept2').textContent = `Slot 2: ${project.dept2_name || 'N/A'}`;
    document.getElementById('detail-dept3').textContent = `Slot 3: ${project.dept3_name || 'N/A'}`;
    document.getElementById('detail-dept4').textContent = `Slot 4: ${project.dept4_name || 'N/A'}`;

    // Update Log Modal Department Select
    const logDeptSelect = document.getElementById('log-department');
    if (logDeptSelect) {
        logDeptSelect.innerHTML = '';
        [project.dept1_name, project.dept2_name, project.dept3_name, project.dept4_name].forEach(name => {
            if (name) {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                logDeptSelect.appendChild(opt);
            }
        });
    }

    try {
        // Load Milestones
        const milestones = await invoke('plugin:pm|get_milestones', { projectId: project.id });
        renderMilestones(project.id, milestones);

        // Load Status Logs
        const logs = await invoke('plugin:pm|get_status_logs', { projectId: project.id });
        renderStatusLogs(logs);

        // Update Log Form Hidden Field
        document.getElementById('log-project-id').value = project.id;
        
        // Add Log Button Listener (Reset and Open)
        const btnAddLog = document.getElementById('btn-add-log');
        if (btnAddLog) {
            btnAddLog.onclick = () => {
                document.getElementById('form-log').reset();
                document.getElementById('log-project-id').value = project.id;
                document.getElementById('modal-log').classList.remove('hidden');
            };
        }

    } catch (err) { console.error("Load Project Details Error:", err); }
}

function renderMilestones(projectId, milestones) {
    const slots = document.querySelectorAll('.milestone-slot');
    slots.forEach(slot => {
        const slotNum = parseInt(slot.getAttribute('data-slot'));
        const ms = milestones.find(m => m.slot_number === slotNum);
        
        const nameEl = slot.querySelector('.slot-name');
        const dateEl = slot.querySelector('.slot-date');
        const statusEl = slot.querySelector('.slot-status');
        
        if (ms) {
            nameEl.textContent = ms.name || '---';
            dateEl.textContent = ms.deadline || 'YYYY-MM-DD';
            statusEl.textContent = ms.is_done ? 'Done' : 'Pending';
            if (ms.is_done) slot.classList.add('done');
            else slot.classList.remove('done');
        } else {
            nameEl.textContent = '---';
            dateEl.textContent = 'YYYY-MM-DD';
            statusEl.textContent = 'Pending';
            slot.classList.remove('done');
        }

        // Click to edit
        slot.onclick = () => {
            document.getElementById('form-milestone').reset();
            document.getElementById('ms-slot-num').textContent = `#0${slotNum}`;
            document.getElementById('ms-project-id').value = projectId;
            document.getElementById('ms-slot-number').value = slotNum;
            
            if (ms) {
                document.getElementById('ms-id').value = ms.id || '';
                document.getElementById('ms-name').value = ms.name || '';
                document.getElementById('ms-deadline').value = ms.deadline || '';
                document.getElementById('ms-content').value = ms.content || '';
                document.getElementById('ms-is-done').checked = ms.is_done || false;
            } else {
                document.getElementById('ms-id').value = '';
            }
            
            document.getElementById('modal-milestone').classList.remove('hidden');
        };
    });
}

function renderStatusLogs(logs) {
    const timeline = document.getElementById('log-timeline');
    timeline.innerHTML = '';
    
    if (logs.length === 0) {
        timeline.innerHTML = '<p style="text-align: center; padding: 20px; color: var(--text-secondary);">No status logs yet.</p>';
        return;
    }

    // Sort logs by timestamp descending (newest first)
    const sortedLogs = [...logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    sortedLogs.forEach(log => {
        const item = document.createElement('div');
        item.className = 'log-item';
        item.innerHTML = `
            <div class="log-header">
                <span class="log-dept">${log.department}</span>
                <span class="log-time">${new Date(log.timestamp).toLocaleString()}</span>
            </div>
            <div class="log-title">${log.title}</div>
            <div class="log-content">${log.text_content || ''}</div>
            ${log.manager ? `<div class="log-manager">PIC: ${log.manager}</div>` : ''}
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
                            await invoke('plugin:kanban|update_task_status', { taskId: id, newStatus: status });
                            updateSidebarStatus(currentTasks);
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
