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
let currentMinutesCalendarDate = new Date();

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
            loadView('nav-minutes-trash');
        };
    }

    // Minutes Export/Import MD
    const btnExportMinutesMd = document.getElementById('btn-export-minutes-md');
    if (btnExportMinutesMd) {
        btnExportMinutesMd.onclick = async () => {
            try {
                const dir = await window.__TAURI__.dialog.open({
                    directory: true,
                    multiple: false,
                    title: "Select Directory to Export MD files"
                });
                
                if (dir) {
                    const result = await invoke('plugin:minutes|export_minutes_md_bulk', { dirPath: dir, ownerId: currentUser.id });
                    alert(result);
                }
            } catch (err) {
                console.error("Export MD Error:", err);
                alert("Failed to export MD files: " + err);
            }
        };
    }

    const btnImportMinutesSingleMd = document.getElementById('btn-import-minutes-single-md');
    if (btnImportMinutesSingleMd) {
        btnImportMinutesSingleMd.onclick = async () => {
            try {
                const file = await window.__TAURI__.dialog.open({
                    directory: false,
                    multiple: false,
                    title: "Select Markdown File to Import",
                    filters: [{ name: 'Markdown', extensions: ['md'] }]
                });
                
                if (file) {
                    await invoke('plugin:minutes|import_minutes_md_single', { filePath: file, ownerId: currentUser.id });
                    alert("Successfully imported the meeting minutes.");
                    refreshMinutes(); // refresh the list
                }
            } catch (err) {
                console.error("Import MD File Error:", err);
                alert(err);
                if (typeof refreshMinutes === 'function') refreshMinutes();
            }
        };
    }

    const btnImportMinutesMd = document.getElementById('btn-import-minutes-md');
    if (btnImportMinutesMd) {
        btnImportMinutesMd.onclick = async () => {
            try {
                const dir = await window.__TAURI__.dialog.open({
                    directory: true,
                    multiple: false,
                    title: "Select Directory to Import MD files"
                });
                
                if (dir) {
                    const count = await invoke('plugin:minutes|import_minutes_md_bulk', { dirPath: dir, ownerId: currentUser.id });
                    alert(`Successfully imported ${count} minutes.`);
                    refreshMinutes(); // refresh the list
                }
            } catch (err) {
                console.error("Import MD Error:", err);
                alert(err);
                if (typeof refreshMinutes === 'function') refreshMinutes();
            }
        };
    }

    const btnBackMinutes = document.getElementById('btn-back-minutes');
    if (btnBackMinutes) {
        btnBackMinutes.onclick = () => {
            loadView('nav-minutes');
        };
    }

    // Project Trash Bin Navigation
    const btnProjectTrash = document.getElementById('btn-project-trash');
    if (btnProjectTrash) {
        btnProjectTrash.onclick = () => {
            loadView('nav-pm-trash');
        };
    }

    const btnBackProject = document.getElementById('btn-back-project');
    if (btnBackProject) {
        btnBackProject.onclick = () => {
            loadView('nav-pm');
        };
    }

    // Project Completed Navigation
    const btnProjectCompleted = document.getElementById('btn-project-completed');
    if (btnProjectCompleted) {
        btnProjectCompleted.onclick = () => {
            loadView('nav-pm-completed');
        };
    }

    const btnProjectImport = document.getElementById('btn-project-import');
    if (btnProjectImport) {
        btnProjectImport.onclick = async () => {
            try {
                const file = await window.__TAURI__.dialog.open({
                    directory: false,
                    multiple: false,
                    title: "Select Project DB File to Import",
                    filters: [{ name: 'Project DB', extensions: ['json'] }]
                });
                
                if (file) {
                    await invoke('plugin:pm|import_project_db', { ownerId: currentUser.id, filePath: file });
                    alert("Project DB imported successfully!");
                    refreshProjects();
                }
            } catch (err) {
                console.error("Import Project DB Error:", err);
                alert("Failed to import Project DB: " + err);
            }
        };
    }

    const btnBackProjectCompleted = document.getElementById('btn-back-project-completed');
    if (btnBackProjectCompleted) {
        btnBackProjectCompleted.onclick = () => {
            loadView('nav-pm');
        };
    }

    setupModals();
    setupSettings();
    setupKanbanTabs();
    setupMinutesTabs();
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

    // Reset read-only state
    const inputs = formMeeting.querySelectorAll('input, textarea');
    inputs.forEach(input => input.disabled = false);

    const submitBtn = formMeeting.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.style.display = 'block';

    const cancelBtn = document.getElementById('btn-cancel-meeting');
    if (cancelBtn) cancelBtn.textContent = 'Cancel';

    document.getElementById('meeting-id').value = '';
    document.getElementById('meeting-tag').value = '';
    const tagDisplay = document.getElementById('meeting-tag-display');
    if (tagDisplay) {
        tagDisplay.textContent = '';
        tagDisplay.classList.add('hidden');
    }
    const modalTitle = document.getElementById('meeting-modal-title');
    if (modalTitle) modalTitle.textContent = 'Create New Minutes';

    const btnDelMeetingModal = document.getElementById('btn-delete-meeting-modal');
    if (btnDelMeetingModal) {
        btnDelMeetingModal.classList.add('hidden');
        btnDelMeetingModal.onclick = null;
    }
}

function openMeetingModal(m, readOnly = false) {
    document.getElementById('meeting-id').value = m.id || '';
    document.getElementById('meeting-tag').value = m.meeting_tag || '';
    document.getElementById('meeting-title').value = m.title || '';
    const [mDate, mTime] = (m.date || '').split(' ');
    document.getElementById('meeting-date').value = mDate || '';
    document.getElementById('meeting-time').value = mTime || '';
    document.getElementById('meeting-location').value = m.location || '';
    document.getElementById('meeting-participants').value = m.participants || '';
    document.getElementById('meeting-memo').value = m.memo || '';
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

    document.getElementById('meeting-modal-title').textContent = readOnly ? 'Minutes Details (Read Only)' : 'Edit Minutes';
    
    const submitBtn = document.querySelector('#modal-meeting button[type="submit"]');
    if (submitBtn) {
        submitBtn.style.display = readOnly ? 'none' : 'block';
    }

    const cancelBtn = document.getElementById('btn-cancel-meeting');
    if (cancelBtn) {
        cancelBtn.textContent = readOnly ? 'Close' : 'Cancel';
    }

    // Handle read-only state for inputs
    const formMeeting = document.getElementById('form-meeting');
    const inputs = formMeeting.querySelectorAll('input, textarea');
    inputs.forEach(input => {
        input.disabled = readOnly;
    });

    const btnDelMeetingModal = document.getElementById('btn-delete-meeting-modal');
    if (btnDelMeetingModal) {
        if (readOnly) {
            btnDelMeetingModal.classList.add('hidden');
        } else if (m.id) {
            btnDelMeetingModal.classList.remove('hidden');
            btnDelMeetingModal.onclick = async () => {
                if (await askConfirm('Move these minutes to Trash?')) {
                    await deleteMeeting(m.id);
                    closeMeeting();
                }
            };
        } else {
            btnDelMeetingModal.classList.add('hidden');
        }
    }

    const modalMeeting = document.getElementById('modal-meeting');
    if (modalMeeting) modalMeeting.classList.remove('hidden');
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
        if (formProject) {
            formProject.reset();
            const inputs = formProject.querySelectorAll('input, textarea');
            inputs.forEach(input => {
                input.disabled = false;
            });
        }
    }
    const btnDelProjectModal = document.getElementById('btn-delete-project-modal');
    if (btnDelProjectModal) {
        btnDelProjectModal.classList.add('hidden');
        btnDelProjectModal.onclick = null;
    }
    const titleEl = document.getElementById('project-modal-title');
    if (titleEl) titleEl.textContent = 'Register New Project';

    const submitBtn = document.querySelector('#modal-project button[type="submit"]');
    if (submitBtn) {
        submitBtn.style.display = 'block';
    }

    const cancelBtn = document.getElementById('btn-cancel-project');
    if (cancelBtn) {
        cancelBtn.textContent = 'Cancel';
    }
}

function closeAllModals() {
    closeTask();
    closeMeeting();
    closeReview();
    closeProject();
    
    // Hide other non-form or simple modals
    const others = ['modal-settings', 'modal-signup', 'modal-hint', 'modal-change-pw', 'modal-about', 'modal-privacy', 'modal-terms', 'modal-contact', 'modal-done-log-detail', 'modal-complete-project'];
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

    // Project Completion Modal
    const modalCompleteProject = document.getElementById('modal-complete-project');
    const btnCloseCompleteProject = document.getElementById('btn-close-complete-project');
    const btnCancelCompleteProject = document.getElementById('btn-cancel-complete-project');
    const formCompleteProject = document.getElementById('form-complete-project');

    if (btnCloseCompleteProject) {
        btnCloseCompleteProject.onclick = () => {
            modalCompleteProject.classList.add('hidden');
        };
    }
    if (btnCancelCompleteProject) {
        btnCancelCompleteProject.onclick = () => {
            modalCompleteProject.classList.add('hidden');
        };
    }
    if (formCompleteProject) {
        formCompleteProject.onsubmit = async (e) => {
            e.preventDefault();
            const projectId = Number(document.getElementById('complete-project-id').value);
            const completionDate = document.getElementById('complete-project-date').value;
            const completionMemo = document.getElementById('complete-project-memo').value;

            try {
                await invoke('plugin:pm|complete_project', {
                    projectId,
                    completionDate,
                    completionMemo
                });
                modalCompleteProject.classList.add('hidden');
                await refreshProjects();
                
                // Clear the project details view since it is no longer active
                document.getElementById('detail-project-name').textContent = 'Select a Project';
                document.getElementById('detail-project-meta').textContent = 'Client: - | Manager: - | Start Date: -';
                document.getElementById('detail-project-desc').textContent = 'No description available.';
                document.getElementById('detail-project-tag').classList.add('hidden');
                const btnEditProject = document.getElementById('btn-edit-project');
                if (btnEditProject) btnEditProject.classList.add('hidden');
                const btnExportHtml = document.getElementById('pm-timetable-export-html');
                if (btnExportHtml) btnExportHtml.classList.add('hidden');
                
                currentProjectId = null;
                const milestonesGrid = document.getElementById('milestones-grid');
                if (milestonesGrid) milestonesGrid.innerHTML = '';
                const pmTimetableContainer = document.getElementById('pm-timetable-container');
                if (pmTimetableContainer) pmTimetableContainer.innerHTML = '';
            } catch (err) {
                console.error("Complete Project Submit Error:", err);
                alert(err);
            }
        };
    }

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

    const taskStart = document.getElementById('task-start');
    const taskDue = document.getElementById('task-due');
    if (taskStart && taskDue) {
        const validateTaskDates = () => {
            const startVal = taskStart.value;
            const dueVal = taskDue.value;
            if (startVal && dueVal && dueVal < startVal) {
                alert("Due date must be set after start date.");
                taskDue.value = startVal;
            }
        };
        taskDue.onchange = validateTaskDates;
        taskStart.onchange = validateTaskDates;
    }

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

            // Character length validation
            if (newTask.title.length > 40) {
                alert("Task title cannot exceed 40 characters.");
                return;
            }
            if (newTask.content.length > 500) {
                alert("Task content cannot exceed 500 characters.");
                return;
            }
            if (newTask.manager.length > 15) {
                alert("Task manager cannot exceed 15 characters.");
                return;
            }

            try {
                if (taskId) {
                    // Update existing task
                    const existingTask = currentTasks.find(t => t.id === parseInt(taskId));
                    if (existingTask) {
                        newTask.status = existingTask.status;
                        if (newTask.status === 'Todo') newTask.status = 'To-do';
                        newTask.is_deleted = existingTask.is_deleted;
                        newTask.review_comment = existingTask.review_comment;
                        newTask.task_tag = existingTask.task_tag;
                    }
                }

                // Enforce task limits
                if (!checkTaskLimits(newTask, !taskId)) {
                    return;
                }

                if (taskId) {
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
                created_at: "",
                is_deleted: false
            };

            // Character length validation
            if (meetingData.title && meetingData.title.length > 40) {
                alert("Meeting title cannot exceed 40 characters.");
                return;
            }
            if (meetingData.location && meetingData.location.length > 30) {
                alert("Meeting location cannot exceed 30 characters.");
                return;
            }
            if (meetingData.participants && meetingData.participants.length > 50) {
                alert("Meeting participants cannot exceed 50 characters.");
                return;
            }
            if (meetingData.memo && meetingData.memo.length > 3000) {
                alert("Meeting agenda cannot exceed 3000 characters.");
                return;
            }
            if (meetingData.decisions && meetingData.decisions.length > 3000) {
                alert("Meeting decisions cannot exceed 3000 characters.");
                return;
            }
            if (meetingData.action_items && meetingData.action_items.length > 3000) {
                alert("Meeting action items cannot exceed 3000 characters.");
                return;
            }

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
    const modalDoneLogDetail = document.getElementById('modal-done-log-detail');
    window.addEventListener('mousedown', (e) => {
        modalClickStartedOnOverlay = (e.target === modalTask || e.target === modalMeeting || e.target === modalProject || e.target === document.getElementById('modal-review') || e.target === modalDoneLogDetail);
    });

    window.addEventListener('click', (e) => {
        if (!modalClickStartedOnOverlay) return; // Ignore if click started inside modal

        if (e.target === modalTask) closeTask();
        if (e.target === modalMeeting) closeMeeting();
        if (e.target === modalProject) closeProject();
        if (e.target === document.getElementById('modal-review')) {
            document.getElementById('modal-review').classList.add('hidden');
        }
        if (e.target === modalDoneLogDetail) {
            modalDoneLogDetail.classList.add('hidden');
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

    window.openProjectModal = function(p, readOnly = false) {
        const modalProject = document.getElementById('modal-project');
        const formProject = document.getElementById('form-project');
        if (!modalProject) return;

        document.getElementById('project-id').value = p.id || '';
        document.getElementById('project-name').value = p.name || '';
        document.getElementById('project-desc').value = p.description || '';
        document.getElementById('project-manager').value = p.manager || '';
        document.getElementById('project-client').value = p.client || '';
        document.getElementById('project-start-date').value = p.start_date || '';
        document.getElementById('project-dept1').value = p.dept1_name || 'SALES';
        document.getElementById('project-dept2').value = p.dept2_name || 'DESIGN';
        document.getElementById('project-dept3').value = p.dept3_name || 'PROCUREMENT';
        document.getElementById('project-dept4').value = p.dept4_name || 'ASSEMBLY';

        const titleEl = document.getElementById('project-modal-title');
        if (titleEl) {
            titleEl.textContent = readOnly ? 'Project Details (Read Only)' : (p.id ? 'Edit Project' : 'Register New Project');
        }

        const submitBtn = formProject.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.style.display = readOnly ? 'none' : 'block';
            submitBtn.textContent = p.id ? 'Save Project' : 'Create Project';
        }

        const cancelBtn = document.getElementById('btn-cancel-project');
        if (cancelBtn) {
            cancelBtn.textContent = readOnly ? 'Close' : 'Cancel';
        }

        const inputs = formProject.querySelectorAll('input, textarea');
        inputs.forEach(input => {
            input.disabled = readOnly;
        });

        const btnDelProjectModal = document.getElementById('btn-delete-project-modal');
        if (btnDelProjectModal) {
            if (p.id && !readOnly) {
                btnDelProjectModal.classList.remove('hidden');
                btnDelProjectModal.onclick = async () => {
                    if (await askConfirm('Move this project and all its milestones/logs to Trash?')) {
                        try {
                            await invoke('plugin:pm|delete_project', { projectId: p.id });
                            closeProject();
                            
                            // Clear current selected project display
                            document.getElementById('detail-project-name').textContent = 'Select a Project';
                            document.getElementById('detail-project-meta').textContent = 'Client: - | Manager: - | Start Date: -';
                            document.getElementById('detail-project-desc').textContent = 'No description available.';
                            document.getElementById('detail-project-tag').classList.add('hidden');
                            const btnEditProject = document.getElementById('btn-edit-project');
                            if (btnEditProject) btnEditProject.classList.add('hidden');
                            const btnExportHtml = document.getElementById('pm-timetable-export-html');
                            if (btnExportHtml) btnExportHtml.classList.add('hidden');

                            await refreshProjects();
                        } catch (err) {
                            console.error("Delete Project Error:", err);
                        }
                    }
                };
            } else {
                btnDelProjectModal.classList.add('hidden');
            }
        }

        modalProject.classList.remove('hidden');
    };

    if (btnNewProject) {
        btnNewProject.onclick = () => {
            openProjectModal({});
        };
    }

    if (btnCloseProject) btnCloseProject.onclick = closeProject;
    if (btnCancelProject) btnCancelProject.onclick = closeProject;

    if (formProject) {
        formProject.onsubmit = async (e) => {
            e.preventDefault();
            const idVal = document.getElementById('project-id').value;
            const projectData = {
                id: idVal ? parseInt(idVal) : null,
                owner_id: currentUser.id,
                name: document.getElementById('project-name').value,
                description: document.getElementById('project-desc').value,
                manager: document.getElementById('project-manager').value,
                client: document.getElementById('project-client').value,
                start_date: document.getElementById('project-start-date').value,
                created_at: "",
                status: 'active',
                dept1_name: document.getElementById('project-dept1').value,
                dept2_name: document.getElementById('project-dept2').value,
                dept3_name: document.getElementById('project-dept3').value,
                dept4_name: document.getElementById('project-dept4').value,
                project_tag: idVal ? (currentProjects.find(p => p.id === parseInt(idVal))?.project_tag || null) : null
            };
            try {
                const newId = await invoke('plugin:pm|add_project', { project: projectData });
                closeProject();
                await refreshProjects();
                if (projectData.id) {
                    await loadProjectDetails(projectData.id);
                } else if (newId) {
                    await loadProjectDetails(newId);
                }
            } catch (err) { console.error("Save Project Error:", err); }
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

    // Done Log Detail Modal Close
    const btnCloseDoneLogDetailModal = document.getElementById('btn-close-done-log-detail-modal');
    const btnCloseDoneLogDetail = document.getElementById('btn-close-done-log-detail');
    if (btnCloseDoneLogDetailModal) btnCloseDoneLogDetailModal.onclick = () => document.getElementById('modal-done-log-detail').classList.add('hidden');
    if (btnCloseDoneLogDetail) btnCloseDoneLogDetail.onclick = () => document.getElementById('modal-done-log-detail').classList.add('hidden');

    const logStartDate = document.getElementById('log-start-date');
    const logDueDate = document.getElementById('log-due-date');
    if (logStartDate && logDueDate) {
        const validateLogDates = () => {
            const startVal = logStartDate.value;
            const dueVal = logDueDate.value;
            if (startVal && dueVal && dueVal < startVal) {
                alert("Due date must be set after start date.");
                logDueDate.value = startVal;
            }
        };
        logDueDate.onchange = validateLogDates;
        logStartDate.onchange = validateLogDates;
    }

    if (formLog) {
        formLog.onsubmit = async (e) => {
            e.preventDefault();
            const logIdVal = document.getElementById('log-id').value;
            const log = {
                id: logIdVal ? parseInt(logIdVal) : null,
                project_id: parseInt(document.getElementById('log-project-id').value),
                owner_id: currentUser.id,
                department: document.getElementById('log-department').value,
                text_content: document.getElementById('log-content').value,
                timestamp: "",
                status: 'active',
                tag: "",
                title: document.getElementById('log-title').value,
                manager: document.getElementById('log-manager').value,
                start_date: document.getElementById('log-start-date').value || "",
                due_date: document.getElementById('log-due-date').value || ""
            };

            // Character length validation
            if (log.title && log.title.length > 20) {
                alert("Log title cannot exceed 20 characters.");
                return;
            }
            if (log.text_content && log.text_content.length > 500) {
                alert("Log content cannot exceed 500 characters.");
                return;
            }
            if (log.manager && log.manager.length > 15) {
                alert("Log manager cannot exceed 15 characters.");
                return;
            }

            try {
                if (log.id) {
                    await invoke('plugin:pm|update_status_log', { log });
                } else {
                    await invoke('plugin:pm|add_status_log', { log });
                }
                document.getElementById('modal-log').classList.add('hidden');
                loadProjectDetails(log.project_id); // Refresh project details
            } catch (err) { console.error("Add/Update Log Error:", err); }
        };
    }

    // Timetable Controls navigation listeners
    const pmTimetablePrev = document.getElementById('pm-timetable-prev');
    if (pmTimetablePrev) {
        pmTimetablePrev.onclick = () => {
            const scale = document.getElementById('pm-timetable-scale').value;
            if (scale === 'weekly') timetableBaseDate.setDate(timetableBaseDate.getDate() - 1);
            else timetableBaseDate.setMonth(timetableBaseDate.getMonth() - 1);
            renderTimeTable();
        };
    }
    const pmTimetableNext = document.getElementById('pm-timetable-next');
    if (pmTimetableNext) {
        pmTimetableNext.onclick = () => {
            const scale = document.getElementById('pm-timetable-scale').value;
            if (scale === 'weekly') timetableBaseDate.setDate(timetableBaseDate.getDate() + 1);
            else timetableBaseDate.setMonth(timetableBaseDate.getMonth() + 1);
            renderTimeTable();
        };
    }
    const pmTimetableScale = document.getElementById('pm-timetable-scale');
    if (pmTimetableScale) {
        pmTimetableScale.onchange = () => {
            renderTimeTable();
        };
    }
    const pmTimetableShowDeleted = document.getElementById('pm-timetable-show-deleted');
    if (pmTimetableShowDeleted) {
        pmTimetableShowDeleted.onchange = () => {
            renderTimeTable();
        };
    }

    const btnExportHtml = document.getElementById('pm-timetable-export-html');
    if (btnExportHtml) {
        btnExportHtml.onclick = async () => {
            if (!currentProjectId) {
                alert("Please select a project before exporting.");
                return;
            }

            const project = currentProjects.find(p => p.id === currentProjectId);
            if (!project) return;

            try {
                const logs = await invoke('plugin:pm|get_status_logs', { projectId: currentProjectId });
                const milestones = await invoke('plugin:pm|get_milestones', { projectId: currentProjectId });

                const htmlContent = generateProjectHtml(project, milestones, logs);

                if (window.__TAURI__ && window.__TAURI__.dialog) {
                    const savePath = await window.__TAURI__.dialog.save({
                        filters: [{ name: 'HTML Document', extensions: ['html'] }],
                        defaultPath: `Project_Report_${project.name}.html`
                    });

                    if (savePath) {
                        await invoke('plugin:minutes|save_text_file', { path: savePath, content: htmlContent });
                        alert("Project HTML Export Successful!\nSaved to: " + savePath);
                    }
                } else {
                    console.log("Mock Export (No Tauri):", htmlContent);
                    alert("Export feature only works in the desktop Tauri application.");
                }
            } catch (err) {
                console.error("Export HTML Error:", err);
                alert("Failed to export HTML: " + err);
            }
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

    // Done & Deleted Logs Real-time Search & Filter listeners
    ['search-done-logs', 'filter-done-dept'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener(id.includes('search') ? 'input' : 'change', renderDoneLogsList);
        }
    });

    ['search-deleted-logs', 'filter-deleted-dept'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener(id.includes('search') ? 'input' : 'change', renderDeletedLogsList);
        }
    });

    // Real-time Department Slot Configuration change listeners
    ['project-dept1-name', 'project-dept2-name', 'project-dept3-name', 'project-dept4-name'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', saveProjectSlotsDirectly);
        }
    });

    // Global ESC key listener to close all open modals and details drawers
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modals = [
                'modal-signup', 'modal-hint', 'modal-change-pw', 'modal-task',
                'modal-meeting', 'modal-review', 'modal-project', 'modal-privacy',
                'modal-terms', 'modal-contact', 'modal-about', 'modal-milestone',
                'modal-log', 'modal-settings', 'modal-done-log-detail'
            ];
            modals.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.add('hidden');
            });

            const detailDrawer = document.getElementById('pm-timetable-log-detail');
            if (detailDrawer) {
                detailDrawer.style.display = 'none';
                timetableDetailLogId = null;
            }
        }
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

function setupMinutesTabs() {
    const tabs = document.querySelectorAll('#view-minutes .view-tab');
    tabs.forEach(tab => {
        tab.onclick = () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const target = tab.getAttribute('data-view');
            document.querySelectorAll('.minutes-tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`minutes-content-${target}`).classList.add('active');
            
            if (target === 'calendar') {
                renderMinutesCalendar();
            } else {
                refreshMinutes();
            }
        };
    });

    // Minutes Calendar Navigation
    const prevBtn = document.getElementById('minutes-calendar-prev');
    const nextBtn = document.getElementById('minutes-calendar-next');
    if (prevBtn) {
        prevBtn.onclick = () => {
            currentMinutesCalendarDate.setMonth(currentMinutesCalendarDate.getMonth() - 1);
            renderMinutesCalendar();
        };
    }
    if (nextBtn) {
        nextBtn.onclick = () => {
            currentMinutesCalendarDate.setMonth(currentMinutesCalendarDate.getMonth() + 1);
            renderMinutesCalendar();
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
        const deletedTasks = await invoke('plugin:kanban|get_deleted_tasks', { ownerId: currentUser.id });
        const taskToRestore = deletedTasks.find(t => t.id === taskId);
        if (taskToRestore) {
            if (!checkTaskLimits(taskToRestore, true)) {
                return;
            }
        }
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
        'nav-minutes-trash': 'Trash Bin',
        'nav-pm-trash': 'Trash Bin',
        'nav-pm-completed': 'Completed Projects',
        'nav-minutes': 'Minutes Manager',
        'nav-pm': 'Project Manager'
    };

    const pageTitle = document.getElementById('page-title');
    if (pageTitle && titles[viewId]) {
        pageTitle.textContent = titles[viewId];
    }

    // Update active sidebar item
    document.querySelectorAll('.nav-item').forEach(nav => {
        const isActive = nav.id === viewId || 
            (viewId === 'nav-minutes-trash' && nav.id === 'nav-minutes') ||
            (viewId === 'nav-pm-trash' && nav.id === 'nav-pm') ||
            (viewId === 'nav-pm-completed' && nav.id === 'nav-pm');
        nav.classList.toggle('active', isActive);
    });

    // Toggle view visibility
    const targetViewId = viewId === 'nav-pm-trash' ? 'view-project-trash' : 
                         viewId === 'nav-pm-completed' ? 'view-project-completed' :
                         `view-${viewId.replace('nav-', '')}`;
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
    } else if (viewId === 'nav-minutes-trash') {
        await loadDeletedMeetings();
    } else if (viewId === 'nav-pm-trash') {
        await loadDeletedProjects();
    } else if (viewId === 'nav-pm-completed') {
        await loadCompletedProjects();
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
        
        cell.innerHTML = `
            <div class="day-number">${i}</div>
            <div class="calendar-day-items"></div>
        `;
        const itemsContainer = cell.querySelector('.calendar-day-items');
        
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
            itemsContainer.appendChild(taskEl);
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

function renderMinutesCalendar() {
    const grid = document.getElementById('minutes-calendar-grid');
    const monthYear = document.getElementById('minutes-calendar-month-year');
    if (!grid || !monthYear) return;

    const year = currentMinutesCalendarDate.getFullYear();
    const month = currentMinutesCalendarDate.getMonth();
    
    monthYear.textContent = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(currentMinutesCalendarDate);

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
        
        cell.innerHTML = `
            <div class="day-number">${i}</div>
            <div class="calendar-day-items"></div>
        `;
        const itemsContainer = cell.querySelector('.calendar-day-items');
        
        // Find meetings for this day
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const meetingsForDay = currentMeetings.filter(m => !m.is_deleted && m.date && m.date.startsWith(dateStr));
        
        meetingsForDay.forEach(m => {
            const meetingEl = document.createElement('div');
            meetingEl.className = 'calendar-meeting-item';
            meetingEl.textContent = `📝 ${m.title}`;
            meetingEl.title = `${m.title} (${m.meeting_tag || 'No Tag'})`;
            meetingEl.onclick = (e) => {
                e.stopPropagation();
                openMeetingModal(m, false);
            };
            itemsContainer.appendChild(meetingEl);
        });

        grid.appendChild(cell);
    }

    // Next month's days
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
        if (displayStatus === 'Todo') displayStatus = 'To-do';
        
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
        
        const activeTab = document.querySelector('#view-minutes .view-tab.active');
        const activeView = activeTab ? activeTab.getAttribute('data-view') : 'board';
        if (activeView === 'calendar') {
            renderMinutesCalendar();
            return;
        }

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
                    🗑️
                </button>
            </div>
        `;
        
        card.addEventListener('click', () => {
            openMeetingModal(m, false);
        });

        const delBtn = card.querySelector('.delete-meeting-btn');
        if (delBtn) {
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (await askConfirm('Move this meeting to Trash?')) {
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
    body.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
    try {
        const deletedMeetings = await invoke('plugin:minutes|get_deleted_meetings', { ownerId: currentUser.id });
        body.innerHTML = '';
        if (deletedMeetings.length === 0) {
            body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted)">No deleted meetings found.</td></tr>';
            return;
        }
        deletedMeetings.forEach(m => {
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.onclick = () => openMeetingModal(m, true);

            row.innerHTML = `
                <td style="font-family: monospace; font-size: 12px; color: var(--accent-color)">${m.meeting_tag || '-'}</td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span>🗑️</span>
                        <span>${m.title}</span>
                    </div>
                </td>
                <td>${m.date || '-'}</td>
                <td>📍 ${m.location || 'Remote'}</td>
                <td>👥 ${m.participants || '-'}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-restore" data-id="${m.id}">🔄 Restore</button>
                        <button class="btn-hard-del" data-id="${m.id}">🔥 Permanent</button>
                    </div>
                </td>
            `;
            body.appendChild(row);
        });

        // Add listeners
        body.querySelectorAll('.btn-restore').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                restoreMeeting(Number(btn.dataset.id));
            };
        });
        body.querySelectorAll('.btn-hard-del').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                if (await askConfirm('Permanently delete this meeting? This cannot be undone.')) {
                    hardDeleteMeeting(Number(btn.dataset.id));
                }
            };
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
    try {
        await invoke('plugin:minutes|hard_delete_meeting_cmd', { meetingId });
        await loadDeletedMeetings();
    } catch (err) {
        console.error("Hard Delete Meeting Error:", err);
    }
}

async function loadDeletedProjects() {
    const body = document.getElementById('project-trash-list-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
    try {
        const deletedProjects = await invoke('plugin:pm|get_deleted_projects', { ownerId: currentUser.id });
        body.innerHTML = '';
        if (deletedProjects.length === 0) {
            body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted)">No deleted projects found.</td></tr>';
            return;
        }
        deletedProjects.forEach(p => {
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.onclick = () => openProjectModal(p, true);

            row.innerHTML = `
                <td style="font-family: monospace; font-size: 12px; color: var(--accent-color)">${p.project_tag || '-'}</td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span>🗑️</span>
                        <span>${p.name}</span>
                    </div>
                </td>
                <td>${p.description || '-'}</td>
                <td>${p.manager || '-'}</td>
                <td>${p.client || '-'}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-restore" data-id="${p.id}">🔄 Restore</button>
                        <button class="btn-hard-del" data-id="${p.id}">🔥 Permanent</button>
                    </div>
                </td>
            `;
            body.appendChild(row);
        });

        // Add listeners
        body.querySelectorAll('.btn-restore').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                restoreProject(Number(btn.dataset.id));
            };
        });
        body.querySelectorAll('.btn-hard-del').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                if (await askConfirm('Permanently delete this project? This cannot be undone.')) {
                    hardDeleteProject(Number(btn.dataset.id));
                }
            };
        });
    } catch (err) {
        console.error("Load Deleted Projects Error:", err);
    }
}

async function loadCompletedProjects() {
    const body = document.getElementById('project-completed-list-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';
    try {
        const completedProjects = await invoke('plugin:pm|get_completed_projects', { ownerId: currentUser.id });
        body.innerHTML = '';
        if (completedProjects.length === 0) {
            body.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 40px; color: var(--text-muted)">No completed projects found.</td></tr>';
            return;
        }
        completedProjects.forEach(p => {
            const row = document.createElement('tr');
            row.style.cursor = 'default';

            row.innerHTML = `
                <td style="font-family: monospace; font-size: 12px; color: var(--accent-color)">${p.project_tag || '-'}</td>
                <td style="font-weight: 600;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span>✅</span>
                        <span>${p.name}</span>
                    </div>
                </td>
                <td style="color: var(--text-secondary); font-size: 13px;">${p.completion_date || '-'}</td>
                <td style="max-width: 300px; white-space: normal; word-break: break-all; font-size: 13px;">${p.completion_memo || '-'}</td>
                <td>${p.manager || '-'}</td>
                <td>${p.client || '-'}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-restore" data-id="${p.id}" title="Reactivate Project">🔄 Reactivate</button>
                        <button class="btn-hard-del btn-delete-log-permanent" data-id="${p.id}" title="Move to Trash">🗑️ Trash</button>
                    </div>
                </td>
            `;
            body.appendChild(row);
        });

        // Add listeners
        body.querySelectorAll('.btn-restore').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                if (await askConfirm('Are you sure you want to reactivate this completed project back to active?')) {
                    try {
                        await invoke('plugin:pm|reactivate_project', { projectId: Number(btn.dataset.id) });
                        await loadCompletedProjects();
                        await refreshProjects();
                    } catch (err) {
                        console.error("Reactivate Project Error:", err);
                        alert(err);
                    }
                }
            };
        });
        body.querySelectorAll('.btn-delete-log-permanent').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                if (await askConfirm('Are you sure you want to move this project to the Trash Bin?')) {
                    try {
                        await invoke('plugin:pm|delete_project', { projectId: Number(btn.dataset.id) });
                        await loadCompletedProjects();
                    } catch (err) {
                        console.error("Delete Completed Project Error:", err);
                        alert(err);
                    }
                }
            };
        });
    } catch (err) {
        console.error("Load Completed Projects Error:", err);
    }
}

function openCompleteProjectModal(project) {
    const modal = document.getElementById('modal-complete-project');
    if (!modal) return;
    
    document.getElementById('complete-project-id').value = project.id;
    
    // Set default completion date to today (YYYY-MM-DD)
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('complete-project-date').value = today;
    document.getElementById('complete-project-memo').value = '';
    
    modal.classList.remove('hidden');
}

async function restoreProject(projectId) {
    try {
        await invoke('plugin:pm|restore_project', { projectId });
        await loadDeletedProjects();
        await refreshProjects();
    } catch (err) {
        console.error("Restore Project Error:", err);
    }
}

async function hardDeleteProject(projectId) {
    try {
        await invoke('plugin:pm|hard_delete_project_cmd', { projectId });
        await loadDeletedProjects();
    } catch (err) {
        console.error("Hard Delete Project Error:", err);
    }
}

let currentProjectId = null;
let currentStatusLogs = [];
let currentProjectMilestones = [];

async function saveProjectSlotsDirectly() {
    if (!currentProjectId) return;
    const project = currentProjects.find(p => p.id === currentProjectId);
    if (!project) return;

    const newDept1 = document.getElementById('project-dept1-name').value.trim();
    const newDept2 = document.getElementById('project-dept2-name').value.trim();
    const newDept3 = document.getElementById('project-dept3-name').value.trim();
    const newDept4 = document.getElementById('project-dept4-name').value.trim();

    const updatedProject = {
        ...project,
        dept1_name: newDept1 || 'Mech',
        dept2_name: newDept2 || 'Control',
        dept3_name: newDept3 || 'Elec',
        dept4_name: newDept4 || 'Sales'
    };

    try {
        await invoke('plugin:pm|add_project', { project: updatedProject });
        await refreshProjects();
        await loadProjectDetails(currentProjectId);
    } catch (err) {
        console.error("Save Project Slots Directly Error:", err);
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
            item.dataset.id = p.id;
            
            // Render Tag Badge if exists
            const tagBadge = p.project_tag ? `<span class="tag-badge-mini" style="margin-left: 0; margin-bottom: 6px; display: inline-block;">${p.project_tag}</span>` : '';
            
            item.innerHTML = `
                ${tagBadge}
                <h4>${p.name}</h4>
                <div class="client">${p.client || 'Internal Project'}</div>
                <div class="project-actions-mini">
                    <button class="btn-icon complete-project-btn" title="Complete Project">✓</button>
                    <button class="btn-icon delete-project-btn" title="Delete">🗑️</button>
                </div>
                <div class="project-actions-bottom-mini">
                    <button class="btn-icon export-project-btn" title="Export DB">📤</button>
                </div>
            `;
            item.addEventListener('click', () => loadProjectDetails(p.id));

            const completeBtn = item.querySelector('.complete-project-btn');
            if (completeBtn) {
                completeBtn.onclick = async (e) => {
                    e.stopPropagation();
                    openCompleteProjectModal(p);
                };
            }

            const exportBtn = item.querySelector('.export-project-btn');
            if (exportBtn) {
                exportBtn.onclick = async (e) => {
                    e.stopPropagation();
                    try {
                        const filePath = await window.__TAURI__.dialog.save({
                            title: "Export Project DB",
                            filters: [{ name: 'Project DB', extensions: ['json'] }],
                            defaultPath: `${p.name.replace(/[\/\\?%*:|"<>\s]/g, '_')}_project_db.json`
                        });
                        if (filePath) {
                            await invoke('plugin:pm|export_project_db', { projectId: p.id, filePath: filePath });
                            alert("Project DB exported successfully!");
                        }
                    } catch (err) {
                        console.error(err);
                        alert("Failed to export Project DB: " + err);
                    }
                };
            }

            const delBtn = item.querySelector('.delete-project-btn');
            if (delBtn) {
                delBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (await askConfirm('Move this project and all its milestones/logs to Trash?')) {
                        try {
                            await invoke('plugin:pm|delete_project', { projectId: p.id });
                            
                            // If the deleted project was the currently selected one, clear detail panel
                            const activeItem = document.querySelector('.project-item.active');
                            const isActiveSelected = activeItem && Number(activeItem.dataset.id) === p.id;
                            if (isActiveSelected) {
                                document.getElementById('detail-project-name').textContent = 'Select a Project';
                                document.getElementById('detail-project-meta').textContent = 'Client: - | Manager: - | Start Date: -';
                                document.getElementById('detail-project-desc').textContent = 'No description available.';
                                document.getElementById('detail-project-tag').classList.add('hidden');
                                const btnEditProject = document.getElementById('btn-edit-project');
                                if (btnEditProject) btnEditProject.classList.add('hidden');
                                const btnExportHtml = document.getElementById('pm-timetable-export-html');
                                if (btnExportHtml) btnExportHtml.classList.add('hidden');
                            }
                            
                            await refreshProjects();
                        } catch (err) {
                            console.error("Delete Project Error:", err);
                        }
                    }
                };
            }

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

    currentProjectId = projectId;

    // Highlight active item
    document.querySelectorAll('.project-item').forEach(item => {
        if (Number(item.dataset.id) === projectId) item.classList.add('active');
        else item.classList.remove('active');
    });

    // Update Header Info
    const detailTag = document.getElementById('detail-project-tag');
    if (detailTag) {
        if (project.project_tag) {
            detailTag.textContent = project.project_tag;
            detailTag.classList.remove('hidden');
        } else {
            detailTag.textContent = '';
            detailTag.classList.add('hidden');
        }
    }
    document.getElementById('detail-project-name').textContent = project.name;
    const btnEditProject = document.getElementById('btn-edit-project');
    if (btnEditProject) {
        btnEditProject.classList.remove('hidden');
        btnEditProject.onclick = () => openProjectModal(project);
    }
    const btnExportHtml = document.getElementById('pm-timetable-export-html');
    if (btnExportHtml) {
        btnExportHtml.classList.remove('hidden');
    }
    document.getElementById('detail-project-meta').textContent = `Client: ${project.client || '-'} | Manager: ${project.manager || '-'} | Start Date: ${project.start_date || '-'}`;

    // Update Status Tab
    document.getElementById('detail-project-desc').textContent = project.description || 'No description available.';
    
    // Fill Department Slot Configuration Inputs
    const dept1Input = document.getElementById('project-dept1-name');
    const dept2Input = document.getElementById('project-dept2-name');
    const dept3Input = document.getElementById('project-dept3-name');
    const dept4Input = document.getElementById('project-dept4-name');
    if (dept1Input) dept1Input.value = project.dept1_name || 'Mech';
    if (dept2Input) dept2Input.value = project.dept2_name || 'Control';
    if (dept3Input) dept3Input.value = project.dept3_name || 'Elec';
    if (dept4Input) dept4Input.value = project.dept4_name || 'Sales';

    // Rename and Style Columns on Kanban Board to match Timetable department colors
    const col1 = document.getElementById('col-header-dept1');
    const col2 = document.getElementById('col-header-dept2');
    const col3 = document.getElementById('col-header-dept3');
    const col4 = document.getElementById('col-header-dept4');
    
    if (col1) {
        col1.textContent = project.dept1_name || 'Mech';
        col1.style.color = '#3b82f6';
        col1.style.borderBottom = '1px solid rgba(59, 130, 246, 0.25)';
        if (col1.parentElement) {
            col1.parentElement.style.border = '1px solid rgba(59, 130, 246, 0.2)';
            col1.parentElement.style.background = 'rgba(59, 130, 246, 0.015)';
            const btn1 = col1.parentElement.querySelector('.btn-add-log-col');
            if (btn1) {
                btn1.style.borderColor = 'rgba(59, 130, 246, 0.3)';
                btn1.style.color = 'rgba(59, 130, 246, 0.8)';
            }
        }
    }
    if (col2) {
        col2.textContent = project.dept2_name || 'Control';
        col2.style.color = '#f59e0b';
        col2.style.borderBottom = '1px solid rgba(245, 158, 11, 0.25)';
        if (col2.parentElement) {
            col2.parentElement.style.border = '1px solid rgba(245, 158, 11, 0.2)';
            col2.parentElement.style.background = 'rgba(245, 158, 11, 0.015)';
            const btn2 = col2.parentElement.querySelector('.btn-add-log-col');
            if (btn2) {
                btn2.style.borderColor = 'rgba(245, 158, 11, 0.3)';
                btn2.style.color = 'rgba(245, 158, 11, 0.8)';
            }
        }
    }
    if (col3) {
        col3.textContent = project.dept3_name || 'Elec';
        col3.style.color = '#10b981';
        col3.style.borderBottom = '1px solid rgba(16, 185, 129, 0.25)';
        if (col3.parentElement) {
            col3.parentElement.style.border = '1px solid rgba(16, 185, 129, 0.2)';
            col3.parentElement.style.background = 'rgba(16, 185, 129, 0.015)';
            const btn3 = col3.parentElement.querySelector('.btn-add-log-col');
            if (btn3) {
                btn3.style.borderColor = 'rgba(16, 185, 129, 0.3)';
                btn3.style.color = 'rgba(16, 185, 129, 0.8)';
            }
        }
    }
    if (col4) {
        col4.textContent = project.dept4_name || 'Sales';
        col4.style.color = '#ef4444';
        col4.style.borderBottom = '1px solid rgba(239, 68, 68, 0.25)';
        if (col4.parentElement) {
            col4.parentElement.style.border = '1px solid rgba(239, 68, 68, 0.2)';
            col4.parentElement.style.background = 'rgba(239, 68, 68, 0.015)';
            const btn4 = col4.parentElement.querySelector('.btn-add-log-col');
            if (btn4) {
                btn4.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                btn4.style.color = 'rgba(239, 68, 68, 0.8)';
            }
        }
    }

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

    // Update Done & Deleted Logs filter dropdowns with dynamic custom slot names
    const filterDoneDept = document.getElementById('filter-done-dept');
    const filterDeletedDept = document.getElementById('filter-deleted-dept');
    const customDepts = [
        project.dept1_name || 'Mech',
        project.dept2_name || 'Control',
        project.dept3_name || 'Elec',
        project.dept4_name || 'Sales'
    ];

    [filterDoneDept, filterDeletedDept].forEach(select => {
        if (select) {
            select.innerHTML = '<option value="">All Departments</option>';
            customDepts.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                select.appendChild(opt);
            });
        }
    });

    try {
        // Load Milestones
        const milestones = await invoke('plugin:pm|get_milestones', { projectId: project.id });
        renderMilestones(project.id, milestones);

        // Load Status Logs
        await renderTimeTable();

        // Update Log Form Hidden Field
        document.getElementById('log-project-id').value = project.id;
        
        // Add Log Button Listener (Reset and Open)
        const btnAddLog = document.getElementById('btn-add-log');
        if (btnAddLog) {
            btnAddLog.onclick = () => {
                document.getElementById('form-log').reset();
                document.getElementById('log-project-id').value = project.id;
                document.getElementById('log-id').value = '';
                document.getElementById('log-modal-title').textContent = 'Add Status Log';
                prepareStatusLogModalButtons('', 'active');
                document.getElementById('modal-log').classList.remove('hidden');
            };
        }

        // Add Log Column Buttons Listener (Prefill Department and Open)
        document.querySelectorAll('.btn-add-log-col').forEach(btn => {
            btn.onclick = () => {
                document.getElementById('form-log').reset();
                document.getElementById('log-project-id').value = project.id;
                document.getElementById('log-id').value = '';
                document.getElementById('log-modal-title').textContent = 'Add Status Log';
                
                const rawDept = btn.getAttribute('data-dept');
                let customDeptName = '';
                if (rawDept === 'Mech') customDeptName = project.dept1_name || 'Mech';
                else if (rawDept === 'Control') customDeptName = project.dept2_name || 'Control';
                else if (rawDept === 'Elec') customDeptName = project.dept3_name || 'Elec';
                else if (rawDept === 'Sales') customDeptName = project.dept4_name || 'Sales';
                
                const logDeptSelect = document.getElementById('log-department');
                if (logDeptSelect && customDeptName) {
                    logDeptSelect.value = customDeptName;
                }
                
                prepareStatusLogModalButtons('', 'active');
                document.getElementById('modal-log').classList.remove('hidden');
            };
        });

    } catch (err) { console.error("Load Project Details Error:", err); }
}

function renderMilestones(projectId, milestones) {
    const grid = document.getElementById('milestones-grid');
    if (!grid) return;

    grid.innerHTML = ''; // Clear existing dynamically

    for (let slotNum = 1; slotNum <= 20; slotNum++) {
        const ms = milestones.find(m => m.slot_number === slotNum);
        const card = document.createElement('div');
        
        let cardClass = 'milestone-slot';
        if (ms && ms.is_saved && ms.is_done) {
            cardClass += ' done';
        } else if (ms && ms.is_saved) {
            cardClass += ' pending-saved';
        }
        card.className = cardClass;
        
        card.setAttribute('data-slot', slotNum);

        const displayNum = slotNum < 10 ? '0' + slotNum : slotNum;
        const hasData = ms && ms.is_saved && (ms.name || ms.deadline);
        const name = hasData ? ms.name : '---';
        const deadline = hasData ? ms.deadline : 'YYYY-MM-DD';
        const status = (ms && ms.is_saved && ms.is_done) ? 'Done' : 'Pending';

        let actionHtml = '';
        if (hasData) {
            actionHtml = `
                <div class="milestone-actions">
                    ${ms.is_done 
                        ? `<button class="btn-milestone-active compact" title="Re-active Milestone">↩</button>` 
                        : `<button class="btn-milestone-done compact" title="Complete Milestone">✓</button>`
                    }
                    <button class="btn-milestone-del compact" title="Reset Milestone">🗑️</button>
                </div>
            `;
        }

        card.innerHTML = `
            <div class="slot-num">${displayNum}</div>
            <div class="slot-content">
                <div class="slot-name">${name}</div>
                <div class="slot-date">${deadline}</div>
            </div>
            <div class="slot-status">${status}</div>
            ${actionHtml}
        `;

        card.onclick = () => {
            document.getElementById('form-milestone').reset();
            document.getElementById('ms-slot-num').textContent = `#${displayNum}`;
            document.getElementById('ms-project-id').value = projectId;
            document.getElementById('ms-slot-number').value = slotNum;
            
            if (ms && ms.is_saved) {
                document.getElementById('ms-id').value = ms.id || '';
                document.getElementById('ms-name').value = ms.name || '';
                document.getElementById('ms-deadline').value = ms.deadline || '';
                document.getElementById('ms-content').value = ms.content || '';
                document.getElementById('ms-is-done').checked = ms.is_done || false;
            } else {
                document.getElementById('ms-id').value = ms ? (ms.id || '') : '';
                document.getElementById('ms-name').value = '';
                document.getElementById('ms-deadline').value = '';
                document.getElementById('ms-content').value = '';
                document.getElementById('ms-is-done').checked = false;
            }
            
            document.getElementById('modal-milestone').classList.remove('hidden');
        };

        if (hasData) {
            const btnDone = card.querySelector('.btn-milestone-done');
            if (btnDone) {
                btnDone.onclick = async (e) => {
                    e.stopPropagation();
                    const milestone = {
                        id: ms.id || null,
                        project_id: projectId,
                        slot_number: slotNum,
                        name: ms.name,
                        deadline: ms.deadline,
                        content: ms.content || '',
                        is_saved: true,
                        is_done: true
                    };
                    try {
                        await invoke('plugin:pm|save_milestone', { milestone });
                        loadProjectDetails(projectId); // Refresh UI
                    } catch (err) {
                        console.error("Complete Milestone Error:", err);
                    }
                };
            }

            const btnActive = card.querySelector('.btn-milestone-active');
            if (btnActive) {
                btnActive.onclick = async (e) => {
                    e.stopPropagation();
                    const milestone = {
                        id: ms.id || null,
                        project_id: projectId,
                        slot_number: slotNum,
                        name: ms.name,
                        deadline: ms.deadline,
                        content: ms.content || '',
                        is_saved: true,
                        is_done: false
                    };
                    try {
                        await invoke('plugin:pm|save_milestone', { milestone });
                        loadProjectDetails(projectId); // Refresh UI
                    } catch (err) {
                        console.error("Re-active Milestone Error:", err);
                    }
                };
            }

            const btnDel = card.querySelector('.btn-milestone-del');
            if (btnDel) {
                btnDel.onclick = async (e) => {
                    e.stopPropagation();
                    if (await askConfirm('Are you sure you want to reset this milestone slot?')) {
                        const milestone = {
                            id: ms.id || null,
                            project_id: projectId,
                            slot_number: slotNum,
                            name: '',
                            deadline: '',
                            content: '',
                            is_saved: false,
                            is_done: false
                        };
                        try {
                            await invoke('plugin:pm|save_milestone', { milestone });
                            loadProjectDetails(projectId); // Refresh UI
                        } catch (err) {
                            console.error("Reset Milestone Error:", err);
                        }
                    }
                };
            }
        }

        grid.appendChild(card);
    }
}

let timetableBaseDate = new Date();
let timetableDetailLogId = null;

async function renderTimeTable() {
    if (!currentProjectId) return;
    const container = document.getElementById('pm-timetable-container');
    const scaleSelect = document.getElementById('pm-timetable-scale');
    if (!scaleSelect || !container) return;
    const scale = scaleSelect.value;

    container.innerHTML = '';

    // Fetch live data from backend
    let logs = [];
    let milestones = [];
    try {
        logs = await invoke('plugin:pm|get_status_logs', { projectId: currentProjectId });
        milestones = await invoke('plugin:pm|get_milestones', { projectId: currentProjectId });
        currentStatusLogs = logs;
        currentProjectMilestones = milestones;

        // Render Done and Deleted logs lists
        renderDoneLogsList();
        renderDeletedLogsList();

        // Render Kanban Status Board columns
        const project = currentProjects.find(p => p.id === currentProjectId);
        if (project) {
            renderStatusGrid(project);
        }
    } catch (err) {
        console.error("Fetch live timetable data error:", err);
        return;
    }

    // Determine date range and scale
    const now = new Date();
    let startDate, days;

    if (scale === 'weekly') {
        startDate = new Date(timetableBaseDate);
        startDate.setDate(startDate.getDate() - 3); // Center around base date (3 days before, 3 days after, today at center)
        startDate.setHours(0, 0, 0, 0);
        days = 7;
    } else {
        // Monthly view = 12 months centered around the base date's year
        startDate = new Date(timetableBaseDate.getFullYear(), timetableBaseDate.getMonth() - 5, 1);
        days = 12; // Show 12 months
    }

    // Set standard grid count custom variable for dotted lines
    container.style.setProperty('--day-count', days);

    // Update current range header label
    const rangeLabel = document.getElementById('pm-timetable-current-range');
    if (rangeLabel) {
        if (scale === 'weekly') {
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6);
            rangeLabel.textContent = `${getLocalDateString(startDate)} ~ ${getLocalDateString(endDate)}`;
        } else {
            const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 11, 1);
            rangeLabel.textContent = `${startDate.getFullYear()}.${String(startDate.getMonth() + 1).padStart(2, '0')} ~ ${endDate.getFullYear()}.${String(endDate.getMonth() + 1).padStart(2, '0')}`;
        }
    }

    function calculatePct(date) {
        if (scale === 'weekly') {
            const diffTime = date.getTime() - startDate.getTime();
            const diffDays = diffTime / (1000 * 3600 * 24);
            if (diffDays >= -1 && diffDays <= 8) { // buffer allowance
                return (diffDays / 7) * 100;
            }
        } else {
            const monthDiff = (date.getFullYear() - startDate.getFullYear()) * 12 + (date.getMonth() - startDate.getMonth());
            if (monthDiff >= -1 && monthDiff <= 13) {
                const day = date.getDate();
                const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
                return ((monthDiff + (day / daysInMonth)) / 12) * 100;
            }
        }
        return -1;
    }

    // Header layout
    const header = document.createElement('div');
    header.className = 'timetable-header';

    const yHeader = document.createElement('div');
    yHeader.className = 'timetable-y-axis-header';
    header.appendChild(yHeader);

    const xAxis = document.createElement('div');
    xAxis.className = 'timetable-x-axis';
    xAxis.style.position = 'relative';



    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    for (let i = 0; i < days; i++) {
        const dayCol = document.createElement('div');
        dayCol.className = 'timetable-day-col';

        if (scale === 'weekly') {
            const d = new Date(startDate);
            d.setDate(startDate.getDate() + i);
            if (d.toDateString() === now.toDateString()) dayCol.classList.add('today');
            const m = d.getMonth() + 1;
            const day = d.getDate();
            const dayName = dayNames[d.getDay()];
            dayCol.textContent = `${m}/${day} (${dayName})`;

            // Highlight col if a milestone deadline falls on this day
            const dStr = getLocalDateString(d);
            const dayMilestones = milestones.filter(ms => ms.is_saved && ms.deadline === dStr);
            if (dayMilestones.length > 0) {
                dayCol.classList.add('milestone-highlight');
                if (dayMilestones.every(ms => ms.is_done)) {
                    dayCol.classList.add('is-done');
                }
            }
        } else {
            // Monthly view
            const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
            const y = d.getFullYear();
            const m = d.getMonth();
            dayCol.textContent = `${y} ${monthNames[m]}`;
            if (y === now.getFullYear() && m === now.getMonth()) dayCol.classList.add('today');
        }
        xAxis.appendChild(dayCol);
    }
    header.appendChild(xAxis);
    container.appendChild(header);

    const body = document.createElement('div');
    body.className = 'timetable-body';
    body.style.position = 'relative';

    // Render global milestone vertical dashed lines stretching across all tracks
    const msLinesContainer = document.createElement('div');
    msLinesContainer.className = 'milestone-lines-container';
    msLinesContainer.style.position = 'absolute';
    msLinesContainer.style.left = '140px';
    msLinesContainer.style.right = '0';
    msLinesContainer.style.top = '0';
    msLinesContainer.style.bottom = '0';
    msLinesContainer.style.pointerEvents = 'none';
    msLinesContainer.style.zIndex = '1';
    body.appendChild(msLinesContainer);

    if (milestones.length > 0) {
        const sorted = [...milestones].filter(m => m.is_saved && m.deadline).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
        sorted.forEach((m) => {
            const mDate = new Date(m.deadline);
            const pct = calculatePct(mDate);
            if (pct >= 0 && pct <= 100) {
                const line = document.createElement('div');
                line.className = 'milestone-line';
                if (m.is_done) line.classList.add('is-done');
                else if (m.deadline) line.classList.add('pending-saved');
                line.style.left = pct + '%';
                line.style.height = '100%';
                msLinesContainer.appendChild(line);
            }
        });
    }

    // Retrieve live department names from the project object
    const project = currentProjects.find(p => p.id === currentProjectId);
    if (!project) return;

    const depts = [
        { key: 'Slot 1', name: project.dept1_name || 'Mech', color: 'rgba(59, 130, 246, 0.45)' },
        { key: 'Slot 2', name: project.dept2_name || 'Control', color: 'rgba(245, 158, 11, 0.45)' },
        { key: 'Slot 3', name: project.dept3_name || 'Elec', color: 'rgba(16, 185, 129, 0.45)' },
        { key: 'Slot 4', name: project.dept4_name || 'Sales', color: 'rgba(239, 68, 68, 0.45)' },
        { key: 'Milestone', name: 'Mile stone', color: 'rgba(168, 85, 247, 0.65)' }
    ];

    depts.forEach(dept => {
        const track = document.createElement('div');
        track.className = 'timetable-track';
        if (dept.key === 'Milestone') track.classList.add('milestone-track-row');

        const label = document.createElement('div');
        label.className = 'timetable-track-label';
        label.textContent = `[ ${dept.name.toUpperCase()} ]`;
        label.style.color = dept.color;
        track.appendChild(label);

        const content = document.createElement('div');
        content.className = 'timetable-track-content';
        content.style.backgroundSize = `${(100 / days)}% 100%`;

        if (dept.key === 'Milestone') {
            const msLabelsContainer = document.createElement('div');
            msLabelsContainer.className = 'milestone-labels-container';
            msLabelsContainer.style.position = 'absolute';
            msLabelsContainer.style.left = '0';
            msLabelsContainer.style.right = '0';
            msLabelsContainer.style.top = '0';
            msLabelsContainer.style.bottom = '0';
            msLabelsContainer.style.pointerEvents = 'none';
            msLabelsContainer.style.zIndex = '26';
            content.appendChild(msLabelsContainer);

            if (milestones.length > 0) {
                const sorted = [...milestones].filter(m => m.is_saved && m.deadline).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
                sorted.forEach((m, idx) => {
                    const mDate = new Date(m.deadline);
                    const pct = calculatePct(mDate);
                    if (pct >= 0 && pct <= 100) {
                        const label = document.createElement('div');
                        label.className = 'milestone-line-label';
                        if (m.is_done) label.classList.add('is-done');
                        else if (m.deadline) label.classList.add('pending-saved');
                        label.textContent = `📌 ${m.name} (${m.deadline.substring(5)})`;
                        label.style.left = pct + '%';
                        label.style.bottom = (12 + (idx % 3) * 26) + 'px';
                        label.style.top = 'auto';
                        msLabelsContainer.appendChild(label);
                    }
                });
            }
        } else {
            const showDeleted = document.getElementById('pm-timetable-show-deleted')?.checked;

            // Filter status logs by matching the department value
            let deptLogs = logs.filter(l => l.department === dept.name);
            if (!showDeleted) {
                deptLogs = deptLogs.filter(l => !l.is_deleted);
            }

            // Sort by timestamp ascending
            deptLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            const placedMarkers = [];

            deptLogs.forEach(log => {
                let leftPct = -1;
                let widthPct = -1;

                const sDateStr = log.start_date;
                const dDateStr = log.due_date;
                const logDate = new Date(log.timestamp);

                if (sDateStr && dDateStr && sDateStr !== dDateStr) {
                    // Range display
                    const s = new Date(sDateStr);
                    const d = new Date(dDateStr);
                    d.setHours(23, 59, 59, 999);

                    leftPct = calculatePct(s);
                    const rightPct = calculatePct(d);
                    if (leftPct !== -1 && rightPct !== -1) {
                        widthPct = rightPct - leftPct;
                        if (widthPct < 1.0) widthPct = 1.0; // Min visibility
                    } else if (leftPct !== -1) {
                        widthPct = 100 - leftPct; // Overflow right
                    } else if (rightPct !== -1) {
                        widthPct = rightPct; // Overflow left
                        leftPct = 0;
                    }
                } else {
                    // Point display (uses due_date/deadline if present, else start_date, else timestamp)
                    const targetDate = dDateStr ? new Date(dDateStr) : (sDateStr ? new Date(sDateStr) : logDate);
                    leftPct = calculatePct(targetDate);
                }

                if (leftPct !== -1) {
                    // Overlap prevention (vertical lane stacking)
                    let lane = 0;
                    const minDistance = 2.5; // percent distance to stack markers
                    const spanEnd = widthPct !== -1 ? leftPct + widthPct : leftPct;

                    while (placedMarkers.some(m => {
                        const mEnd = m.width !== -1 ? m.left + m.width : m.left;
                        const overlap = Math.max(m.left, leftPct) < Math.min(mEnd, spanEnd);
                        const touch = Math.abs(m.left - leftPct) < minDistance;
                        return (overlap || touch) && m.lane === lane;
                    })) {
                        lane++;
                    }

                    placedMarkers.push({ left: leftPct, width: widthPct, lane: lane });

                    const laneOffsets = [0, -18, 18, -26, 26];
                    const finalOffset = laneOffsets[lane % laneOffsets.length];

                    const marker = document.createElement('div');
                    marker.className = widthPct !== -1 ? 'timetable-log-range' : 'timetable-log-marker';
                    
                    // Add status class for styling
                    if (log.status) marker.classList.add(log.status);
                    else marker.classList.add('doing'); // fallback

                    marker.style.left = leftPct + '%';
                    if (widthPct !== -1) {
                        marker.style.width = widthPct + '%';
                        marker.textContent = log.title;
                    }
                    marker.style.top = (60 + finalOffset) + 'px'; // Lane spacing offset

                    const tooltipEl = document.getElementById('global-timetable-tooltip');
                    let logText = log.text_content || '[ No content ]';
                    
                    const formatDateToMD = (dateStr) => {
                        if (!dateStr) return '-';
                        const parts = dateStr.split('-');
                        if (parts.length >= 3) {
                            return `${parts[1]}/${parts[2]}`;
                        }
                        return dateStr;
                    };

                    let dateRangeStr = '';
                    if (log.start_date || log.due_date) {
                        const sMD = formatDateToMD(log.start_date);
                        const dMD = formatDateToMD(log.due_date);
                        dateRangeStr = `[${sMD} ~ ${dMD}] `;
                    }

                    let tooltipContent = `<strong>${dateRangeStr}${log.title}</strong><br>${logText.replace(/\n/g, '<br>')}`;

                    if (log.is_deleted) {
                        marker.classList.add('deleted');
                        tooltipContent = `<span style="text-decoration: line-through; opacity: 0.6;">${tooltipContent}</span>`;
                    } else if (log.status === 'done') {
                        tooltipContent = `<span style="color: #10b981; font-weight:bold;">[DONE]</span><br>${tooltipContent}`;
                    }

                    // Interactive Mouse Follow Tooltip
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
                        refreshPMTimetableLogDetail(log.id, logs);
                    };

                    content.appendChild(marker);
                }
            });
        }

        track.appendChild(content);
        body.appendChild(track);
    });

    container.appendChild(body);
}

function getLocalDateString(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

async function refreshPMTimetableLogDetail(logId, preloadedLogs) {
    if (!logId) return;
    timetableDetailLogId = logId;

    let logs = preloadedLogs;
    if (!logs) {
        logs = await invoke('plugin:pm|get_status_logs', { projectId: currentProjectId });
    }

    const log = logs.find(l => l.id === logId);
    if (!log) {
        document.getElementById('pm-timetable-log-detail').style.display = 'none';
        timetableDetailLogId = null;
        return;
    }

    const detailArea = document.getElementById('pm-timetable-log-detail');
    const header = document.getElementById('pm-timetable-detail-header');
    const contentArea = document.getElementById('pm-timetable-detail-content');
    const imgContainer = document.getElementById('pm-timetable-detail-image');

    detailArea.style.display = 'flex';

    let statusTag = '';
    if (log.status === 'done') statusTag = ' [DONE]';
    else if (log.is_deleted) statusTag = ' [DELETED]';

    header.textContent = `[${log.department.toUpperCase()}] ${log.tag || ''} - ${formatLogTimestamp(log.timestamp)}${statusTag}`;

    let html = '';
    if (log.title) html += `<div style="font-weight: 700; color: var(--accent-color); font-size: 15px; margin-bottom: 6px;">${log.title}</div>`;
    if (log.manager) html += `<div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;"><strong>PIC:</strong> ${log.manager}</div>`;
    if (log.start_date || log.due_date) html += `<div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;"><strong>Schedule:</strong> ${log.start_date || '?'} ~ ${log.due_date || '?'}</div>`;
    if (log.text_content) html += `<div style="margin-top: 10px; font-size: 13px; line-height: 1.6; color: var(--text-color);">${log.text_content}</div>`;

    contentArea.innerHTML = html;

    // Base64 or standard file image previews
    imgContainer.innerHTML = '';

    // Configure Action Buttons inside Detail Panel
    const btnEdit = document.getElementById('pm-timetable-detail-edit');
    const btnDone = document.getElementById('pm-timetable-detail-done');
    const btnRestore = document.getElementById('pm-timetable-detail-restore');
    const btnDelete = document.getElementById('pm-timetable-detail-delete');

    if (log.is_deleted) {
        if (btnDone) btnDone.style.display = 'none';
        if (btnRestore) btnRestore.style.display = 'inline-block';
        if (btnDelete) btnDelete.textContent = 'Hard Delete';
    } else {
        if (btnDone) {
            btnDone.style.display = 'inline-block';
            btnDone.textContent = log.status === 'done' ? 'Set Active' : 'Done';
        }
        if (btnRestore) btnRestore.style.display = 'none';
        if (btnDelete) btnDelete.textContent = 'Delete';
    }

    // Edit button opens modal-log with prefilled fields
    if (btnEdit) {
        btnEdit.onclick = () => {
            document.getElementById('form-log').reset();
            document.getElementById('log-project-id').value = log.project_id;
            document.getElementById('log-id').value = log.id;
            document.getElementById('log-department').value = log.department;
            document.getElementById('log-title').value = log.title || '';
            document.getElementById('log-content').value = log.text_content || '';
            document.getElementById('log-start-date').value = log.start_date || '';
            document.getElementById('log-due-date').value = log.due_date || '';
            document.getElementById('log-manager').value = log.manager || '';

            // Update modal title
            document.getElementById('log-modal-title').textContent = 'Edit Status Log';
            prepareStatusLogModalButtons(log.id, log.status);
            document.getElementById('modal-log').classList.remove('hidden');
        };
    }

    // Done button (Done/Active toggle)
    if (btnDone) {
        btnDone.onclick = async () => {
            const nextStatus = log.status === 'done' ? 'active' : 'done';
            try {
                await invoke('plugin:pm|update_status_log_status', { logId: log.id, status: nextStatus });
                detailArea.style.display = 'none';
                await renderTimeTable();
            } catch (err) {
                console.error("Update Status Log Done toggle error:", err);
            }
        };
    }

    // Restore button (soft-deleted back to active)
    if (btnRestore) {
        btnRestore.onclick = async () => {
            try {
                await invoke('plugin:pm|update_status_log_deleted', { logId: log.id, isDeleted: false });
                detailArea.style.display = 'none';
                await renderTimeTable();
            } catch (err) {
                console.error("Restore Status Log error:", err);
            }
        };
    }

    // Delete button (soft-delete / hard-delete)
    if (btnDelete) {
        btnDelete.onclick = async () => {
            if (log.is_deleted) {
                // Hard delete permanent
                const confirmHard = await askConfirm("Are you sure you want to permanently delete this status log? This cannot be undone.", "Permanent Delete");
                if (!confirmHard) return;
                try {
                    await invoke('plugin:pm|delete_status_log_permanent', { logId: log.id });
                    detailArea.style.display = 'none';
                    await renderTimeTable();
                } catch (err) {
                    console.error("Hard Delete Status Log error:", err);
                }
            } else {
                // Soft delete
                try {
                    await invoke('plugin:pm|update_status_log_deleted', { logId: log.id, isDeleted: true });
                    detailArea.style.display = 'none';
                    await renderTimeTable();
                } catch (err) {
                    console.error("Soft Delete Status Log error:", err);
                }
            }
        };
    }
}

function renderDoneLogsList() {
    const listBody = document.getElementById('done-logs-list-body');
    if (!listBody) return;
    listBody.innerHTML = '';

    const searchQuery = (document.getElementById('search-done-logs')?.value || '').toLowerCase();
    const selectedDept = document.getElementById('filter-done-dept')?.value || '';

    const filtered = currentStatusLogs.filter(log => {
        if (log.is_deleted || log.status !== 'done') return false;
        if (selectedDept && log.department !== selectedDept) return false;
        if (searchQuery) {
            const title = (log.title || '').toLowerCase();
            const content = (log.text_content || '').toLowerCase();
            const manager = (log.manager || '').toLowerCase();
            const tag = (log.tag || '').toLowerCase();
            if (!title.includes(searchQuery) && !content.includes(searchQuery) && !manager.includes(searchQuery) && !tag.includes(searchQuery)) {
                return false;
            }
        }
        return true;
    });

    if (filtered.length === 0) {
        listBody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--text-secondary);">No done status logs found.</td></tr>`;
        return;
    }

    filtered.forEach(log => {
        const tr = document.createElement('tr');

        tr.onclick = (e) => {
            if (e.target.closest('button')) return;
            openDoneLogDetailModal(log);
        };

        tr.innerHTML = `
            <td style="font-family: monospace; font-size: 12px; color: var(--accent-color)">${log.tag || '-'}</td>
            <td style="color: #94a3b8; font-weight: 600;">[${log.department.toUpperCase()}]</td>
            <td style="font-weight: 600; color: #fff;">${log.title || '-'}</td>
            <td>${log.manager || '-'}</td>
            <td style="color: #888; font-size: 13px;">${formatLogTimestamp(log.timestamp)}</td>
            <td>
                <div class="action-buttons" style="justify-content: center;">
                    <button class="btn-restore btn-reopen-log">🔄 Reopen</button>
                    <button class="btn-hard-del btn-delete-log">🗑️ Delete</button>
                </div>
            </td>
        `;

        tr.querySelector('.btn-reopen-log').onclick = async () => {
            try {
                await invoke('plugin:pm|update_status_log_status', { logId: log.id, status: 'active' });
                await renderTimeTable();
            } catch (err) {
                console.error("Reopen done log error:", err);
            }
        };

        tr.querySelector('.btn-delete-log').onclick = async () => {
            try {
                await invoke('plugin:pm|update_status_log_deleted', { logId: log.id, isDeleted: true });
                await renderTimeTable();
            } catch (err) {
                console.error("Delete done log error:", err);
            }
        };

        listBody.appendChild(tr);
    });
}

function openDoneLogDetailModal(log) {
    if (!log) return;

    document.getElementById('done-log-detail-tag').textContent = log.tag || '-';
    document.getElementById('done-log-detail-department').textContent = `[${log.department.toUpperCase()}]`;
    document.getElementById('done-log-detail-title').textContent = log.title || '-';
    document.getElementById('done-log-detail-content').textContent = log.text_content || '-';
    document.getElementById('done-log-detail-start-date').textContent = log.start_date || '-';
    document.getElementById('done-log-detail-due-date').textContent = log.due_date || '-';
    document.getElementById('done-log-detail-manager').textContent = log.manager || '-';
    document.getElementById('done-log-detail-time').textContent = formatLogTimestamp(log.timestamp) || '-';

    document.getElementById('modal-done-log-detail').classList.remove('hidden');
}

function renderDeletedLogsList() {
    const listBody = document.getElementById('deleted-logs-list-body');
    if (!listBody) return;
    listBody.innerHTML = '';

    const searchQuery = (document.getElementById('search-deleted-logs')?.value || '').toLowerCase();
    const selectedDept = document.getElementById('filter-deleted-dept')?.value || '';

    const filtered = currentStatusLogs.filter(log => {
        if (!log.is_deleted) return false;
        if (selectedDept && log.department !== selectedDept) return false;
        if (searchQuery) {
            const title = (log.title || '').toLowerCase();
            const content = (log.text_content || '').toLowerCase();
            const manager = (log.manager || '').toLowerCase();
            const tag = (log.tag || '').toLowerCase();
            if (!title.includes(searchQuery) && !content.includes(searchQuery) && !manager.includes(searchQuery) && !tag.includes(searchQuery)) {
                return false;
            }
        }
        return true;
    });

    if (filtered.length === 0) {
        listBody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--text-secondary);">No deleted status logs found.</td></tr>`;
        return;
    }

    filtered.forEach(log => {
        const tr = document.createElement('tr');

        tr.innerHTML = `
            <td style="font-family: monospace; font-size: 12px; color: var(--accent-color)">${log.tag || '-'}</td>
            <td style="color: #94a3b8; font-weight: 600;">[${log.department.toUpperCase()}]</td>
            <td style="font-weight: 600; color: #fff;">${log.title || '-'}</td>
            <td>${log.manager || '-'}</td>
            <td style="color: #888; font-size: 13px;">${formatLogTimestamp(log.timestamp)}</td>
            <td>
                <div class="action-buttons" style="justify-content: center;">
                    <button class="btn-restore btn-restore-log">🔄 Restore</button>
                    <button class="btn-hard-del btn-permanent-delete-log">🔥 Permanent</button>
                </div>
            </td>
        `;

        tr.querySelector('.btn-restore-log').onclick = async () => {
            try {
                await invoke('plugin:pm|update_status_log_deleted', { logId: log.id, isDeleted: false });
                await renderTimeTable();
            } catch (err) {
                console.error("Restore deleted log error:", err);
            }
        };

        tr.querySelector('.btn-permanent-delete-log').onclick = async () => {
            const confirmHard = await askConfirm("Are you sure you want to permanently delete this status log? This cannot be undone.", "Permanent Delete");
            if (!confirmHard) return;
            try {
                await invoke('plugin:pm|delete_status_log_permanent', { logId: log.id });
                await renderTimeTable();
            } catch (err) {
                console.error("Permanent delete log error:", err);
            }
        };

        listBody.appendChild(tr);
    });
}

function formatLogTimestamp(ts) {
    if (!ts) return '';
    try {
        const date = new Date(ts);
        if (isNaN(date.getTime())) return ts;
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
    } catch (e) {
        return ts;
    }
}

function formatLogTimeOnly(ts) {
    if (!ts) return '';
    try {
        const date = new Date(ts);
        if (isNaN(date.getTime())) return ts;
        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${hh}:${min}`;
    } catch (e) {
        return ts;
    }
}

function prepareStatusLogModalButtons(logId, logStatus) {
    const btnDone = document.getElementById('btn-done-log-modal');
    const btnDel = document.getElementById('btn-delete-log-modal');
    const btnSubmit = document.getElementById('btn-submit-log');

    if (!btnDone || !btnDel) return;

    if (!logId) {
        // New log
        btnDone.classList.add('hidden');
        btnDel.classList.add('hidden');
        if (btnSubmit) btnSubmit.textContent = 'Add Log';
    } else {
        // Existing log
        btnDone.classList.remove('hidden');
        btnDel.classList.remove('hidden');
        if (btnSubmit) btnSubmit.textContent = 'Update Log';

        // Configure Done button
        if (logStatus === 'done') {
            btnDone.textContent = 'Reopen';
            btnDone.className = 'btn btn-secondary-outline';
        } else {
            btnDone.textContent = 'Done';
            btnDone.className = 'btn btn-success-outline';
        }

        // Action when clicking Done button in modal
        btnDone.onclick = async () => {
            const nextStatus = logStatus === 'done' ? 'active' : 'done';
            try {
                await invoke('plugin:pm|update_status_log_status', { logId, status: nextStatus });
                
                // Close the detail drawer if it's currently showing this log
                const detailArea = document.getElementById('pm-timetable-log-detail');
                if (detailArea && timetableDetailLogId === logId) {
                    detailArea.style.display = 'none';
                    timetableDetailLogId = null;
                }
                
                document.getElementById('modal-log').classList.add('hidden');
                await renderTimeTable();
            } catch (err) {
                console.error("Done toggle in modal error:", err);
            }
        };

        // Action when clicking Delete button in modal
        btnDel.onclick = async () => {
            const confirmDel = await askConfirm("Are you sure you want to move this status log to Deleted Logs?", "Delete Status Log");
            if (!confirmDel) return;
            try {
                await invoke('plugin:pm|update_status_log_deleted', { logId, isDeleted: true });
                
                // Close the detail drawer if it's currently showing this log
                const detailArea = document.getElementById('pm-timetable-log-detail');
                if (detailArea && timetableDetailLogId === logId) {
                    detailArea.style.display = 'none';
                    timetableDetailLogId = null;
                }
                
                document.getElementById('modal-log').classList.add('hidden');
                await renderTimeTable();
            } catch (err) {
                console.error("Delete in modal error:", err);
            }
        };
    }
}

function renderStatusGrid(project) {
    const colListMech = document.getElementById('log-list-Mech');
    const colListControl = document.getElementById('log-list-Control');
    const colListElec = document.getElementById('log-list-Elec');
    const colListSales = document.getElementById('log-list-Sales');

    if (!colListMech || !colListControl || !colListElec || !colListSales) return;

    // Clear lists
    [colListMech, colListControl, colListElec, colListSales].forEach(el => el.innerHTML = '');

    const slot1 = project.dept1_name || 'Mech';
    const slot2 = project.dept2_name || 'Control';
    const slot3 = project.dept3_name || 'Elec';
    const slot4 = project.dept4_name || 'Sales';

    // Group logs by department slot
    currentStatusLogs.forEach(log => {
        if (log.is_deleted || log.status === 'done') return;

        let targetEl = null;
        if (log.department === slot1) targetEl = colListMech;
        else if (log.department === slot2) targetEl = colListControl;
        else if (log.department === slot3) targetEl = colListElec;
        else if (log.department === slot4) targetEl = colListSales;

        if (!targetEl) return;

        // Render premium log card
        const card = document.createElement('div');
        card.className = 'status-log-card';
        card.style.background = 'rgba(255, 255, 255, 0.03)';
        card.style.border = '1px solid var(--card-border)';
        card.style.borderRadius = '12px';
        card.style.padding = '12px';
        card.style.cursor = 'pointer';
        card.style.transition = 'all 0.2s ease';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '8px';

        card.onmouseenter = () => {
            card.style.background = 'rgba(255, 255, 255, 0.06)';
            card.style.borderColor = 'var(--accent-color)';
            card.style.transform = 'translateY(-2px)';
        };
        card.onmouseleave = () => {
            card.style.background = 'rgba(255, 255, 255, 0.03)';
            card.style.borderColor = 'var(--card-border)';
            card.style.transform = 'none';
        };

        card.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span class="tag-badge-mini" style="font-size: 10px; margin: 0; background: rgba(249, 115, 22, 0.15); color: var(--accent-color); border: 1px solid rgba(249, 115, 22, 0.3); padding: 2px 6px; border-radius: 4px;">${log.tag || 'LOG'}</span>
                <span style="font-size: 11px; color: #888; font-weight: 600;">${formatLogTimeOnly(log.timestamp)}</span>
            </div>
            
            <!-- Hover action buttons consistent with task manager -->
            <div class="status-log-actions">
                <button class="btn-status-log-done" title="Mark as Done">✓</button>
                <button class="btn-status-log-del" title="Delete Log">🗑️</button>
            </div>

            <div style="font-weight: 700; color: #fff; font-size: 13px; line-height: 1.4;">${log.title || 'Untitled Update'}</div>
            ${log.text_content ? `<div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis;">${log.text_content}</div>` : ''}
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; font-size: 11px; color: #aaa;">
                <span><strong>PIC:</strong> ${log.manager || '-'}</span>
                ${log.due_date ? `<span style="color: var(--accent-color); font-weight: 600;">📅 ${log.due_date}</span>` : ''}
            </div>
        `;

        // Action button listeners
        const btnDone = card.querySelector('.btn-status-log-done');
        const btnDel = card.querySelector('.btn-status-log-del');

        if (btnDone) {
            btnDone.onclick = async (e) => {
                e.stopPropagation(); // Prevent card detailed popup click
                try {
                    await invoke('plugin:pm|update_status_log_status', { logId: log.id, status: 'done' });
                    
                    // Close the detail drawer if it's currently showing this log
                    const detailArea = document.getElementById('pm-timetable-log-detail');
                    if (detailArea && timetableDetailLogId === log.id) {
                        detailArea.style.display = 'none';
                        timetableDetailLogId = null;
                    }
                    await renderTimeTable();
                } catch (err) {
                    console.error("Mark log as done error:", err);
                }
            };
        }

        if (btnDel) {
            btnDel.onclick = async (e) => {
                e.stopPropagation(); // Prevent card detailed popup click
                const confirmDel = await askConfirm("Are you sure you want to move this status log to Deleted Logs?", "Delete Status Log");
                if (!confirmDel) return;
                try {
                    await invoke('plugin:pm|update_status_log_deleted', { logId: log.id, isDeleted: true });
                    
                    // Close the detail drawer if it's currently showing this log
                    const detailArea = document.getElementById('pm-timetable-log-detail');
                    if (detailArea && timetableDetailLogId === log.id) {
                        detailArea.style.display = 'none';
                        timetableDetailLogId = null;
                    }
                    await renderTimeTable();
                } catch (err) {
                    console.error("Delete status log error:", err);
                }
            };
        }

        card.onclick = (e) => {
            e.preventDefault();
            // Pre-fill and show the log edit/details modal
            document.getElementById('form-log').reset();
            document.getElementById('log-project-id').value = log.project_id;
            document.getElementById('log-id').value = log.id;
            document.getElementById('log-department').value = log.department;
            document.getElementById('log-title').value = log.title || '';
            document.getElementById('log-content').value = log.text_content || '';
            document.getElementById('log-start-date').value = log.start_date || '';
            document.getElementById('log-due-date').value = log.due_date || '';
            document.getElementById('log-manager').value = log.manager || '';

            // Update modal title to show detailed status log
            document.getElementById('log-modal-title').textContent = 'Edit Status Log';
            prepareStatusLogModalButtons(log.id, log.status);
            document.getElementById('modal-log').classList.remove('hidden');
        };

        targetEl.appendChild(card);
    });
}

function generateProjectHtml(project, milestones, logs) {
    const sortedMilestones = [...milestones].filter(m => m.is_saved && (m.name || m.deadline)).sort((a,b) => new Date(a.deadline) - new Date(b.deadline));
    const activeLogs = [...logs].filter(l => !l.is_deleted && l.status !== 'done').sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    const doneLogs = [...logs].filter(l => !l.is_deleted && l.status === 'done').sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    const deletedLogs = [...logs].filter(l => l.is_deleted).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));

    const formatTimestamp = (tsString) => {
        if (!tsString) return '';
        try {
            const date = new Date(tsString);
            if (isNaN(date.getTime())) return tsString;
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            const h = String(date.getHours()).padStart(2, '0');
            const min = String(date.getMinutes()).padStart(2, '0');
            const s = String(date.getSeconds()).padStart(2, '0');
            return `${y}-${m}-${d} ${h}:${min}:${s}`;
        } catch (e) {
            return tsString;
        }
    };

    let milestoneRowsHtml = sortedMilestones.map((m, idx) => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 12px; color: #2563eb; font-weight: bold;">${(idx+1) < 10 ? '0' + (idx+1) : (idx+1)}</td>
            <td style="padding: 12px; color: #0f172a; font-weight: bold;">${m.name}</td>
            <td style="padding: 12px; color: #475569;">${m.deadline || 'YYYY-MM-DD'}</td>
            <td style="padding: 12px; color: ${m.is_done ? '#16a34a' : '#ea580c'}; font-weight: bold;">${m.is_done ? '✓ Done' : '⏳ Pending'}</td>
        </tr>
    `).join('');

    let logRowsHtml = activeLogs.map(l => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 12px; color: #2563eb; font-weight: bold;">[${l.department.toUpperCase()}]</td>
            <td style="padding: 12px; color: #0f172a; font-weight: bold;">${l.title}</td>
            <td style="padding: 12px; color: #334155; font-size: 13px;">${(l.text_content || '').replace(/\n/g, '<br>')}</td>
            <td style="padding: 12px; color: #475569; font-size: 12px;">${l.manager || '-'}</td>
            <td style="padding: 12px; color: #64748b; font-size: 12px; line-height: 1.4;">${(l.start_date || l.due_date) ? (l.start_date || '-') + '<br>~ ' + (l.due_date || '-') : '-'}</td>
        </tr>
    `).join('');

    let doneLogRowsHtml = doneLogs.map(l => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 12px; color: #475569; font-weight: bold;">[${l.department.toUpperCase()}]</td>
            <td style="padding: 12px; color: #0f172a; font-weight: bold;">${l.title}</td>
            <td style="padding: 12px; color: #334155; font-size: 13px;">${(l.text_content || '').replace(/\n/g, '<br>')}</td>
            <td style="padding: 12px; color: #475569; font-size: 12px;">${l.manager || '-'}</td>
            <td style="padding: 12px; color: #64748b; font-size: 12px; line-height: 1.4;">${(l.start_date || l.due_date) ? (l.start_date || '-') + '<br>~ ' + (l.due_date || '-') : '-'}</td>
            <td style="padding: 12px; color: #16a34a; font-weight: bold; font-size: 12px;">✓ Done</td>
        </tr>
    `).join('');

    let deletedLogRowsHtml = deletedLogs.map(l => `
        <tr style="border-bottom: 1px solid #e2e8f0; background: #fff8f8;">
            <td style="padding: 12px; color: #ef4444; font-weight: bold;">[${l.department.toUpperCase()}]</td>
            <td style="padding: 12px; color: #475569; font-weight: bold; text-decoration: line-through;">${l.title}</td>
            <td style="padding: 12px; color: #94a3b8; font-size: 13px; text-decoration: line-through;">${(l.text_content || '').replace(/\n/g, '<br>')}</td>
            <td style="padding: 12px; color: #94a3b8; font-size: 12px;">${l.manager || '-'}</td>
            <td style="padding: 12px; color: #64748b; font-size: 12px; line-height: 1.4; text-decoration: line-through;">${(l.start_date || l.due_date) ? (l.start_date || '-') + '<br>~ ' + (l.due_date || '-') : '-'}</td>
            <td style="padding: 12px; color: #ef4444; font-weight: bold; font-size: 12px;">🗑 Deleted</td>
        </tr>
    `).join('');

    const dept1Logs = activeLogs.filter(l => l.department.toLowerCase() === (project.dept1_name || 'Mech').toLowerCase());
    const dept2Logs = activeLogs.filter(l => l.department.toLowerCase() === (project.dept2_name || 'Control').toLowerCase());
    const dept3Logs = activeLogs.filter(l => l.department.toLowerCase() === (project.dept3_name || 'Elec').toLowerCase());
    const dept4Logs = activeLogs.filter(l => l.department.toLowerCase() === (project.dept4_name || 'Sales').toLowerCase());

    const renderDeptCards = (deptLogs, signatureColor) => {
        if (deptLogs.length === 0) {
            return `<div style="text-align: center; color: #94a3b8; font-size: 12px; padding: 20px; border: 1px dashed #e2e8f0; border-radius: 8px;">No active logs</div>`;
        }
        return deptLogs.map(l => `
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid ${signatureColor}; border-radius: 8px; padding: 12px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); page-break-inside: avoid; break-inside: avoid;">
                <div style="font-weight: 700; font-size: 13px; color: #0f172a; margin-bottom: 4px;">${l.title}</div>
                <div style="color: #475569; font-size: 12px; margin-bottom: 8px; line-height: 1.4; word-break: break-all;">${(l.text_content || '').replace(/\n/g, '<br>')}</div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 6px; flex-wrap: wrap; gap: 4px;">
                    <span>👤 ${l.manager || '-'}</span>
                    <span>📅 ${(l.start_date || l.due_date) ? (l.start_date || '-') + ' ~ ' + (l.due_date || '-') : '-'}</span>
                </div>
            </div>
        `).join('');
    };

    const deptColumnsHtml = `
        <div class="dept-kanban-print" style="display: flex; gap: 16px; margin-bottom: 35px; width: 100%; flex-wrap: nowrap;">
            <div style="flex: 1; min-width: 0; background: rgba(59, 130, 246, 0.015); border: 1px solid rgba(59, 130, 246, 0.15); border-radius: 12px; padding: 16px; display: flex; flex-direction: column;">
                <div style="text-align: center; font-weight: 800; font-size: 14px; color: #3b82f6; text-transform: uppercase; border-bottom: 2px solid rgba(59, 130, 246, 0.2); padding-bottom: 8px; margin-bottom: 12px;">${(project.dept1_name || 'Mech').toUpperCase()}</div>
                <div>${renderDeptCards(dept1Logs, '#3b82f6')}</div>
            </div>
            <div style="flex: 1; min-width: 0; background: rgba(245, 158, 11, 0.015); border: 1px solid rgba(245, 158, 11, 0.15); border-radius: 12px; padding: 16px; display: flex; flex-direction: column;">
                <div style="text-align: center; font-weight: 800; font-size: 14px; color: #f59e0b; text-transform: uppercase; border-bottom: 2px solid rgba(245, 158, 11, 0.2); padding-bottom: 8px; margin-bottom: 12px;">${(project.dept2_name || 'Control').toUpperCase()}</div>
                <div>${renderDeptCards(dept2Logs, '#f59e0b')}</div>
            </div>
            <div style="flex: 1; min-width: 0; background: rgba(16, 185, 129, 0.015); border: 1px solid rgba(16, 185, 129, 0.15); border-radius: 12px; padding: 16px; display: flex; flex-direction: column;">
                <div style="text-align: center; font-weight: 800; font-size: 14px; color: #10b981; text-transform: uppercase; border-bottom: 2px solid rgba(16, 185, 129, 0.2); padding-bottom: 8px; margin-bottom: 12px;">${(project.dept3_name || 'Elec').toUpperCase()}</div>
                <div>${renderDeptCards(dept3Logs, '#10b981')}</div>
            </div>
            <div style="flex: 1; min-width: 0; background: rgba(239, 68, 68, 0.015); border: 1px solid rgba(239, 68, 68, 0.15); border-radius: 12px; padding: 16px; display: flex; flex-direction: column;">
                <div style="text-align: center; font-weight: 800; font-size: 14px; color: #ef4444; text-transform: uppercase; border-bottom: 2px solid rgba(239, 68, 68, 0.2); padding-bottom: 8px; margin-bottom: 12px;">${(project.dept4_name || 'Sales').toUpperCase()}</div>
                <div>${renderDeptCards(dept4Logs, '#ef4444')}</div>
            </div>
        </div>
    `;

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Project Report - ${project.name}</title>
    <style>
        :root {
            --card-border: #e2e8f0;
            --accent-color: #2563eb;
            --text-primary: #0f172a;
            --text-secondary: #475569;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #f8fafc;
            color: #0f172a;
            padding: 40px;
            margin: 0;
            line-height: 1.6;
        }
        .container {
            max-width: 1000px;
            margin: 0 auto;
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.05);
        }
        .header {
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .project-title {
            font-size: 28px;
            font-weight: 800;
            color: #2563eb;
            margin: 0 0 10px 0;
            letter-spacing: -0.5px;
        }
        .meta-text {
            color: #475569;
            font-size: 14px;
        }
        h3 {
            color: #0f172a;
            border-left: 4px solid #2563eb;
            padding-left: 12px;
            margin-top: 40px;
            margin-bottom: 20px;
            font-size: 20px;
            font-weight: 700;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
            margin-bottom: 30px;
        }
        th {
            background: #f1f5f9;
            color: #475569;
            font-weight: bold;
            font-size: 12px;
            text-transform: uppercase;
            padding: 12px;
            border-bottom: 2px solid #e2e8f0;
        }

        /* Gantt Chart Exported Styles */
        .timetable-container {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 20px;
            position: relative;
            display: flex;
            flex-direction: column;
            margin-bottom: 40px;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            max-height: none !important;
            min-height: none !important;
            width: 100%;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
        }
        /* Custom scrollbar design */
        .timetable-container::-webkit-scrollbar {
            height: 10px;
        }
        .timetable-container::-webkit-scrollbar-track {
            background: #f1f5f9;
            border-radius: 10px;
        }
        .timetable-container::-webkit-scrollbar-thumb {
            background: #cbd5e1;
            border-radius: 10px;
            border: 2px solid transparent;
            background-clip: padding-box;
            transition: background 0.3s;
        }
        .timetable-container::-webkit-scrollbar-thumb:hover {
            background: #94a3b8;
            border: 2px solid transparent;
            background-clip: padding-box;
        }
        .timetable-container {
            scrollbar-width: thin;
            scrollbar-color: #cbd5e1 #f1f5f9;
        }
        .timetable-header, .timetable-body {
            min-width: 800px;
        }
        .timetable-header {
            display: flex;
            border-bottom: 1px solid #e2e8f0;
            background: #f8fafc;
            border-top-left-radius: 20px;
            border-top-right-radius: 20px;
        }
        .timetable-y-axis-header {
            width: 140px;
            flex-shrink: 0;
            border-right: 1px solid #e2e8f0;
            background: #f1f5f9;
            border-top-left-radius: 20px;
        }
        .timetable-x-axis {
            display: flex;
            flex: 1;
            position: relative;
        }
        .timetable-day-col {
            flex: 1;
            text-align: center;
            border-right: 1px solid #e2e8f0;
            padding: 12px 0;
            font-size: 12px;
            font-weight: 700;
            color: #475569;
            min-width: 80px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .timetable-day-col.today {
            background: rgba(37, 99, 235, 0.05);
            color: #2563eb;
            font-weight: bold;
        }
        .timetable-body {
            display: flex;
            flex-direction: column;
            flex: 1;
        }
        .timetable-track {
            display: flex;
            min-height: 120px;
            border-bottom: 1px solid #e2e8f0;
            position: relative;
            z-index: 2;
        }
        .timetable-track:last-child {
            border-bottom-left-radius: 20px;
            border-bottom-right-radius: 20px;
        }
        .timetable-track-label {
            width: 140px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: flex-start;
            padding: 0 16px;
            font-size: 13px;
            font-weight: 800;
            border-right: 1px solid #e2e8f0;
            background: #f8fafc;
            color: #0f172a;
            position: relative;
            z-index: 8;
            letter-spacing: 0.5px;
        }
        .timetable-track-content {
            flex: 1;
            position: relative;
            background-image: linear-gradient(to right, #f1f5f9 1px, transparent 1px);
        }
        .timetable-log-marker {
            position: absolute;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            transform: translate(-50%, -50%);
            top: 50%;
            border: 1.5px solid rgba(0, 0, 0, 0.15);
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
            z-index: 20;
            cursor: pointer;
            transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s;
        }
        .timetable-log-marker:hover {
            transform: translate(-50%, -50%) scale(1.4);
            z-index: 30 !important;
            box-shadow: 0 0 8px rgba(0, 0, 0, 0.3);
        }
        .timetable-log-range {
            position: absolute;
            height: 16px;
            border-radius: 8px;
            transform: translateY(-50%);
            border: 1px solid rgba(0, 0, 0, 0.1);
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
            z-index: 19;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0 8px;
            font-size: 9px;
            font-weight: bold;
            color: white;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: pointer;
            transition: height 0.2s ease, box-shadow 0.2s, background 0.2s;
        }
        .timetable-log-range:hover {
            height: 22px;
            z-index: 30 !important;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
        }
        .timetable-log-marker.todo,
        .timetable-log-range.todo {
            background: #3b82f6 !important;
            border-color: #2563eb;
        }
        .timetable-log-marker.doing,
        .timetable-log-range.doing {
            background: #f59e0b !important;
            border-color: #d97706;
        }
        .timetable-log-marker.done,
        .timetable-log-range.done {
            background: #10b981 !important;
            border-color: #059669;
        }
        .timetable-log-marker.note,
        .timetable-log-range.note {
            background: #94a3b8 !important;
            border-color: #64748b;
        }
        .timetable-log-marker.review,
        .timetable-log-range.review {
            background: #8b5cf6 !important;
            border-color: #7c3aed;
        }
        .timetable-log-marker.deleted,
        .timetable-log-range.deleted {
            background: #e2e8f0 !important;
            border-color: #cbd5e1 !important;
            color: #64748b !important;
            opacity: 0.55 !important;
            border-style: dashed;
        }
        .milestone-line {
            position: absolute;
            width: 0;
            border-left: 2px dashed #f87171;
            z-index: 1;
            pointer-events: none;
            height: 100%;
            top: 0;
        }
        .milestone-line.is-done {
            border-left: 2px dashed #34d399;
        }
        .milestone-line-label {
            position: absolute;
            transform: translateX(-50%);
            background: #ef4444;
            color: white;
            font-size: 10px;
            font-weight: 800;
            padding: 3px 8px;
            border-radius: 6px;
            white-space: nowrap;
            box-shadow: 0 2px 6px rgba(239, 68, 68, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.2);
            z-index: 26;
            pointer-events: auto;
            cursor: pointer;
        }
        .milestone-line-label.is-done {
            background: #10b981;
            box-shadow: 0 2px 6px rgba(16, 185, 129, 0.2);
            border-color: rgba(255, 255, 255, 0.2);
        }
        .milestone-line.pending-saved {
            border-left: 2px dashed #f87171 !important;
        }
        .milestone-line-label.pending-saved {
            background: #fee2e2 !important;
            border: 1px solid #f87171 !important;
            color: #ef4444 !important;
            box-shadow: 0 2px 6px rgba(239, 68, 68, 0.05) !important;
        }
        .timetable-track.milestone-track-row {
            background: #faf5ff !important;
            border-top: 1px dashed #e9d5ff !important;
            border-bottom: 2px solid #d8b4fe !important;
        }
        .timetable-track.milestone-track-row:hover {
            background: #f3e8ff !important;
        }
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: bold;
            color: #fff;
        }
        .badge.todo { background: #3b82f6; }
        .badge.doing { background: #f59e0b; }
        .badge.done { background: #10b981; }
        .badge.review { background: #8b5cf6; }
        .badge.note { background: #94a3b8; }

        @media print {
            @page {
                size: A4 landscape;
                margin: 10mm 12mm;
            }
            .timetable-controls, #global-timetable-tooltip, #pm-timetable-log-detail {
                display: none !important;
            }
            body {
                background: #fff !important;
                color: #000 !important;
                padding: 0 !important;
                margin: 0 !important;
                font-size: 12px !important;
            }
            .container {
                max-width: 100% !important;
                width: 100% !important;
                border: none !important;
                box-shadow: none !important;
                padding: 0 !important;
                margin: 0 !important;
                background: transparent !important;
            }
            h3, .project-title {
                color: #000 !important;
            }
            h3 {
                margin-top: 25px !important;
                margin-bottom: 12px !important;
                page-break-after: avoid;
                break-after: avoid;
            }
            .meta-text {
                color: #555 !important;
            }
            .timetable-container {
                border: 1px solid #ccc !important;
                background: transparent !important;
                width: 100% !important;
                min-width: unset !important;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .timetable-header, .timetable-body {
                min-width: unset !important;
                width: 100% !important;
            }
            .timetable-header {
                background: #eee !important;
                border-bottom: 1px solid #ccc !important;
            }
            .timetable-track-label {
                background: #f9f9f9 !important;
                color: #333 !important;
                border-right: 1px solid #ccc !important;
            }
            .timetable-day-col {
                color: #333 !important;
                border-right: 1px solid #eee !important;
            }
            .timetable-day-col.today {
                background: #eee !important;
            }
            .timetable-track {
                page-break-inside: avoid;
                break-inside: avoid;
            }
            table {
                width: 100% !important;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            table th {
                background: #eee !important;
                color: #000 !important;
                border-bottom: 1px solid #ccc !important;
            }
            tr {
                border-bottom: 1px solid #eee !important;
                page-break-inside: avoid;
                break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    <div id="global-timetable-tooltip" style="display: none; position: fixed; background: #ffffff; border: 1px solid #e2e8f0; padding: 12px; border-radius: 12px; font-size: 12px; color: #0f172a; z-index: 9999; pointer-events: none; box-shadow: 0 10px 25px rgba(0,0,0,0.15); max-width: 320px; line-height: 1.5; backdrop-filter: blur(8px);"></div>

    <div class="container">
        <div class="header">
            <h1 class="project-title">${project.name}</h1>
            <div class="meta-text">
                Client: <strong>${project.client || '-'}</strong> | 
                Manager: <strong>${project.manager || '-'}</strong> | 
                Start Date: <strong>${project.start_date || '-'}</strong> | 
                Generated: <strong>${new Date().toLocaleString()}</strong>
            </div>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-top: 20px; box-shadow: inset 0 1px 2px rgba(0,0,0,0.01);">
                <h4 style="margin: 0 0 8px 0; color: #0f172a; font-size: 15px; font-weight: 700; border-left: 3px solid #2563eb; padding-left: 8px;">Project Overview</h4>
                <p style="margin: 0; color: #334155; font-size: 13.5px; white-space: pre-line; line-height: 1.6;">${project.description || 'No description available.'}</p>
            </div>
        </div>

        <h3>Project Timetable (Gantt Chart)</h3>
        
        <!-- Interactive Controls -->
        <div class="timetable-controls" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 16px;">
            <div style="display: flex; align-items: center; gap: 12px;">
                <button id="pm-timetable-prev" style="padding: 6px 12px; background: #ffffff; border: 1px solid #cbd5e1; color: #0f172a; border-radius: 8px; cursor: pointer; transition: background 0.2s;">&lt;</button>
                <div id="pm-timetable-current-range" style="font-weight: 700; font-size: 14px; color: #2563eb; min-width: 150px; text-align: center; user-select: none;"></div>
                <button id="pm-timetable-next" style="padding: 6px 12px; background: #ffffff; border: 1px solid #cbd5e1; color: #0f172a; border-radius: 8px; cursor: pointer; transition: background 0.2s;">&gt;</button>
            </div>

            <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" id="pm-timetable-show-deleted" style="width: 16px; height: 16px; cursor: pointer;">
                    <label for="pm-timetable-show-deleted" style="font-size: 13px; color: #475569; cursor: pointer; user-select: none;">Show Deleted LOGs</label>
                </div>
                
                <select id="pm-timetable-scale" style="width: 110px; height: 36px; padding: 6px 12px; font-size: 13px; background: #ffffff; color: #0f172a; border: 1px solid #cbd5e1; border-radius: 8px; cursor: pointer;">
                    <option value="weekly">Weekly</option>
                    <option value="monthly" selected>Monthly</option>
                </select>
            </div>
        </div>

        <div id="pm-timetable-container" class="timetable-container">
            <!-- Rendered dynamically -->
        </div>

        <!-- Detail Panel -->
        <div id="pm-timetable-log-detail" style="display: none; flex-direction: column; gap: 12px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; border-radius: 16px; margin-bottom: 40px;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">
                <div id="pm-timetable-detail-header" style="font-weight: 700; color: #2563eb; font-size: 14px;">[DEPARTMENT] Details</div>
                <div>
                    <button style="font-size: 12px; padding: 4px 10px; background: #ffffff; border: 1px solid #cbd5e1; color: #0f172a; border-radius: 6px; cursor: pointer;" onclick="document.getElementById('pm-timetable-log-detail').style.display='none'">Close</button>
                </div>
            </div>
            <div id="pm-timetable-detail-content" style="white-space: pre-wrap; font-size: 13px; color: #475569; line-height: 1.6;"></div>
        </div>

        <h3>Departmental Status Board</h3>
        ${deptColumnsHtml}

        <h3>Project Milestones</h3>
        <table>
            <thead>
                <tr>
                    <th style="width: 80px;">Slot</th>
                    <th>Milestone Name</th>
                    <th style="width: 150px;">Deadline</th>
                    <th style="width: 120px;">Status</th>
                </tr>
            </thead>
            <tbody>
                ${milestoneRowsHtml || '<tr><td colspan="4" style="padding: 20px; text-align: center; color: #475569;">No milestones defined.</td></tr>'}
            </tbody>
        </table>

        <h3>Active Status Logs</h3>
        <table>
            <thead>
                <tr>
                    <th style="width: 110px;">Slot</th>
                    <th style="width: 160px;">Title</th>
                    <th>Details</th>
                    <th style="width: 90px;">PIC</th>
                    <th style="width: 110px;">Duration</th>
                </tr>
            </thead>
            <tbody>
                ${logRowsHtml || '<tr><td colspan="5" style="padding: 20px; text-align: center; color: #475569;">No status logs recorded yet.</td></tr>'}
            </tbody>
        </table>

        <h3>Done Status Logs</h3>
        <table>
            <thead>
                <tr>
                    <th style="width: 120px;">Slot</th>
                    <th style="width: 160px;">Title</th>
                    <th>Details</th>
                    <th style="width: 90px;">PIC</th>
                    <th style="width: 110px;">Duration</th>
                    <th style="width: 110px;">Status</th>
                </tr>
            </thead>
            <tbody>
                ${doneLogRowsHtml || '<tr><td colspan="6" style="padding: 20px; text-align: center; color: #475569;">No done logs recorded yet.</td></tr>'}
            </tbody>
        </table>

        <h3>Deleted Status Logs</h3>
        <table>
            <thead>
                <tr>
                    <th style="width: 120px;">Slot</th>
                    <th style="width: 160px;">Title</th>
                    <th>Details</th>
                    <th style="width: 90px;">PIC</th>
                    <th style="width: 110px;">Duration</th>
                    <th style="width: 110px;">Status</th>
                </tr>
            </thead>
            <tbody>
                ${deletedLogRowsHtml || '<tr><td colspan="6" style="padding: 20px; text-align: center; color: #475569;">No deleted logs recorded yet.</td></tr>'}
            </tbody>
        </table>
    </div>

    <!-- Standalone Interactive Gantt Chart Engine -->
    <script>
        const project = ${JSON.stringify(project)};
        const milestones = ${JSON.stringify(milestones)};
        const logs = ${JSON.stringify(logs)};
        let timetableBaseDate = new Date();

        function formatTimestamp(tsString) {
            if (!tsString) return '';
            try {
                const date = new Date(tsString);
                if (isNaN(date.getTime())) return tsString;
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                const h = String(date.getHours()).padStart(2, '0');
                const min = String(date.getMinutes()).padStart(2, '0');
                const s = String(date.getSeconds()).padStart(2, '0');
                return \`\${y}-\${m}-\${d} \${h}:\${min}:\${s}\`;
            } catch (e) {
                return tsString;
            }
        }

        function getLocalDateString(date) {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return \`\${y}-\${m}-\${d}\`;
        }

        function calculatePct(date, startDate, scale) {
            if (scale === 'weekly') {
                const diffTime = date.getTime() - startDate.getTime();
                const diffDays = diffTime / (1000 * 3600 * 24);
                if (diffDays >= -1 && diffDays <= 8) {
                    return (diffDays / 7) * 100;
                }
            } else {
                const monthDiff = (date.getFullYear() - startDate.getFullYear()) * 12 + (date.getMonth() - startDate.getMonth());
                if (monthDiff >= -1 && monthDiff <= 13) {
                    const day = date.getDate();
                    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
                    return ((monthDiff + (day / daysInMonth)) / 12) * 100;
                }
            }
            return -1;
        }

        function renderTimeTable() {
            const container = document.getElementById('pm-timetable-container');
            const scale = document.getElementById('pm-timetable-scale').value;
            const showDeleted = document.getElementById('pm-timetable-show-deleted').checked;

            container.innerHTML = '';

            const now = new Date();
            let startDate, days;

            if (scale === 'weekly') {
                startDate = new Date(timetableBaseDate);
                startDate.setDate(startDate.getDate() - 3);
                startDate.setHours(0, 0, 0, 0);
                days = 7;
            } else {
                startDate = new Date(timetableBaseDate.getFullYear(), timetableBaseDate.getMonth() - 5, 1);
                days = 12;
            }

            container.style.setProperty('--day-count', days);

            // Update current range header label
            const rangeLabel = document.getElementById('pm-timetable-current-range');
            if (rangeLabel) {
                if (scale === 'weekly') {
                    const endDate = new Date(startDate);
                    endDate.setDate(startDate.getDate() + 6);
                    rangeLabel.textContent = \`\${getLocalDateString(startDate)} ~ \${getLocalDateString(endDate)}\`;
                } else {
                    const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 11, 1);
                    rangeLabel.textContent = \`\${startDate.getFullYear()}.\${String(startDate.getMonth() + 1).padStart(2, '0')} ~ \${endDate.getFullYear()}.\${String(endDate.getMonth() + 1).padStart(2, '0')}\`;
                }
            }

            // Header layout
            const header = document.createElement('div');
            header.className = 'timetable-header';

            const yHeader = document.createElement('div');
            yHeader.className = 'timetable-y-axis-header';
            header.appendChild(yHeader);

            const xAxis = document.createElement('div');
            xAxis.className = 'timetable-x-axis';
            xAxis.style.position = 'relative';



            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

            for (let i = 0; i < days; i++) {
                const dayCol = document.createElement('div');
                dayCol.className = 'timetable-day-col';

                if (scale === 'weekly') {
                    const d = new Date(startDate);
                    d.setDate(startDate.getDate() + i);
                    if (d.toDateString() === now.toDateString()) dayCol.classList.add('today');
                    const m = d.getMonth() + 1;
                    const day = d.getDate();
                    const dayName = dayNames[d.getDay()];
                    dayCol.textContent = \`\${m}/\${day} (\${dayName})\`;

                    const dStr = getLocalDateString(d);
                    const dayMilestones = milestones.filter(ms => ms.is_saved && ms.deadline === dStr);
                    if (dayMilestones.length > 0) {
                        dayCol.classList.add('milestone-highlight');
                        if (dayMilestones.every(ms => ms.is_done)) {
                            dayCol.classList.add('is-done');
                        }
                    }
                } else {
                    const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
                    const y = d.getFullYear();
                    const m = d.getMonth();
                    dayCol.textContent = \`\${y} \${monthNames[m]}\`;
                    if (y === now.getFullYear() && m === now.getMonth()) dayCol.classList.add('today');
                }
                xAxis.appendChild(dayCol);
            }
            header.appendChild(xAxis);
            container.appendChild(header);

            const body = document.createElement('div');
            body.className = 'timetable-body';
            body.style.position = 'relative';

            const msLinesContainer = document.createElement('div');
            msLinesContainer.className = 'milestone-lines-container';
            msLinesContainer.style.position = 'absolute';
            msLinesContainer.style.left = '140px';
            msLinesContainer.style.right = '0';
            msLinesContainer.style.top = '0';
            msLinesContainer.style.bottom = '0';
            msLinesContainer.style.pointerEvents = 'none';
            msLinesContainer.style.zIndex = '1';
            body.appendChild(msLinesContainer);

            if (milestones.length > 0) {
                const sorted = [...milestones].filter(m => m.is_saved && m.deadline).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
                sorted.forEach((m) => {
                    const mDate = new Date(m.deadline);
                    const pct = calculatePct(mDate, startDate, scale);
                    if (pct >= 0 && pct <= 100) {
                        const line = document.createElement('div');
                        line.className = 'milestone-line';
                        if (m.is_done) line.classList.add('is-done');
                        else if (m.deadline) line.classList.add('pending-saved');
                        line.style.left = pct + '%';
                        line.style.height = '100%';
                        msLinesContainer.appendChild(line);
                    }
                });
            }

            const depts = [
                { key: 'Slot 1', name: project.dept1_name || 'Mech', color: '#2563eb' },
                { key: 'Slot 2', name: project.dept2_name || 'Control', color: '#ea580c' },
                { key: 'Slot 3', name: project.dept3_name || 'Elec', color: '#16a34a' },
                { key: 'Slot 4', name: project.dept4_name || 'Sales', color: '#dc2626' },
                { key: 'Milestone', name: 'Mile stone', color: '#7c3aed' }
            ];

            depts.forEach(dept => {
                const track = document.createElement('div');
                track.className = 'timetable-track';
                if (dept.key === 'Milestone') track.classList.add('milestone-track-row');

                const label = document.createElement('div');
                label.className = 'timetable-track-label';
                label.textContent = \`[ \${dept.name.toUpperCase()} ]\`;
                label.style.color = dept.color;
                track.appendChild(label);

                const content = document.createElement('div');
                content.className = 'timetable-track-content';
                content.style.backgroundSize = \`\${(100 / days)}% 100%\`;

                if (dept.key === 'Milestone') {
                    const msLabelsContainer = document.createElement('div');
                    msLabelsContainer.className = 'milestone-labels-container';
                    msLabelsContainer.style.position = 'absolute';
                    msLabelsContainer.style.left = '0';
                    msLabelsContainer.style.right = '0';
                    msLabelsContainer.style.top = '0';
                    msLabelsContainer.style.bottom = '0';
                    msLabelsContainer.style.pointerEvents = 'none';
                    msLabelsContainer.style.zIndex = '26';
                    content.appendChild(msLabelsContainer);

                    if (milestones.length > 0) {
                        const sorted = [...milestones].filter(m => m.is_saved && m.deadline).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
                        sorted.forEach((m, idx) => {
                            const mDate = new Date(m.deadline);
                            const pct = calculatePct(mDate, startDate, scale);
                            if (pct >= 0 && pct <= 100) {
                                const label = document.createElement('div');
                                label.className = 'milestone-line-label';
                                if (m.is_done) label.classList.add('is-done');
                                else if (m.deadline) label.classList.add('pending-saved');
                                label.textContent = '📌 ' + m.name + ' (' + m.deadline.substring(5) + ')';
                                label.style.left = pct + '%';
                                label.style.bottom = (12 + (idx % 3) * 26) + 'px';
                                label.style.top = 'auto';
                                msLabelsContainer.appendChild(label);
                            }
                        });
                    }
                } else {
                    let deptLogs = logs.filter(l => l.department === dept.name);
                if (!showDeleted) {
                    deptLogs = deptLogs.filter(l => !l.is_deleted);
                }

                deptLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

                const placedMarkers = [];

                deptLogs.forEach(log => {
                    let leftPct = -1;
                    let widthPct = -1;

                    const sDateStr = log.start_date;
                    const dDateStr = log.due_date;
                    const logDate = new Date(log.timestamp);

                    if (sDateStr && dDateStr && sDateStr !== dDateStr) {
                        const s = new Date(sDateStr);
                        const d = new Date(dDateStr);
                        d.setHours(23, 59, 59, 999);

                        leftPct = calculatePct(s, startDate, scale);
                        const rightPct = calculatePct(d, startDate, scale);
                        if (leftPct !== -1 && rightPct !== -1) {
                            widthPct = rightPct - leftPct;
                            if (widthPct < 1.0) widthPct = 1.0;
                        } else if (leftPct !== -1) {
                            widthPct = 100 - leftPct;
                        } else if (rightPct !== -1) {
                            widthPct = rightPct;
                            leftPct = 0;
                        }
                    } else {
                        // Point display (uses due_date/deadline if present, else start_date, else timestamp)
                        const targetDate = dDateStr ? new Date(dDateStr) : (sDateStr ? new Date(sDateStr) : logDate);
                        leftPct = calculatePct(targetDate, startDate, scale);
                    }

                    if (leftPct !== -1) {
                        let lane = 0;
                        const minDistance = 2.5;
                        const spanEnd = widthPct !== -1 ? leftPct + widthPct : leftPct;

                        while (placedMarkers.some(m => {
                            const mEnd = m.width !== -1 ? m.left + m.width : m.left;
                            const overlap = Math.max(m.left, leftPct) < Math.min(mEnd, spanEnd);
                            const touch = Math.abs(m.left - leftPct) < minDistance;
                            return (overlap || touch) && m.lane === lane;
                        })) {
                            lane++;
                        }

                        placedMarkers.push({ left: leftPct, width: widthPct, lane: lane });

                        const laneOffsets = [0, -18, 18, -26, 26];
                        const finalOffset = laneOffsets[lane % laneOffsets.length];

                        const marker = document.createElement('div');
                        marker.className = widthPct !== -1 ? 'timetable-log-range' : 'timetable-log-marker';
                        
                        if (log.status) marker.classList.add(log.status);
                        else marker.classList.add('doing');

                        if (!log.is_deleted) {
                            marker.style.setProperty('background', dept.color, 'important');
                            marker.style.setProperty('border-color', dept.color, 'important');
                        }

                        marker.style.left = leftPct + '%';
                        if (widthPct !== -1) {
                            marker.style.width = widthPct + '%';
                            marker.textContent = log.title;
                        }
                        marker.style.top = (60 + finalOffset) + 'px';

                        const tooltipEl = document.getElementById('global-timetable-tooltip');
                        let logText = log.text_content || '[ No content ]';

                        const formatDateToMD = (dateStr) => {
                            if (!dateStr) return '-';
                            const parts = dateStr.split('-');
                            if (parts.length >= 3) {
                                return parts[1] + '/' + parts[2];
                            }
                            return dateStr;
                        };

                        let dateRangeStr = '';
                        if (log.start_date || log.due_date) {
                            const sMD = formatDateToMD(log.start_date);
                            const dMD = formatDateToMD(log.due_date);
                            dateRangeStr = '[' + sMD + ' ~ ' + dMD + '] ';
                        }

                        let tooltipContent = '<strong>' + dateRangeStr + log.title + '</strong><br>' + logText.replace(/\\n/g, '<br>');

                        if (log.is_deleted) {
                            marker.classList.add('deleted');
                            tooltipContent = \`<span style="text-decoration: line-through; opacity: 0.6;">\${tooltipContent}</span>\`;
                        } else if (log.status === 'done') {
                            tooltipContent = \`<span style="color: #10b981; font-weight:bold;">[DONE]</span><br>\${tooltipContent}\`;
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
                            const detailPanel = document.getElementById('pm-timetable-log-detail');
                            const detailHeader = document.getElementById('pm-timetable-detail-header');
                            const detailContent = document.getElementById('pm-timetable-detail-content');

                            detailHeader.textContent = \`[\${log.department.toUpperCase()}] \${log.title}\`;
                            detailContent.innerHTML = \`
                                <strong>Manager/PIC:</strong> \${log.manager || '-'}<br>
                                <strong>Time:</strong> \${formatTimestamp(log.timestamp)}<br>
                                <strong>Duration:</strong> \${log.start_date || '-'} ~ \${log.due_date || '-'}<br>
                                <strong>Status:</strong> <span class="badge \${log.status}">\${(log.status || 'doing').toUpperCase()}</span><br>
                                <hr style="border-color: rgba(255,255,255,0.05); margin: 12px 0;">
                                \${logText.replace(/\\n/g, '<br>')}
                            \`;
                            detailPanel.style.display = 'flex';
                        };

                        content.appendChild(marker);
                    }
                });

                }

                track.appendChild(content);
                body.appendChild(track);
            });

            container.appendChild(body);
        }

        window.addEventListener('DOMContentLoaded', () => {
            const scaleSelect = document.getElementById('pm-timetable-scale');
            const showDeletedCheckbox = document.getElementById('pm-timetable-show-deleted');
            const prevBtn = document.getElementById('pm-timetable-prev');
            const nextBtn = document.getElementById('pm-timetable-next');

            scaleSelect.onchange = () => renderTimeTable();
            showDeletedCheckbox.onchange = () => renderTimeTable();

            prevBtn.onclick = () => {
                const scale = scaleSelect.value;
                if (scale === 'weekly') {
                    timetableBaseDate.setDate(timetableBaseDate.getDate() - 7);
                } else {
                    timetableBaseDate.setMonth(timetableBaseDate.getMonth() - 12);
                }
                renderTimeTable();
            };

            nextBtn.onclick = () => {
                const scale = scaleSelect.value;
                if (scale === 'weekly') {
                    timetableBaseDate.setDate(timetableBaseDate.getDate() + 7);
                } else {
                    timetableBaseDate.setMonth(timetableBaseDate.getMonth() + 12);
                }
                renderTimeTable();
            };

            renderTimeTable();
        });
    </script>
</body>
</html>`;
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

                        // Check limits before applying the drop!
                        const dummyTask = { ...currentTasks[taskIndex], status: status };
                        if (!checkTaskLimits(dummyTask, false)) {
                            document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drag-over'));
                            draggingTaskId = null;
                            return;
                        }

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

function checkTaskLimits(task, isNew) {
    // Exclude deleted or completed tasks from limit checks entirely
    if (task.is_deleted || task.status === 'Done' || task.status === 'Review') {
        return true;
    }

    // Filter current tasks to get only active pending tasks (excluding deleted & completed ones)
    const activeTasks = currentTasks.filter(t => 
        !t.is_deleted && 
        t.status !== 'Done' && 
        t.status !== 'Review'
    );

    // 1. Total Limit: Max 200
    if (isNew && activeTasks.length >= 200) {
        alert("Total active tasks limit exceeded: You can only have a maximum of 200 active tasks in total.");
        return false;
    }

    // 2. Status Limit: Max 50
    const status = task.status || 'Note';
    const sameStatusCount = activeTasks.filter(t => t.status === status && t.id !== task.id).length;
    if (sameStatusCount >= 50) {
        alert(`Task status limit exceeded: Status '${status}' can only have a maximum of 50 tasks.`);
        return false;
    }

    // 3. Same-Date Limit: Max 20
    if (task.start_date) {
        const sameDateCount = activeTasks.filter(t => t.start_date === task.start_date && t.id !== task.id).length;
        if (sameDateCount >= 20) {
            alert(`Task date limit exceeded: Selected start date (${task.start_date}) can only have a maximum of 20 tasks.`);
            return false;
        }
    }

    return true;
}
