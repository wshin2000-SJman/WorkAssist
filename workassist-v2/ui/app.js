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
let currentCategories = [];
let currentProjects = [];
let currentProjectsWithLogs = [];
let selectedWorkloadProjectId = null;
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
                    const res = await invoke('plugin:pm|import_project_db', { 
                        ownerId: currentUser.id, 
                        filePath: file, 
                        overwrite: false 
                    });
                    
                    if (res && res.status === 'duplicate') {
                        const confirmOverwrite = await window.__TAURI__.dialog.ask(
                            `프로젝트 태그 '${res.tag}' (${res.projectName || '이름 없음'})이(가) 이미 존재합니다.\n기존 데이터를 새로 가져오는 프로젝트의 데이터로 덮어쓰시겠습니까?`,
                            { title: '프로젝트 가져오기 중복 감지', type: 'warning' }
                        );
                        
                        if (confirmOverwrite) {
                            const res2 = await invoke('plugin:pm|import_project_db', { 
                                ownerId: currentUser.id, 
                                filePath: file, 
                                overwrite: true 
                            });
                            alert(res2.message);
                            refreshProjects();
                        }
                    } else {
                        alert(res.message);
                        refreshProjects();
                    }
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
    setupRag();
    setupHistory();
    setupDbManager();
    setupOrderDb();

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
            'pm': { nav: 'nav-pm', stat: 'stat-projects' },
            'rag': { nav: 'nav-rag', stat: null }
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
                alert('아이디와 비밀번호를 모두 입력해 주세요.');
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
                    alert('잘못된 아이디 또는 비밀번호입니다.');
                }
            } catch (err) {
                console.error("Login Error:", err);
                alert('로그인에 실패했습니다: ' + err);
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
            if (!id) return alert('아이디를 입력해 주세요.');
            try {
                const hint = await invoke('plugin:auth|get_password_hint', { username: id });
                const display = document.getElementById('hint-display');
                const text = document.getElementById('hint-text');
                if (hint) {
                    text.textContent = hint;
                    display.classList.remove('hidden');
                } else {
                    alert('해당 사용자의 힌트를 찾을 수 없습니다.');
                }
            } catch (err) { alert('힌트를 가져오는 중 오류가 발생했습니다.'); }
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
                alert('계정이 성공적으로 생성되었습니다!');
                modalSignup.classList.add('hidden');
            } catch (err) { 
                console.error("Signup Error:", err);
                alert('계정 생성에 실패했습니다: ' + err); 
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
                    alert('비밀번호가 변경되었습니다!');
                    modalChangePw.classList.add('hidden');
                } else {
                    alert('잘못된 아이디 또는 현재 비밀번호입니다.');
                }
            } catch (err) { 
                console.error("Change PW Error:", err);
                alert('비밀번호 변경에 실패했습니다: ' + err); 
            }
        };
    }

    // Logout
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.onclick = async () => {
            if (await askConfirm('로그아웃 하시겠습니까?')) {
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
    if (cancelBtn) cancelBtn.textContent = '취소';

    document.getElementById('task-id').value = '';
    const tagDisplay = document.getElementById('task-tag-display');
    if (tagDisplay) {
        tagDisplay.textContent = '';
        tagDisplay.classList.add('hidden');
    }
    const modalTitle = document.getElementById('task-modal-title');
    if (modalTitle) modalTitle.textContent = '새 업무 등록';
    
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
    if (cancelBtn) cancelBtn.textContent = '취소';

    document.getElementById('meeting-id').value = '';
    document.getElementById('meeting-tag').value = '';
    const tagDisplay = document.getElementById('meeting-tag-display');
    if (tagDisplay) {
        tagDisplay.textContent = '';
        tagDisplay.classList.add('hidden');
    }
    const modalTitle = document.getElementById('meeting-modal-title');
    if (modalTitle) modalTitle.textContent = '회의록 등록';

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
    document.getElementById('meeting-category').value = m.category_id || '';
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

    document.getElementById('meeting-modal-title').textContent = readOnly ? '회의록 상세 정보 (읽기 전용)' : '회의록 수정';
    
    const submitBtn = document.querySelector('#modal-meeting button[type="submit"]');
    if (submitBtn) {
        submitBtn.style.display = readOnly ? 'none' : 'block';
    }

    const cancelBtn = document.getElementById('btn-cancel-meeting');
    if (cancelBtn) {
        cancelBtn.textContent = readOnly ? '닫기' : '취소';
    }

    // Handle read-only state for inputs
    const formMeeting = document.getElementById('form-meeting');
    const inputs = formMeeting.querySelectorAll('input, textarea, select');
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
                if (await askConfirm('이 회의록을 휴지통으로 이동하시겠습니까?')) {
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
    if (titleEl) titleEl.textContent = '새 프로젝트 등록';

    const submitBtn = document.querySelector('#modal-project button[type="submit"]');
    if (submitBtn) {
        submitBtn.style.display = 'block';
    }

    const cancelBtn = document.getElementById('btn-cancel-project');
    if (cancelBtn) {
        cancelBtn.textContent = '취소';
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

async function initAndShow() {
    init();
    // Show the window after UI is fully initialized.
    // The window starts hidden (visible: false in tauri.conf.json) to prevent
    // layout flash/broken UI in production builds.
    try {
        if (window.__TAURI__) {
            // Small delay to ensure CSS paint + fonts are ready
            await new Promise(resolve => setTimeout(resolve, 150));
            const currentWindow = window.__TAURI__.window;
            if (currentWindow && currentWindow.getCurrentWindow) {
                await currentWindow.getCurrentWindow().show();
            } else if (currentWindow && currentWindow.appWindow) {
                await currentWindow.appWindow.show();
            }
            console.log("Window shown after UI init.");
        }
    } catch (e) {
        console.warn("Could not show window via Tauri API:", e);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAndShow);
} else {
    initAndShow();
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
                document.getElementById('detail-project-name').textContent = '프로젝트를 선택하세요';
                document.getElementById('detail-project-meta').textContent = '고객사: - | 담당자: - | 시작일: -';
                document.getElementById('detail-project-desc').textContent = '설명이 없습니다.';
                document.getElementById('detail-project-tag').classList.add('hidden');
                const btnEditProject = document.getElementById('btn-edit-project');
                if (btnEditProject) btnEditProject.classList.add('hidden');
                const btnExportHtml = document.getElementById('pm-timetable-export-html');
                if (btnExportHtml) btnExportHtml.classList.add('hidden');
                const btnPmExportMd = document.getElementById('pm-timetable-export-md');
                if (btnPmExportMd) btnPmExportMd.classList.add('hidden');
                
                currentProjectId = null;
                const milestonesGrid = document.getElementById('milestones-grid');
                if (milestonesGrid) milestonesGrid.innerHTML = '';
                const pmTimetableContainer = document.getElementById('pm-timetable-container');
                if (pmTimetableContainer) pmTimetableContainer.innerHTML = '';
            } catch (err) {
                console.error("Complete Project Submit Error:", err);
                alert('프로젝트 완료 처리 실패: ' + err);
            }
        };
    }

    // Categories Modal
    const btnManageCategories = document.getElementById('btn-manage-categories');
    const modalCategories = document.getElementById('modal-categories');
    const btnCloseCategories = document.getElementById('btn-close-categories');
    const btnCloseCategoriesFooter = document.getElementById('btn-close-categories-footer');
    const btnAddCategory = document.getElementById('btn-add-category');
    const filterSelect = document.getElementById('minutes-category-filter');

    if (btnManageCategories) {
        btnManageCategories.onclick = () => {
            openCategoriesModal();
        };
    }
    if (btnCloseCategories) {
        btnCloseCategories.onclick = () => {
            modalCategories.classList.add('hidden');
        };
    }
    if (btnCloseCategoriesFooter) {
        btnCloseCategoriesFooter.onclick = () => {
            modalCategories.classList.add('hidden');
        };
    }
    if (btnAddCategory) {
        btnAddCategory.onclick = () => {
            addCategory();
        };
    }
    if (filterSelect) {
        filterSelect.onchange = () => {
            refreshMinutes();
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
                alert("마감일은 시작일 이후로 설정해야 합니다.");
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
            
            const submitBtn = formTask.querySelector('button[type="submit"]');
            const originalText = submitBtn ? submitBtn.innerHTML : '';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '저장 중...';
            }

            try {
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
                    alert("모든 필드(제목, 내용, 담당자, 시작일, 마감일)를 작성해 주세요.");
                    return;
                }

                // Date validation
                if (newTask.due_date && newTask.start_date && newTask.due_date < newTask.start_date) {
                    alert("마감일은 시작일보다 빠를 수 없습니다.");
                    return;
                }

                // Character length validation
                if (newTask.title.length > 50) {
                    alert("업무 제목은 50자 이하여야 합니다.");
                    return;
                }
                if (newTask.content.length > 500) {
                    alert("업무 내용은 500자 이하여야 합니다.");
                    return;
                }
                if (newTask.manager.length > 50) {
                    alert("업무 담당자는 50자 이하여야 합니다.");
                    return;
                }

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
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalText;
                }
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
            document.getElementById('meeting-modal-title').textContent = '회의록 등록';
            modalMeeting.classList.remove('hidden');
        };
    }

    if (formMeeting) {
        formMeeting.onsubmit = async (e) => {
            e.preventDefault();
            
            const submitBtn = formMeeting.querySelector('button[type="submit"]');
            const originalText = submitBtn ? submitBtn.innerHTML : '';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '저장 중...';
            }

            try {
                const catVal = document.getElementById('meeting-category').value;
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
                    category_id: catVal ? parseInt(catVal) : null,
                    created_at: "",
                    is_deleted: false
                };

                // Character length validation
                if (meetingData.title && meetingData.title.length > 40) {
                    alert("회의 제목은 40자 이하여야 합니다.");
                    return;
                }
                if (meetingData.location && meetingData.location.length > 30) {
                    alert("회의 장소는 30자 이하여야 합니다.");
                    return;
                }
                if (meetingData.participants && meetingData.participants.length > 50) {
                    alert("참석자는 50자 이하여야 합니다.");
                    return;
                }
                if (meetingData.memo && meetingData.memo.length > 3000) {
                    alert("안건은 3000자 이하여야 합니다.");
                    return;
                }
                if (meetingData.decisions && meetingData.decisions.length > 3000) {
                    alert("결정 사항은 3000자 이하여야 합니다.");
                    return;
                }
                if (meetingData.action_items && meetingData.action_items.length > 3000) {
                    alert("향후 계획은 3000자 이하여야 합니다.");
                    return;
                }

                // Enforce 99 minutes limit per category
                if (meetingData.category_id) {
                    const catId = parseInt(meetingData.category_id);
                    const currentCatCount = currentMeetings.filter(m => m.category_id === catId && m.id !== meetingData.id).length;
                    if (currentCatCount >= 99) {
                        alert("Category limit exceeded: A category can only hold a maximum of 99 minutes. (카테고리당 최대 99개의 회의록만 저장할 수 있습니다.)");
                        return;
                    }
                }

                await invoke('plugin:minutes|save_meeting', { meeting: meetingData });
                closeMeeting();
                await refreshMinutes();
            } catch (err) { 
                console.error("Save Meeting Error:", err); 
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalText;
                }
            }
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
            titleEl.textContent = readOnly ? '프로젝트 상세 정보 (조회 전용)' : (p.id ? '프로젝트 수정' : '새 프로젝트 등록');
        }

        const submitBtn = formProject.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.style.display = readOnly ? 'none' : 'block';
            submitBtn.textContent = p.id ? '프로젝트 저장' : '프로젝트 생성';
        }

        const cancelBtn = document.getElementById('btn-cancel-project');
        if (cancelBtn) {
            cancelBtn.textContent = readOnly ? '닫기' : '취소';
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
                    if (await askConfirm('이 프로젝트와 모든 관련 이정표(Milestones) 및 로그들을 휴지통으로 이동하시겠습니까?')) {
                        try {
                            await invoke('plugin:pm|delete_project', { projectId: p.id });
                            closeProject();
                            
                            // Clear current selected project display
                            document.getElementById('detail-project-name').textContent = '프로젝트를 선택하세요';
                            document.getElementById('detail-project-meta').textContent = '고객사: - | 담당자: - | 시작일: -';
                            document.getElementById('detail-project-desc').textContent = '설명이 없습니다.';
                            document.getElementById('detail-project-tag').classList.add('hidden');
                            const btnEditProject = document.getElementById('btn-edit-project');
                            if (btnEditProject) btnEditProject.classList.add('hidden');
                            const btnExportHtml = document.getElementById('pm-timetable-export-html');
                            if (btnExportHtml) btnExportHtml.classList.add('hidden');
                            const btnPmExportMd = document.getElementById('pm-timetable-export-md');
                            if (btnPmExportMd) btnPmExportMd.classList.add('hidden');

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
            
            const submitBtn = formProject.querySelector('button[type="submit"]');
            const originalText = submitBtn ? submitBtn.innerHTML : '';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '저장 중...';
            }

            try {
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
                
                const newId = await invoke('plugin:pm|add_project', { project: projectData });
                closeProject();
                await refreshProjects();
                if (projectData.id) {
                    await loadProjectDetails(projectData.id);
                } else if (newId) {
                    await loadProjectDetails(newId);
                }
            } catch (err) { 
                console.error("Save Project Error:", err); 
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalText;
                }
            }
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
                alert("마감일은 시작일 이후로 설정해야 합니다.");
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
                alert("로그 제목은 20자 이하여야 합니다.");
                return;
            }
            if (log.text_content && log.text_content.length > 500) {
                alert("로그 내용은 500자 이하여야 합니다.");
                return;
            }
            if (log.manager && log.manager.length > 15) {
                alert("로그 담당자는 15자 이하여야 합니다.");
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

    const btnPmExportMd = document.getElementById('pm-timetable-export-md');
    if (btnPmExportMd) {
        btnPmExportMd.onclick = async () => {
            if (!currentProjectId) {
                alert("Please select a project before exporting.");
                return;
            }

            const project = currentProjects.find(p => p.id === currentProjectId);
            if (!project) return;

            try {
                const logs = await invoke('plugin:pm|get_status_logs', { projectId: currentProjectId });
                const milestones = await invoke('plugin:pm|get_milestones', { projectId: currentProjectId });

                const mdContent = generateProjectMd(project, milestones, logs);

                if (window.__TAURI__ && window.__TAURI__.dialog) {
                    const savePath = await window.__TAURI__.dialog.save({
                        filters: [{ name: 'Markdown Document', extensions: ['md'] }],
                        defaultPath: `Project_Report_${project.name}.md`
                    });

                    if (savePath) {
                        await invoke('plugin:minutes|save_text_file', { path: savePath, content: mdContent });
                        alert("Project Markdown Export Successful!\nSaved to: " + savePath);
                    }
                } else {
                    console.log("Mock Export (No Tauri):", mdContent);
                    alert("Export feature only works in the desktop Tauri application.");
                }
            } catch (err) {
                console.error("Export MD Error:", err);
                alert("Failed to export Markdown: " + err);
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
                'modal-log', 'modal-settings', 'modal-done-log-detail',
                'modal-complete-project', 'modal-categories'
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

    // 실시간 DB 최근 업데이트 시점 갱신 핸들러 추가
    const updateDbLastModified = async () => {
        const timeElem = document.getElementById('db-last-modified-time');
        const oxigraphTimeElem = document.getElementById('oxigraph-last-modified-time');
        
        if (timeElem) {
            try {
                const lastModified = await invoke('plugin:engine|get_db_last_modified');
                timeElem.innerText = lastModified;
            } catch (err) {
                console.error("Failed to get DB last modified time:", err);
                timeElem.innerText = "N/A";
            }
        }
        
        if (oxigraphTimeElem) {
            try {
                const lastModified = await invoke('plugin:engine|get_oxigraph_last_modified');
                oxigraphTimeElem.innerText = lastModified;
            } catch (err) {
                console.error("Failed to get Oxigraph last modified time:", err);
                oxigraphTimeElem.innerText = "N/A";
            }
        }
    };

    // 초기 1회 실행 및 2초 단위 주기적 폴링 감시 루프
    updateDbLastModified();
    setInterval(updateDbLastModified, 2000);

    // Database Auto-Rebuild LanceDB Loader Helpers
    const showAutoRebuildLoader = (message) => {
        let loader = document.getElementById('lancedb-rebuild-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'lancedb-rebuild-loader';
            loader.style.position = 'fixed';
            loader.style.top = '0';
            loader.style.left = '0';
            loader.style.width = '100vw';
            loader.style.height = '100vh';
            loader.style.background = 'rgba(15, 12, 30, 0.85)';
            loader.style.backdropFilter = 'blur(12px)';
            loader.style.webKitBackdropFilter = 'blur(12px)';
            loader.style.display = 'flex';
            loader.style.flexDirection = 'column';
            loader.style.alignItems = 'center';
            loader.style.justifyContent = 'center';
            loader.style.zIndex = '99999';
            loader.style.transition = 'opacity 0.4s ease';
            
            loader.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; text-align: center; max-width: 500px; padding: 40px; border-radius: 24px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);">
                    <div class="loader-spinner" style="width: 50px; height: 50px; border: 4px solid rgba(255, 140, 0, 0.1); border-top: 4px solid #ff8c00; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <div style="font-size: 18px; font-weight: 600; color: #ffffff; margin-top: 10px;">LanceDB 인덱스 자동 재구축 중</div>
                    <div id="lancedb-rebuild-message" style="font-size: 13px; color: rgba(255, 255, 255, 0.6); line-height: 1.6; word-break: keep-all; white-space: pre-wrap;">${message}</div>
                </div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            `;
            document.body.appendChild(loader);
        } else {
            document.getElementById('lancedb-rebuild-message').textContent = message;
            loader.style.display = 'flex';
        }
    };

    const hideAutoRebuildLoader = () => {
        const loader = document.getElementById('lancedb-rebuild-loader');
        if (loader) {
            loader.style.display = 'none';
        }
    };

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
                    showAutoRebuildLoader("새로운 RDBMS 기준으로 로컬 백터 DB(LanceDB) 인덱스를 자동으로 재구성하는 중입니다. 이 작업은 사양 데이터 수에 따라 다소 시간이 걸릴 수 있습니다...");
                    
                    // 1. SQLite DB Import
                    await invoke('plugin:engine|import_db', { path: selected, user: currentUser });
                    
                    // 2. Rebuild LanceDB
                    showAutoRebuildLoader("RDBMS 임포트 완료. 이제 SQLite에 등록된 제품 사양 정보를 바탕으로 고성능 LanceDB 로컬 임베딩 인덱스를 구축하고 있습니다...");
                    try {
                        const rebuildRes = await invoke('plugin:rag|rebuild_lancedb_index');
                        console.log("LanceDB index rebuilt successfully:", rebuildRes);
                        alert(`데이터베이스 임포트 및 LanceDB 인덱스 자동 재구축 완료!\n총 ${rebuildRes.indexed_count}개의 제품 사양이 임베딩 인덱스로 동기화되었습니다.`);
                    } catch (rebuildErr) {
                        console.error("LanceDB Rebuild Failed:", rebuildErr);
                        alert("데이터베이스 임포트는 완료되었으나, LanceDB 인덱스 재구축 중 오류가 발생했습니다:\n" + rebuildErr);
                    } finally {
                        hideAutoRebuildLoader();
                    }
                    
                    window.location.reload();
                }
            } catch (err) { 
                hideAutoRebuildLoader();
                alert("Import Failed: " + err); 
            }
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
                    await updateDbLastModified(); // 백업 직후 강제 갱신
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

    // Oxigraph Actions
    const btnManualBackupOxigraph = document.getElementById('btn-manual-backup-oxigraph');
    const btnImportDbOxigraph = document.getElementById('btn-import-db-oxigraph');
    const btnOpenBackupDirOxigraph = document.getElementById('btn-open-backup-dir-oxigraph');
    const btnInitializeDbOxigraph = document.getElementById('btn-initialize-db-oxigraph');

    if (btnManualBackupOxigraph) {
        btnManualBackupOxigraph.onclick = async () => {
            try {
                const path = await window.__TAURI__.dialog.save({
                    title: 'Oxigraph Backup Destination',
                    defaultPath: 'sjworkassist_v2_oxigraph_backup'
                });
                
                if (path) {
                    const msg = await invoke('plugin:engine|manual_backup_oxigraph', { path });
                    alert(msg);
                    await updateDbLastModified();
                }
            } catch (err) { alert("Backup Failed: " + err); }
        };
    }

    if (btnImportDbOxigraph) {
        btnImportDbOxigraph.onclick = async () => {
            try {
                const selected = await window.__TAURI__.dialog.open({
                    title: 'Select Oxigraph Backup Directory',
                    multiple: false,
                    directory: true
                });
                if (selected) {
                    await invoke('plugin:engine|import_oxigraph', { path: selected });
                    alert("Oxigraph Database imported successfully.");
                    await updateDbLastModified();
                }
            } catch (err) { alert("Import Failed: " + err); }
        };
    }

    if (btnOpenBackupDirOxigraph) {
        btnOpenBackupDirOxigraph.onclick = async () => {
            try {
                await invoke('plugin:engine|open_oxigraph_backup_folder');
            } catch (err) { console.error("Open Folder Error:", err); }
        };
    }

    if (btnInitializeDbOxigraph) {
        btnInitializeDbOxigraph.onclick = async () => {
            if (await askConfirm("Are you sure? All Oxigraph Graph data will be permanently deleted!")) {
                try {
                    await invoke('plugin:engine|initialize_oxigraph_data');
                    alert("Oxigraph Database Initialized.");
                    await updateDbLastModified();
                } catch (err) { alert("Init Failed: " + err); }
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
            const isDone = t.status === 'Done';
            
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
        'nav-dashboard': '대시보드',
        'nav-kanban': '업무 관리자',
        'nav-trash': '휴지통',
        'nav-minutes-trash': '휴지통',
        'nav-pm-trash': '휴지통',
        'nav-pm-completed': '완료된 프로젝트',
        'nav-minutes': '회의록 관리자',
        'nav-pm': '프로젝트 관리자',
        'nav-rag': 'PDF & Excel 파싱',
        'nav-history': '히스토리 관리자',
        'nav-db-manager': '제품DB 관리자',
        'nav-order-db': '수주DB 관리자',
        'nav-motor-calc': '모터사양 및 토크 계산기'
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
    else if (viewId === 'nav-history') await refreshHistory();
    else if (viewId === 'nav-db-manager') await refreshDbSearchFilters();
    else if (viewId === 'nav-order-db') await refreshOrders();
    else if (viewId === 'nav-motor-calc') await refreshMotorCalc();
}

async function refreshStats() {
    if (!currentUser) return;
    try {
        // Query enabled features first to respect UI Synchronization principles
        const enabledFeatures = await invoke('plugin:engine|get_enabled_features');
        
        // 1. Kanban Module (Tasks Donut Chart)
        if (enabledFeatures.includes('kanban')) {
            try {
                const tasks = await invoke('plugin:kanban|get_tasks', { ownerId: currentUser.id });
                currentTasks = tasks; // Sync global state
                
                const pendingTasks = tasks.filter(t => t.status !== 'Done');
                const pendingCount = pendingTasks.length;
                
                const statTasks = document.getElementById('stat-tasks');
                if (statTasks) {
                    statTasks.textContent = pendingCount;
                    const label = statTasks.previousElementSibling;
                    if (label && label.classList.contains('stat-label')) {
                        label.textContent = 'Pending Tasks';
                    }
                }
                
                // Group tasks by status for the donut chart
                const counts = { 'Note': 0, 'Todo': 0, 'Doing': 0, 'Done': 0 };
                tasks.forEach(t => {
                    if (counts[t.status] !== undefined) counts[t.status]++;
                });
                
                const donutData = [
                    { label: 'Note', value: counts['Note'], color: '#64748b' },
                    { label: 'Todo', value: counts['Todo'], color: '#3b82f6' },
                    { label: 'Doing', value: counts['Doing'], color: '#f59e0b' },
                    { label: 'Done', value: counts['Done'], color: '#10b981' }
                ];
                
                drawDonutChart('svg-task-donut', donutData);
                const taskCard = document.getElementById('chart-card-tasks');
                if (taskCard) taskCard.style.display = 'block';
                
                renderImminentTasks(tasks);
                updateSidebarStatus(tasks);
            } catch (err) {
                console.error("Dashboard Kanban stats load error:", err);
            }
        } else {
            const taskCard = document.getElementById('chart-card-tasks');
            if (taskCard) taskCard.style.display = 'none';
        }

        // 2. Minutes Module (Meeting Categories radial breakdown)
        if (enabledFeatures.includes('minutes')) {
            try {
                const m = await invoke('plugin:minutes|get_meeting_count', { ownerId: currentUser.id });
                const statMeetings = document.getElementById('stat-meetings');
                if (statMeetings) statMeetings.textContent = m;
                
                const meetings = await invoke('plugin:minutes|get_meetings', { ownerId: currentUser.id });
                const categories = await invoke('plugin:minutes|get_categories', { ownerId: currentUser.id });
                
                drawMeetingCategories('categories-chart-list', meetings, categories);
                const categoriesCard = document.getElementById('chart-card-categories');
                if (categoriesCard) categoriesCard.style.display = 'block';
            } catch (err) {
                console.error("Dashboard Minutes stats load error:", err);
            }
        } else {
            const categoriesCard = document.getElementById('chart-card-categories');
            if (categoriesCard) categoriesCard.style.display = 'none';
        }

        // 3. PM Module (Departmental Workload Progress Bars)
        if (enabledFeatures.includes('pm')) {
            try {
                const p = await invoke('plugin:pm|get_project_count', { ownerId: currentUser.id });
                const statProjects = document.getElementById('stat-projects');
                if (statProjects) statProjects.textContent = p;
                
                const projects = await invoke('plugin:pm|get_projects', { ownerId: currentUser.id });
                const activeProjects = projects.filter(proj => !proj.is_deleted);
                
                const projectsWithLogs = [];
                // Load logs in parallel for performance
                await Promise.all(activeProjects.map(async (proj) => {
                    try {
                        const logs = await invoke('plugin:pm|get_status_logs', { projectId: proj.id });
                        projectsWithLogs.push({ project: proj, logs: logs });
                    } catch (err) {
                        console.error(`Error loading logs for project ID ${proj.id}:`, err);
                    }
                }));
                
                // Store globally
                currentProjectsWithLogs = projectsWithLogs;
                
                // Populate Dropdown
                const projectSelect = document.getElementById('dashboard-workload-project-select');
                if (projectSelect) {
                    projectSelect.innerHTML = '';
                    if (activeProjects.length === 0) {
                        const opt = document.createElement('option');
                        opt.value = "";
                        opt.textContent = "No Projects";
                        projectSelect.appendChild(opt);
                        selectedWorkloadProjectId = null;
                    } else {
                        activeProjects.forEach(proj => {
                            const opt = document.createElement('option');
                            opt.value = proj.id;
                            opt.textContent = `[${proj.project_tag}] ${proj.name}`;
                            projectSelect.appendChild(opt);
                        });
                        
                        // Select appropriate default
                        if (selectedWorkloadProjectId === null || !activeProjects.some(pr => pr.id === selectedWorkloadProjectId)) {
                            selectedWorkloadProjectId = activeProjects[0].id;
                        }
                        projectSelect.value = selectedWorkloadProjectId;
                    }
                }
                
                // Draw workload for selected project
                const selectedProjItem = projectsWithLogs.find(p => p.project.id === selectedWorkloadProjectId);
                drawDepartmentWorkload('workload-bar-list', selectedProjItem);
                
                // Bind dropdown change event
                if (projectSelect) {
                    projectSelect.onchange = (e) => {
                        const val = e.target.value;
                        if (!val) {
                            selectedWorkloadProjectId = null;
                            drawDepartmentWorkload('workload-bar-list', null);
                            return;
                        }
                        selectedWorkloadProjectId = parseInt(val);
                        const item = currentProjectsWithLogs.find(p => p.project.id === selectedWorkloadProjectId);
                        drawDepartmentWorkload('workload-bar-list', item);
                    };
                }

                // Bind metric select change event
                const metricSelect = document.getElementById('dashboard-workload-metric-select');
                if (metricSelect) {
                    metricSelect.onchange = () => {
                        const item = currentProjectsWithLogs.find(p => p.project.id === selectedWorkloadProjectId);
                        drawDepartmentWorkload('workload-bar-list', item);
                    };
                }
                
                const workloadCard = document.getElementById('chart-card-workload');
                if (workloadCard) workloadCard.style.display = 'block';
            } catch (err) {
                console.error("Dashboard PM stats load error:", err);
            }
        } else {
            const workloadCard = document.getElementById('chart-card-workload');
            if (workloadCard) workloadCard.style.display = 'none';
        }
        
    } catch (err) {
        console.error("Refresh Stats Main Error:", err);
    }
}

/* ==========================================================================
   Zero-Dependency SVG Chart Drawing Functions (v2.2 Dashboard Upgrade)
   ========================================================================== */

function drawDonutChart(svgId, data) {
    const svg = document.getElementById(svgId);
    if (!svg) return;
    svg.innerHTML = '';
    
    const legend = document.getElementById('legend-task-donut');
    if (legend) legend.innerHTML = '';

    const total = data.reduce((sum, item) => sum + item.value, 0);
    if (total === 0) {
        svg.innerHTML = `
            <circle cx="80" cy="80" r="55" fill="transparent" stroke="rgba(255,255,255,0.05)" stroke-width="12"></circle>
            <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-size="12" font-weight="600">No Tasks</text>
        `;
        return;
    }

    const cx = 80;
    const cy = 80;
    const radius = 55;
    const strokeWidth = 12;
    const circumference = 2 * Math.PI * radius;
    
    let currentOffset = 0;
    
    data.forEach((item) => {
        // Draw Legend Item
        if (legend) {
            const legItem = document.createElement('div');
            legItem.className = 'legend-item';
            legItem.innerHTML = `
                <span class="legend-color" style="color: ${item.color}; background: ${item.color};"></span>
                <span class="legend-label">${item.label}</span>
                <span class="legend-value">${item.value}</span>
            `;
            legend.appendChild(legItem);
        }

        if (item.value === 0) return;
        
        const percentage = item.value / total;
        const strokeLength = percentage * circumference;
        
        // Circular Segment
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", cx);
        circle.setAttribute("cy", cy);
        circle.setAttribute("r", radius);
        circle.setAttribute("fill", "transparent");
        circle.setAttribute("stroke", item.color);
        circle.setAttribute("stroke-width", strokeWidth);
        circle.setAttribute("stroke-dasharray", `${strokeLength} ${circumference}`);
        circle.setAttribute("stroke-dashoffset", -currentOffset);
        circle.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);
        circle.setAttribute("class", "donut-segment");
        circle.style.transition = "stroke-width 0.2s ease, stroke 0.2s ease";
        
        // Micro-animations & Interactive tooltips
        circle.onmouseenter = (e) => {
            circle.setAttribute("stroke-width", strokeWidth + 3);
            showChartTooltip(e, `${item.label}: ${item.value} tasks (${Math.round(percentage * 100)}%)`);
        };
        circle.onmouseleave = () => {
            circle.setAttribute("stroke-width", strokeWidth);
            hideChartTooltip();
        };
        
        svg.appendChild(circle);
        currentOffset += strokeLength;
    });
    
    // Total count value in the center
    const textVal = document.createElementNS("http://www.w3.org/2000/svg", "text");
    textVal.setAttribute("x", "50%");
    textVal.setAttribute("y", "47%");
    textVal.setAttribute("dominant-baseline", "middle");
    textVal.setAttribute("text-anchor", "middle");
    textVal.setAttribute("fill", "#ffffff");
    textVal.setAttribute("font-size", "22px");
    textVal.setAttribute("font-weight", "800");
    textVal.textContent = total;
    svg.appendChild(textVal);

    // TOTAL label under value
    const textLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    textLabel.setAttribute("x", "50%");
    textLabel.setAttribute("y", "63%");
    textLabel.setAttribute("dominant-baseline", "middle");
    textLabel.setAttribute("text-anchor", "middle");
    textLabel.setAttribute("fill", "#9ca3af");
    textLabel.setAttribute("font-size", "10px");
    textLabel.setAttribute("font-weight", "700");
    textLabel.setAttribute("letter-spacing", "0.5px");
    textLabel.textContent = "TOTAL";
    svg.appendChild(textLabel);
}

function getPlannedDays(startDateStr, dueDateStr) {
    if (!startDateStr || !dueDateStr) return 0;
    const start = new Date(startDateStr);
    const due = new Date(dueDateStr);
    if (isNaN(start.getTime()) || isNaN(due.getTime())) return 0;
    const diffTime = due - start;
    if (diffTime < 0) return 1; // Fallback if dates are inverted
    return Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

function drawDepartmentWorkload(containerId, selectedProjItem) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (!selectedProjItem) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); font-size: 13px; padding: 20px 0;">
                No active project selected.
            </div>
        `;
        return;
    }

    const proj = selectedProjItem.project;
    const logs = selectedProjItem.logs || [];
    
    // Resolve project custom department names
    const d1 = (proj.dept1_name || 'Mech').trim();
    const d2 = (proj.dept2_name || 'Control').trim();
    const d3 = (proj.dept3_name || 'Elec').trim();
    const d4 = (proj.dept4_name || 'Sales').trim();

    // Read the active metric from the DOM
    const metricSelect = document.getElementById('dashboard-workload-metric-select');
    const metric = metricSelect ? metricSelect.value : 'logs';

    // Initialize counts with user-defined department names!
    const depts = {
        'Mech': { value: 0, color: '#3b82f6', label: d1 },
        'Control': { value: 0, color: '#f59e0b', label: d2 },
        'Elec': { value: 0, color: '#10b981', label: d3 },
        'Sales': { value: 0, color: '#ec4899', label: d4 }
    };

    logs.forEach(log => {
        if (log.is_deleted) return;
        
        let increment = 1;
        if (metric === 'days') {
            increment = getPlannedDays(log.start_date, log.due_date);
        }

        const logDept = (log.department || '').trim();
        if (logDept === d1 || logDept === 'Mech') depts['Mech'].value += increment;
        else if (logDept === d2 || logDept === 'Control') depts['Control'].value += increment;
        else if (logDept === d3 || logDept === 'Elec') depts['Elec'].value += increment;
        else if (logDept === d4 || logDept === 'Sales') depts['Sales'].value += increment;
    });

    const totalVal = Object.values(depts).reduce((sum, d) => sum + d.value, 0);

    if (totalVal === 0) {
        const emptyMsg = metric === 'days' 
            ? 'No planned days found in project logs (or start/due dates are not set).'
            : 'No active status logs found for this project.';
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); font-size: 13px; padding: 20px 0;">
                ${emptyMsg}
            </div>
        `;
        return;
    }

    Object.keys(depts).forEach(key => {
        const dept = depts[key];
        const pct = totalVal > 0 ? Math.round((dept.value / totalVal) * 100) : 0;
        
        const labelStr = metric === 'days' ? `${dept.value} days` : `${dept.value} logs`;
        const tooltipStr = metric === 'days' 
            ? `${dept.label}: ${dept.value} planned days (${pct}% of project schedule duration)`
            : `${dept.label}: ${dept.value} active status logs (${pct}% of project workload)`;

        const item = document.createElement('div');
        item.className = 'workload-item';
        item.innerHTML = `
            <div class="workload-meta">
                <span class="workload-label">
                    <span class="category-bubble-indicator" style="color: ${dept.color}; background: ${dept.color};"></span>
                    ${dept.label}
                </span>
                <span class="workload-val">${labelStr} (${pct}%)</span>
            </div>
            <div class="workload-bar-bg">
                <div class="workload-bar-fill" style="width: ${pct}%; color: ${dept.color}; background: linear-gradient(90deg, ${dept.color}bb, ${dept.color});"></div>
            </div>
        `;
        
        // Add interactive tooltips to bars
        item.onmouseenter = (e) => {
            showChartTooltip(e, tooltipStr);
        };
        item.onmouseleave = () => {
            hideChartTooltip();
        };

        container.appendChild(item);
    });
}

function drawMeetingCategories(containerId, meetings, categories) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const activeMeetings = meetings.filter(m => !m.is_deleted);
    const categoryCounts = {};
    
    // Seed default Uncategorized bucket
    categoryCounts[0] = { name: 'Uncategorized', color: '#64748b', count: 0 };
    
    categories.forEach(cat => {
        categoryCounts[cat.id] = { name: cat.name, color: cat.color || '#3b82f6', count: 0 };
    });

    activeMeetings.forEach(m => {
        const catId = m.category_id || 0;
        if (categoryCounts[catId]) {
            categoryCounts[catId].count++;
        } else {
            categoryCounts[0].count++;
        }
    });

    // Filter out categories with zero meetings, but keep Uncategorized if it has items
    const sortedCats = Object.values(categoryCounts)
        .filter(c => c.count > 0 || c.name === 'Uncategorized')
        .sort((a, b) => b.count - a.count);

    const totalActive = activeMeetings.length;

    if (totalActive === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); font-size: 13px; padding: 20px 0;">
                No minutes recorded yet.
            </div>
        `;
        return;
    }

    sortedCats.forEach(cat => {
        const pct = totalActive > 0 ? Math.round((cat.count / totalActive) * 100) : 0;
        
        const item = document.createElement('div');
        item.className = 'category-chart-item';
        item.innerHTML = `
            <div class="category-chart-left">
                <span class="category-bubble-indicator" style="color: ${cat.color}; background: ${cat.color};"></span>
                <span class="category-chart-name">${cat.name}</span>
            </div>
            <div class="category-chart-right">
                <span class="category-chart-count">${cat.count} min</span>
                <span class="category-chart-pct">${pct}%</span>
            </div>
        `;

        item.onmouseenter = (e) => {
            showChartTooltip(e, `Category "${cat.name}": ${cat.count} minutes (${pct}% of total meetings)`);
        };
        item.onmouseleave = () => {
            hideChartTooltip();
        };

        container.appendChild(item);
    });
}

function showChartTooltip(e, text) {
    const tooltip = document.getElementById('chart-tooltip');
    if (!tooltip) return;
    tooltip.textContent = text;
    tooltip.style.opacity = '1';
    
    // Position the tooltip slightly above and to the right of the pointer
    const x = e.pageX + 12;
    const y = e.pageY - 12;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
}

function hideChartTooltip() {
    const tooltip = document.getElementById('chart-tooltip');
    if (tooltip) {
        tooltip.style.opacity = '0';
    }
}

function renderImminentTasks(tasks) {
    const container = document.getElementById('imminent-tasks-list');
    if (!container) return;

    // Filter tasks that are Todo or Doing and have a due date
    const imminentTasks = tasks.filter(t => 
        !t.is_deleted && (t.status === 'Todo' || t.status === 'Doing') && t.due_date
    );

    if (imminentTasks.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 12px; padding: 16px 0;">🎉 No imminent tasks due soon.</div>`;
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Map and calculate diffDays
    const mappedTasks = imminentTasks.map(t => {
        const due = new Date(t.due_date);
        due.setHours(0, 0, 0, 0);
        const diffTime = due.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return { ...t, diffDays };
    });

    // Sort ascending by due date (most overdue/imminent first)
    mappedTasks.sort((a, b) => a.diffDays - b.diffDays);

    container.innerHTML = '';
    
    mappedTasks.forEach(t => {
        const item = document.createElement('div');
        item.className = `imminent-task-item ${t.diffDays < 0 ? 'overdue' : ''}`;
        
        // Status Badge
        const statusClass = t.status === 'Todo' ? 'task-badge-todo' : 'task-badge-doing';
        const statusBadge = `<span class="task-badge-status ${statusClass}">${t.status}</span>`;
        
        // D-Day Badge
        let ddayBadge = '';
        if (t.diffDays < 0) {
            ddayBadge = `<span class="dday-badge overdue">D+${Math.abs(t.diffDays)}</span>`;
        } else if (t.diffDays === 0) {
            ddayBadge = `<span class="dday-badge today">D-Day</span>`;
        } else {
            ddayBadge = `<span class="dday-badge future">D-${t.diffDays}</span>`;
        }
        
        item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                <span style="font-family: monospace; font-size: 11px; color: var(--accent-color); font-weight: 600; white-space: nowrap;">${t.task_tag || 'TAG'}</span>
                <span style="font-size: 12px; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;" title="${t.title}">${t.title}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                ${statusBadge}
                ${ddayBadge}
            </div>
        `;
        
        item.onclick = (e) => {
            e.preventDefault();
            openTaskModal(t, false);
        };
        
        container.appendChild(item);
    });
}

function updateSidebarStatus(tasks) {
    const pendingTasks = tasks.filter(t => t.status !== 'Done');
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
    
    document.getElementById('task-modal-title').textContent = readOnly ? '업무 상세 정보 (읽기 전용)' : (taskId ? '업무 수정' : '새 업무 등록');
    
    const submitBtn = document.querySelector('#modal-task button[type="submit"]');
    if (submitBtn) {
        submitBtn.textContent = taskId ? '업무 수정' : '업무 등록';
        submitBtn.style.display = readOnly ? 'none' : 'block';
    }

    const cancelBtn = document.getElementById('btn-cancel-task');
    if (cancelBtn) {
        cancelBtn.textContent = readOnly ? '닫기' : '취소';
    }
    
    const btnDelModal = document.getElementById('btn-delete-task-modal');
    if (btnDelModal) {
        if (readOnly) {
            btnDelModal.classList.add('hidden');
        } else if (taskId) {
            btnDelModal.classList.remove('hidden');
            if (t.status === 'Done') {
                btnDelModal.textContent = '승인 및 보관';
                btnDelModal.className = 'btn btn-success'; // Green style
                btnDelModal.onclick = async () => {
                    openReviewModal(taskId);
                    closeTask();
                };
            } else {
                btnDelModal.textContent = '업무 삭제';
                btnDelModal.className = 'btn btn-danger-outline'; // Red style
                btnDelModal.onclick = async () => {
                    if (await askConfirm('이 업무를 삭제하시겠습니까?')) {
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
            ${(t.status === 'Done')
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
                if (await askConfirm('이 업무를 삭제하시겠습니까?')) {
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
        await refreshCategories();
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
    
    const filterSelect = document.getElementById('minutes-category-filter');
    const selectedFilter = filterSelect ? filterSelect.value : 'all';

    // Set grouped view layout style class
    list.className = 'minutes-list grouped-view';

    // 1. Group meetings by category
    let lanesToRender = [];
    
    if (selectedFilter === 'all') {
        // Render all categories lanes + uncategorized lane
        lanesToRender = currentCategories.map(cat => ({
            id: cat.id,
            name: cat.name,
            color: cat.color,
            meetings: meetings.filter(m => m.category_id === cat.id)
        }));
        // Add Uncategorized lane to the very beginning
        const uncategorizedMeetings = meetings.filter(m => !m.category_id);
        lanesToRender.unshift({
            id: 'none',
            name: 'Uncategorized',
            color: '#6b7280',
            meetings: uncategorizedMeetings
        });
    } else if (selectedFilter === 'none') {
        lanesToRender = [{
            id: 'none',
            name: 'Uncategorized',
            color: '#6b7280',
            meetings: meetings.filter(m => !m.category_id)
        }];
    } else {
        const catId = parseInt(selectedFilter);
        const cat = currentCategories.find(c => c.id === catId);
        if (cat) {
            lanesToRender = [{
                id: cat.id,
                name: cat.name,
                color: cat.color,
                meetings: meetings.filter(m => m.category_id === cat.id)
            }];
        }
    }

    lanesToRender.forEach(lane => {
        const laneEl = document.createElement('div');
        laneEl.className = 'minutes-category-lane';
        
        laneEl.innerHTML = `
            <div class="minutes-category-lane-header">
                <div class="minutes-category-lane-title">
                    <span class="minutes-category-lane-dot" style="background-color: ${lane.color}; color: ${lane.color};"></span>
                    <span>${lane.name}</span>
                </div>
                <span class="minutes-category-lane-count">${lane.meetings.length}</span>
            </div>
            <div class="lane-import-actions" style="display: flex; gap: 8px; padding: 0 2px;">
                <button class="btn btn-outline-accent btn-lane-import-single" style="flex: 1; font-size: 11px; padding: 6px 4px; line-height: 1.2; height: auto; display: flex; align-items: center; justify-content: center; gap: 4px; border-radius: 6px;" title="Import MD from File">
                    <span>📄</span> Import File
                </button>
                <button class="btn btn-outline-accent btn-lane-import-bulk" style="flex: 1; font-size: 11px; padding: 6px 4px; line-height: 1.2; height: auto; display: flex; align-items: center; justify-content: center; gap: 4px; border-radius: 6px;" title="Import MD from Folder">
                    <span>📁</span> Import Folder
                </button>
            </div>
            <div class="minutes-category-lane-cards" style="display: flex; flex-direction: column; gap: 12px; min-height: 100px;">
                <!-- Cards go here -->
            </div>
        `;

        const cardsContainer = laneEl.querySelector('.minutes-category-lane-cards');

        // Wire up import buttons for this lane
        const btnSingle = laneEl.querySelector('.btn-lane-import-single');
        const btnBulk = laneEl.querySelector('.btn-lane-import-bulk');
        const categoryId = lane.id === 'none' ? null : lane.id;

        btnSingle.onclick = async (e) => {
            e.stopPropagation();
            try {
                const file = await window.__TAURI__.dialog.open({
                    directory: false,
                    multiple: false,
                    title: `Select Markdown File to Import to "${lane.name}"`,
                    filters: [{ name: 'Markdown', extensions: ['md'] }]
                });
                
                if (file) {
                    const warning = await invoke('plugin:minutes|import_minutes_md_single', { 
                        filePath: file, 
                        ownerId: currentUser.id,
                        categoryId: categoryId
                    });
                    if (warning) {
                        alert(warning);
                    } else {
                        alert(`Successfully imported the meeting minutes to "${lane.name}".`);
                    }
                    refreshMinutes(); // refresh the list
                }
            } catch (err) {
                console.error("Import MD File Error:", err);
                alert(err);
                if (typeof refreshMinutes === 'function') refreshMinutes();
            }
        };

        btnBulk.onclick = async (e) => {
            e.stopPropagation();
            try {
                const dir = await window.__TAURI__.dialog.open({
                    directory: true,
                    multiple: false,
                    title: `Select Directory to Import MD files to "${lane.name}"`
                });
                
                if (dir) {
                    const resultMsg = await invoke('plugin:minutes|import_minutes_md_bulk', { 
                        dirPath: dir, 
                        ownerId: currentUser.id,
                        categoryId: categoryId
                    });
                    alert(resultMsg);
                    refreshMinutes(); // refresh the list
                }
            } catch (err) {
                console.error("Import MD Error:", err);
                alert(err);
                if (typeof refreshMinutes === 'function') refreshMinutes();
            }
        };

        if (lane.meetings.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.style.textAlign = 'center';
            emptyEl.style.color = 'var(--text-secondary)';
            emptyEl.style.fontSize = '12px';
            emptyEl.style.padding = '20px 10px';
            emptyEl.style.border = '1px dashed rgba(255, 255, 255, 0.05)';
            emptyEl.style.borderRadius = '12px';
            emptyEl.textContent = 'No minutes in this category.';
            cardsContainer.appendChild(emptyEl);
        }

        lane.meetings.forEach(m => {
            const card = document.createElement('div');
            card.className = 'meeting-card';
            card.dataset.id = m.id;
            
            const tagBadge = m.meeting_tag ? `<span class="tag-badge-mini">${m.meeting_tag}</span>` : '';
            
            // Get category badge if any
            let catBadge = '';
            const mCat = currentCategories.find(c => c.id === m.category_id);
            if (mCat) {
                catBadge = `<span class="meeting-card-category-badge" style="color: ${mCat.color};">${mCat.name}</span>`;
            }

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                    <div class="meeting-date-badge">${m.date || 'No Date'}</div>
                </div>
                ${tagBadge} 
                <div class="meeting-title" style="margin-bottom: 8px;">${m.title}</div>
                <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: auto;">
                    <div class="meeting-info" style="margin-top: 0;">
                        <span>📍 ${m.location || 'Remote'}</span>
                        <span>👥 ${m.participants || 'N/A'}</span>
                    </div>
                    ${catBadge}
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

            cardsContainer.appendChild(card);
        });

        list.appendChild(laneEl);
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
    body.innerHTML = '<tr><td colspan="6">로딩 중...</td></tr>';
    try {
        const deletedProjects = await invoke('plugin:pm|get_deleted_projects', { ownerId: currentUser.id });
        body.innerHTML = '';
        if (deletedProjects.length === 0) {
            body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted)">삭제된 프로젝트가 없습니다.</td></tr>';
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
                        <button class="btn-restore" data-id="${p.id}">🔄 복구</button>
                        <button class="btn-hard-del" data-id="${p.id}">🔥 영구삭제</button>
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
                if (await askConfirm('이 프로젝트를 영구적으로 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
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
    body.innerHTML = '<tr><td colspan="7">로딩 중...</td></tr>';
    try {
        const completedProjects = await invoke('plugin:pm|get_completed_projects', { ownerId: currentUser.id });
        body.innerHTML = '';
        if (completedProjects.length === 0) {
            body.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 40px; color: var(--text-muted)">완료된 프로젝트가 없습니다.</td></tr>';
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
                        <button class="btn-restore" data-id="${p.id}" title="프로젝트 다시 활성화">🔄 활성화</button>
                        <button class="btn-hard-del btn-delete-log-permanent" data-id="${p.id}" title="휴지통으로 이동">🗑️ 삭제</button>
                    </div>
                </td>
            `;
            body.appendChild(row);
        });

        // Add listeners
        body.querySelectorAll('.btn-restore').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                if (await askConfirm('이 완료된 프로젝트를 다시 활성 상태로 전환하시겠습니까?')) {
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
                if (await askConfirm('이 프로젝트를 휴지통으로 이동하시겠습니까?')) {
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
            
            // Format start date beautifully
            const formattedDate = p.start_date ? `📅 Start: ${p.start_date}` : '📅 Start: -';
            
            item.innerHTML = `
                ${tagBadge}
                <h4>${p.name}</h4>
                <div class="client">${p.client || 'Internal Project'}</div>
                <div class="project-start-date">${formattedDate}</div>
                <div class="project-actions-group">
                    <button class="btn-icon complete-project-btn" title="Complete Project">✓</button>
                    <button class="btn-icon export-project-btn" title="Export DB">📤</button>
                    <button class="btn-icon delete-project-btn" title="Delete">🗑️</button>
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
                                const btnPmExportMd = document.getElementById('pm-timetable-export-md');
                                if (btnPmExportMd) btnPmExportMd.classList.add('hidden');
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
    const btnPmExportMd = document.getElementById('pm-timetable-export-md');
    if (btnPmExportMd) {
        btnPmExportMd.classList.remove('hidden');
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
                document.getElementById('log-modal-title').textContent = '상태 로그 등록';
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
                document.getElementById('log-modal-title').textContent = '상태 로그 등록';
                
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
        const status = (ms && ms.is_saved && ms.is_done) ? '완료' : '대기';

        let actionHtml = '';
        if (hasData) {
            actionHtml = `
                <div class="milestone-actions">
                    ${ms.is_done 
                        ? `<button class="btn-milestone-active compact" title="이정표 활성화">↩</button>` 
                        : `<button class="btn-milestone-done compact" title="이정표 완료">✓</button>`
                    }
                    <button class="btn-milestone-del compact" title="이정표 초기화">🗑️</button>
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
                    if (await askConfirm('이 이정표 슬롯을 초기화하시겠습니까?')) {
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

    // Show a clean loading state while fetching backend data
    container.innerHTML = '<div style="padding: 20px; color: var(--text-secondary); text-align: center; font-size: 14px;">Loading timetable data...</div>';

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
        container.innerHTML = '<div style="padding: 20px; color: #ef4444; text-align: center; font-size: 14px;">Failed to load timetable data.</div>';
        return;
    }

    // Clear loading state synchronously right before building DOM nodes to prevent race conditions
    container.innerHTML = '';

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
            document.getElementById('log-modal-title').textContent = '상태 로그 수정';
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
        if (btnSubmit) btnSubmit.textContent = '로그 등록';
    } else {
        // Existing log
        btnDone.classList.remove('hidden');
        btnDel.classList.remove('hidden');
        if (btnSubmit) btnSubmit.textContent = '로그 수정';

        // Configure Done button
        if (logStatus === 'done') {
            btnDone.textContent = '재오픈';
            btnDone.className = 'btn btn-secondary-outline';
        } else {
            btnDone.textContent = '완료';
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
            const confirmDel = await askConfirm("이 상태 로그를 삭제된 로그 목록으로 이동하시겠습니까?", "상태 로그 삭제");
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
                const confirmDel = await askConfirm("이 상태 로그를 삭제된 로그 목록으로 이동하시겠습니까?", "상태 로그 삭제");
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
            document.getElementById('log-modal-title').textContent = '상태 로그 수정';
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

function generateProjectMd(project, milestones, logs) {
    const sortedMilestones = [...milestones].filter(m => m.is_saved && (m.name || m.deadline)).sort((a,b) => new Date(a.deadline) - new Date(b.deadline));
    const activeLogs = [...logs].filter(l => !l.is_deleted && l.status !== 'done').sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    const doneLogs = [...logs].filter(l => !l.is_deleted && l.status === 'done').sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    const deletedLogs = [...logs].filter(l => l.is_deleted).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));

    let md = `# 📝 Project Report: ${project.name}\n\n`;
    md += `- **Client:** ${project.client || '-'}\n`;
    md += `- **Manager:** ${project.manager || '-'}\n`;
    md += `- **Start Date:** ${project.start_date || '-'}\n`;
    md += `- **Generated:** ${new Date().toLocaleString()}\n\n`;

    md += `> ### Project Overview\n> ${project.description ? project.description.replace(/\n/g, '\n> ') : 'No description available.'}\n\n`;

    // 1. Gantt Chart using Mermaid
    md += `## 📊 Project Timetable (Gantt Chart)\n\n`;
    md += `\`\`\`mermaid\ngantt\n`;
    md += `    title Project Timetable\n`;
    md += `    dateFormat YYYY-MM-DD\n`;
    md += `    axisFormat %Y-%m\n\n`;

    // Add milestones to Gantt as milestones
    if (sortedMilestones.length > 0) {
        md += `    section Milestones\n`;
        sortedMilestones.forEach(m => {
            const deadline = m.deadline || new Date().toISOString().split('T')[0];
            const cleanName = (m.name || 'Milestone').replace(/:/g, ' ');
            const statusTag = m.is_done ? 'done' : 'active';
            md += `    ${cleanName} : milestone, ${statusTag}, ${deadline}, 1d\n`;
        });
        md += `\n`;
    }

    // Add departments as sections
    const depts = [
        { name: project.dept1_name || 'Mech', logs: activeLogs.filter(l => l.department.toLowerCase() === (project.dept1_name || 'Mech').toLowerCase()) },
        { name: project.dept2_name || 'Control', logs: activeLogs.filter(l => l.department.toLowerCase() === (project.dept2_name || 'Control').toLowerCase()) },
        { name: project.dept3_name || 'Elec', logs: activeLogs.filter(l => l.department.toLowerCase() === (project.dept3_name || 'Elec').toLowerCase()) },
        { name: project.dept4_name || 'Sales', logs: activeLogs.filter(l => l.department.toLowerCase() === (project.dept4_name || 'Sales').toLowerCase()) }
    ];

    depts.forEach(dept => {
        if (dept.logs.length > 0) {
            md += `    section ${dept.name.toUpperCase()}\n`;
            dept.logs.forEach(l => {
                const start = l.start_date || project.start_date || new Date().toISOString().split('T')[0];
                const due = l.due_date || start;
                const cleanTitle = (l.title || 'Log').replace(/:/g, ' ');
                let statusTag = '';
                if (l.status === 'doing') statusTag = 'active, ';
                else if (l.status === 'review') statusTag = 'crit, ';
                md += `    ${cleanTitle} : ${statusTag}${start}, ${due}\n`;
            });
            md += `\n`;
        }
    });

    md += `\`\`\`\n\n`;

    // 2. Departmental Status Board
    md += `## 📋 Departmental Status Board\n\n`;
    depts.forEach(dept => {
        md += `### 🔹 ${dept.name.toUpperCase()}\n\n`;
        if (dept.logs.length === 0) {
            md += `*No active logs*\n\n`;
        } else {
            dept.logs.forEach(l => {
                md += `#### 📌 ${l.title}\n`;
                if (l.text_content) {
                    md += `${l.text_content.trim()}\n\n`;
                }
                md += `- **PIC:** ${l.manager || '-'}\n`;
                md += `- **Duration:** ${(l.start_date || l.due_date) ? (l.start_date || '-') + ' ~ ' + (l.due_date || '-') : '-'}\n\n`;
            });
        }
    });

    // 3. Project Milestones
    md += `## 🎯 Project Milestones\n\n`;
    md += `| Slot | Milestone Name | Deadline | Status |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    if (sortedMilestones.length === 0) {
        md += `| - | No milestones defined. | - | - |\n`;
    } else {
        sortedMilestones.forEach((m, idx) => {
            const slot = (idx + 1) < 10 ? '0' + (idx + 1) : (idx + 1);
            const status = m.is_done ? '✓ Done' : '⏳ Pending';
            md += `| ${slot} | ${m.name || '-'} | ${m.deadline || '-'} | ${status} |\n`;
        });
    }
    md += `\n`;

    // Helper to render logs table
    const renderLogsTable = (logList, showStatusColumn) => {
        let table = `| Slot | Title | Details | PIC | Duration |`;
        if (showStatusColumn) table += ` Status |`;
        table += `\n| :--- | :--- | :--- | :--- | :--- |`;
        if (showStatusColumn) table += ` :--- |`;
        table += `\n`;

        if (logList.length === 0) {
            table += `| - | No logs recorded. | - | - | - |`;
            if (showStatusColumn) table += ` - |`;
            table += `\n`;
        } else {
            logList.forEach(l => {
                const slot = `[${l.department.toUpperCase()}]`;
                const title = l.title || '-';
                const details = (l.text_content || '').replace(/\n/g, '<br>');
                const pic = l.manager || '-';
                const duration = (l.start_date || l.due_date) ? `${l.start_date || '-'} ~ ${l.due_date || '-'}` : '-';
                
                table += `| ${slot} | ${title} | ${details} | ${pic} | ${duration} |`;
                if (showStatusColumn) {
                    const statusText = l.is_deleted ? '🗑 Deleted' : '✓ Done';
                    table += ` ${statusText} |`;
                }
                table += `\n`;
            });
        }
        return table;
    };

    // 4. Active Status Logs
    md += `## ⚡ Active Status Logs\n\n`;
    md += renderLogsTable(activeLogs, false);
    md += `\n`;

    // 5. Done Status Logs
    md += `## ✅ Done Status Logs\n\n`;
    md += renderLogsTable(doneLogs, true);
    md += `\n`;

    // 6. Deleted Status Logs
    md += `## 🗑 Deleted Status Logs\n\n`;
    md += renderLogsTable(deletedLogs, true);
    md += `\n`;

    return md;
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
    if (task.is_deleted || task.status === 'Done') {
        return true;
    }

    // Filter current tasks to get only active pending tasks (excluding deleted & completed ones)
    const activeTasks = currentTasks.filter(t => 
        !t.is_deleted && 
        t.status !== 'Done'
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

// --- Category Management Helper Functions ---
async function refreshCategories() {
    try {
        if (!currentUser) return;
        currentCategories = await invoke('plugin:minutes|get_categories', { ownerId: currentUser.id });
        
        // Update the counter badge in manage categories modal if open
        const countBadge = document.getElementById('category-count-badge');
        if (countBadge) {
            countBadge.textContent = `${currentCategories.length} / 50`;
        }

        // Populate meeting-category dropdown in Editor Modal
        const editorSelect = document.getElementById('meeting-category');
        if (editorSelect) {
            const currentSelVal = editorSelect.value;
            editorSelect.innerHTML = '<option value="">Uncategorized</option>';
            currentCategories.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.textContent = cat.name;
                editorSelect.appendChild(opt);
            });
            editorSelect.value = currentSelVal;
        }

        // Populate minutes-category-filter dropdown in Minutes Header
        const filterSelect = document.getElementById('minutes-category-filter');
        if (filterSelect) {
            const currentFilterVal = filterSelect.value;
            filterSelect.innerHTML = `
                <option value="all">All Categories</option>
                <option value="none">Uncategorized</option>
            `;
            currentCategories.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.textContent = cat.name;
                filterSelect.appendChild(opt);
            });
            // Try to restore previous selection
            filterSelect.value = filterSelect.querySelector(`option[value="${currentFilterVal}"]`) ? currentFilterVal : 'all';
        }
    } catch (err) {
        console.error("Refresh Categories Error:", err);
    }
}

function openCategoriesModal() {
    const modal = document.getElementById('modal-categories');
    if (!modal) return;
    
    // Clear inputs
    document.getElementById('new-category-name').value = '';
    document.getElementById('new-category-color').value = '#3b82f6';
    
    renderCategoriesList();
    
    modal.classList.remove('hidden');
}

function renderCategoriesList() {
    const container = document.getElementById('categories-list-items');
    if (!container) return;
    container.innerHTML = '';
    
    if (currentCategories.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">No categories created.</div>';
        return;
    }
    
    currentCategories.forEach(cat => {
        const item = document.createElement('div');
        item.className = 'category-manager-item';
        
        item.innerHTML = `
            <div class="category-manager-info">
                <span class="category-manager-color-bubble" style="background-color: ${cat.color}; color: ${cat.color};"></span>
                <span class="category-manager-name">${cat.name}</span>
            </div>
            <div class="category-manager-actions">
                <button class="btn-category-action edit-cat-btn" title="Rename">✏️</button>
                <button class="btn-category-action delete-cat-btn" title="Delete">🗑️</button>
            </div>
        `;
        
        const editBtn = item.querySelector('.edit-cat-btn');
        if (editBtn) {
            editBtn.onclick = (e) => {
                e.stopPropagation();
                
                const infoDiv = item.querySelector('.category-manager-info');
                const actionsDiv = item.querySelector('.category-manager-actions');
                if (!infoDiv || !actionsDiv) return;
                
                const originalName = cat.name;
                
                // Switch to inline editor mode
                infoDiv.innerHTML = `
                    <span class="category-manager-color-bubble" style="background-color: ${cat.color}; color: ${cat.color};"></span>
                    <input type="text" class="category-manager-edit-input" value="${originalName}" maxlength="15" style="
                        background: rgba(0, 0, 0, 0.4);
                        border: 1px solid var(--accent-color);
                        border-radius: 6px;
                        color: var(--text-primary);
                        padding: 3px 8px;
                        font-size: 13px;
                        font-family: inherit;
                        width: 140px;
                        outline: none;
                        box-shadow: 0 0 10px rgba(249, 115, 22, 0.15);
                        transition: all 0.2s;
                    ">
                `;
                
                actionsDiv.innerHTML = `
                    <button class="btn-category-action save-edit-btn" title="Save" style="color: #10b981; font-weight: bold; font-size: 13px; padding: 4px 6px;">✔️</button>
                    <button class="btn-category-action cancel-edit-btn" title="Cancel" style="color: #ef4444; font-weight: bold; font-size: 13px; padding: 4px 6px;">❌</button>
                `;
                
                const input = infoDiv.querySelector('.category-manager-edit-input');
                input.focus();
                input.select();
                
                const saveFn = async () => {
                    const newName = input.value.trim();
                    if (!newName) {
                        alert('Category name cannot be empty.');
                        return;
                    }
                    
                    if (newName.length > 15) {
                        alert('Category name must be 15 characters or less.');
                        return;
                    }
                    
                    if (newName === originalName) {
                        renderCategoriesList();
                        return;
                    }
                    
                    // Uniqueness check
                    const exists = currentCategories.some(c => c.id !== cat.id && c.name.toLowerCase() === newName.toLowerCase());
                    if (exists) {
                        alert(`A category named "${newName}" already exists.`);
                        return;
                    }
                    
                    const updatedCategory = {
                        id: cat.id,
                        name: newName,
                        color: cat.color,
                        order_seq: cat.order_seq,
                        owner_id: currentUser.id,
                        created_at: cat.created_at
                    };
                    
                    try {
                        await invoke('plugin:minutes|save_category', { category: updatedCategory });
                        await refreshCategories();
                        renderCategoriesList();
                        await refreshMinutes();
                    } catch (err) {
                        alert(err.toString());
                    }
                };
                
                input.onkeydown = (ev) => {
                    if (ev.key === 'Enter') {
                        saveFn();
                    } else if (ev.key === 'Escape') {
                        // Prevent the Escape key from closing the whole modal, just close the inline edit
                        ev.stopPropagation();
                        renderCategoriesList();
                    }
                };
                
                // Also prevent general keydowns from propagating up to window when typing in this input
                input.onkeyup = (ev) => {
                    if (ev.key === 'Escape') {
                        ev.stopPropagation();
                    }
                };
                
                actionsDiv.querySelector('.save-edit-btn').onclick = (ev) => {
                    ev.stopPropagation();
                    saveFn();
                };
                
                actionsDiv.querySelector('.cancel-edit-btn').onclick = (ev) => {
                    ev.stopPropagation();
                    renderCategoriesList();
                };
            };
        }
        
        const delBtn = item.querySelector('.delete-cat-btn');
        if (delBtn) {
            delBtn.onclick = async () => {
                if (await askConfirm(`Are you sure you want to delete category "${cat.name}"?\nAssociated minutes will be uncategorized.`)) {
                    try {
                        await invoke('plugin:minutes|delete_category', { categoryId: cat.id });
                        await refreshCategories();
                        renderCategoriesList();
                        await refreshMinutes();
                    } catch (err) {
                        alert(err.toString());
                    }
                }
            };
        }
        
        container.appendChild(item);
    });
    
    // Update badge count
    const countBadge = document.getElementById('category-count-badge');
    if (countBadge) {
        countBadge.textContent = `${currentCategories.length} / 50`;
    }
}

async function addCategory() {
    const nameInput = document.getElementById('new-category-name');
    const colorInput = document.getElementById('new-category-color');
    if (!nameInput || !colorInput) return;
    
    const name = nameInput.value.trim();
    const color = colorInput.value;
    
    if (!name) {
        alert('Please enter a category name.');
        return;
    }
    
    if (currentCategories.length >= 50) {
        alert('You have reached the maximum limit of 50 categories.');
        return;
    }
    
    const category = {
        name: name,
        color: color,
        order_seq: currentCategories.length + 1,
        owner_id: currentUser.id,
        created_at: new Date().toISOString()
    };
    
    try {
        await invoke('plugin:minutes|save_category', { category });
        nameInput.value = '';
        await refreshCategories();
        renderCategoriesList();
        await refreshMinutes();
    } catch (err) {
        alert(err.toString());
    }
}

function setupRag() {
    const btnSelectPdf = document.getElementById('btn-rag-select-pdf');
    const inputPdfPath = document.getElementById('rag-pdf-path');
    const btnSelectDir = document.getElementById('btn-rag-select-dir');
    const inputOutputDir = document.getElementById('rag-output-dir');
    const selectFormat = document.getElementById('rag-output-format');
    const btnRunParse = document.getElementById('btn-rag-run-parse');
    const btnCopyOutput = document.getElementById('btn-rag-copy-output');
    const ragLoader = document.getElementById('rag-loader');
    const ragOutputContainer = document.getElementById('rag-output-container');
    const ragOutputPre = document.getElementById('rag-output-pre');

    const btnIndexDb = document.getElementById('btn-rag-index-db');

    // Excel Extraction Elements
    const ragExtractionTabs = document.getElementById('rag-extraction-tabs');
    const ragPdfPanel = document.getElementById('rag-pdf-panel');
    const ragExcelPanel = document.getElementById('rag-excel-panel');
    const inputExcelPath = document.getElementById('rag-excel-path');
    const btnSelectExcel = document.getElementById('btn-rag-select-excel');
    const btnRunExcel = document.getElementById('btn-rag-run-excel');
    const selectExcelSheet = document.getElementById('rag-excel-sheet-select');

    // PDF Folder Extraction Elements
    const ragPdfFolderPanel = document.getElementById('rag-pdf-folder-panel');
    const btnSelectPdfFolder = document.getElementById('btn-rag-select-pdf-folder');
    const inputPdfFolderSrcPath = document.getElementById('rag-pdf-folder-src-path');
    const btnSelectPdfFolderOut = document.getElementById('btn-rag-select-pdf-folder-out');
    const inputPdfFolderOutPath = document.getElementById('rag-pdf-folder-out-path');
    const selectPdfFolderFormat = document.getElementById('rag-pdf-folder-format');
    const btnRunFolderParse = document.getElementById('btn-rag-run-folder-parse');
    const btnAbortFolderParse = document.getElementById('btn-rag-abort-folder-parse');

    const progressContainer = document.getElementById('rag-folder-progress-container');
    const progressGifContainer = document.getElementById('rag-folder-progress-gif-container');
    const progressStatus = document.getElementById('rag-folder-progress-status');
    const progressPercent = document.getElementById('rag-folder-progress-percent');
    const progressBar = document.getElementById('rag-folder-progress-bar');
    const progressFiles = document.getElementById('rag-folder-progress-files');

    if (!btnSelectPdf || !inputPdfPath || !btnSelectDir || !inputOutputDir || !selectFormat || 
        !btnRunParse || !btnCopyOutput || !ragLoader || !ragOutputContainer || !ragOutputPre ||
        !btnIndexDb) {
        console.warn("RAG & PDF Parser UI elements not fully found in DOM.");
        return;
    }

    // ─── Tab Switching Logic ───
    let cachedExcelSheets = null; // Cache parsed Excel worksheet data
    let activeExcelSource = ''; // Track active Excel file name for catalog naming

    if (ragExtractionTabs && ragPdfPanel && ragExcelPanel) {
        const tabButtons = ragExtractionTabs.querySelectorAll('.view-tab[data-rag-tab]');
        tabButtons.forEach(btn => {
            btn.onclick = () => {
                tabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const target = btn.getAttribute('data-rag-tab');
                if (target === 'pdf') {
                    ragPdfPanel.style.display = '';
                    if (ragPdfFolderPanel) ragPdfFolderPanel.style.display = 'none';
                    ragExcelPanel.style.display = 'none';
                } else if (target === 'pdf-folder') {
                    ragPdfPanel.style.display = 'none';
                    if (ragPdfFolderPanel) ragPdfFolderPanel.style.display = '';
                    ragExcelPanel.style.display = 'none';
                } else {
                    ragPdfPanel.style.display = 'none';
                    if (ragPdfFolderPanel) ragPdfFolderPanel.style.display = 'none';
                    ragExcelPanel.style.display = '';
                }
            };
        });
    }

    // ─── PDF Folder Selection & Processing Logic ───
    if (btnSelectPdfFolder && inputPdfFolderSrcPath) {
        btnSelectPdfFolder.onclick = async () => {
            try {
                if (!window.__TAURI__ || !window.__TAURI__.dialog) {
                    alert("Tauri dialog API는 지원되지 않는 환경입니다.");
                    return;
                }
                const dir = await window.__TAURI__.dialog.open({
                    directory: true,
                    multiple: false,
                    title: "파싱할 입력 폴더 선택"
                });
                if (dir) {
                    inputPdfFolderSrcPath.value = dir;
                }
            } catch (err) {
                console.error("입력 폴더 선택 오류:", err);
                alert("폴더 선택 오류: " + err);
            }
        };
    }

    if (btnSelectPdfFolderOut && inputPdfFolderOutPath) {
        btnSelectPdfFolderOut.onclick = async () => {
            try {
                if (!window.__TAURI__ || !window.__TAURI__.dialog) {
                    alert("Tauri dialog API는 지원되지 않는 환경입니다.");
                    return;
                }
                const dir = await window.__TAURI__.dialog.open({
                    directory: true,
                    multiple: false,
                    title: "파싱 결과를 저장할 출력 폴더 선택"
                });
                if (dir) {
                    inputPdfFolderOutPath.value = dir;
                }
            } catch (err) {
                console.error("출력 폴더 선택 오류:", err);
                alert("출력 폴더 선택 오류: " + err);
            }
        };
    }

    if (btnRunFolderParse && inputPdfFolderSrcPath) {
        btnRunFolderParse.onclick = async () => {
            const srcPath = inputPdfFolderSrcPath.value.trim();
            const outPath = inputPdfFolderOutPath.value.trim();
            const format = selectPdfFolderFormat ? selectPdfFolderFormat.value : 'json';

            if (!srcPath) {
                alert("파싱할 입력 폴더를 지정해 주세요.");
                return;
            }

            // 결과 카드 펼치기
            expandResultCard();

            // 진행률 UI 초기화
            if (progressContainer) progressContainer.style.display = 'block';
            if (progressGifContainer) progressGifContainer.style.display = 'flex';
            if (progressStatus) progressStatus.textContent = "입력 폴더에서 PDF 파일 목록을 검색하고 있습니다...";
            if (progressPercent) progressPercent.textContent = "0%";
            if (progressBar) progressBar.style.width = "0%";
            if (progressFiles) progressFiles.textContent = "(0 / 0 파일 완료)";

            btnRunFolderParse.disabled = true;

            // 진행 중지 버튼 활성화 및 바인딩
            let isFolderParseAborted = false;
            if (btnAbortFolderParse) {
                btnAbortFolderParse.style.display = 'flex';
                btnAbortFolderParse.disabled = false;
                btnAbortFolderParse.onclick = () => {
                    isFolderParseAborted = true;
                    btnAbortFolderParse.disabled = true;
                    if (progressStatus) progressStatus.textContent = "작업 중지 요청 중...";
                    ragOutputPre.textContent += `\n[중지 요청] 사용자가 중지 버튼을 누르셨습니다. 현재 파일 파싱 완료 후 작업이 중단됩니다...\n`;
                    ragOutputContainer.scrollTop = ragOutputContainer.scrollHeight;
                };
            }

            ragLoader.style.display = 'none';
            ragOutputContainer.style.display = 'flex';
            btnCopyOutput.style.display = 'none';
            btnIndexDb.style.display = 'none';
            ragOutputPre.textContent = '일괄 파싱을 준비 중입니다...';

            try {
                // Rust 백엔드를 통해 PDF 파일 리스트 획득
                console.log(`[RAG UI] Retrieving PDF files in: ${srcPath}`);
                const pdfFiles = await invoke('plugin:rag|get_pdf_files_in_folder', { folderPath: srcPath });

                if (!pdfFiles || pdfFiles.length === 0) {
                    if (progressStatus) progressStatus.textContent = "오류: 폴더에 PDF 파일이 없습니다.";
                    if (progressGifContainer) progressGifContainer.style.display = 'none';
                    if (btnAbortFolderParse) btnAbortFolderParse.style.display = 'none';
                    ragOutputPre.textContent = `[알림] 입력 폴더 내에 PDF 파일(.pdf)이 존재하지 않습니다.\n대상 폴더: ${srcPath}`;
                    alert("선택하신 폴더 내에 PDF 파일이 존재하지 않습니다.");
                    btnRunFolderParse.disabled = false;
                    return;
                }

                const totalFiles = pdfFiles.length;
                if (progressStatus) progressStatus.textContent = `총 ${totalFiles}개의 PDF 파일을 발견했습니다. 파싱을 시작합니다...`;
                if (progressFiles) progressFiles.textContent = `(0 / ${totalFiles} 파일 완료)`;
                ragOutputPre.textContent = `발견된 PDF 파일 수: ${totalFiles}개\n파싱 작업을 시작합니다...\n\n`;

                let successCount = 0;
                let failCount = 0;
                let resultsSummary = [];

                // 순차적으로 비동기 파싱 실행
                for (let i = 0; i < totalFiles; i++) {
                    if (isFolderParseAborted) {
                        ragOutputPre.textContent += `\n[알림] 사용자에 의해 일괄 파싱 작업이 중단되었습니다.\n`;
                        resultsSummary.push(`- [중단됨] 남은 ${totalFiles - i}개 파일은 파싱되지 않았습니다.`);
                        break;
                    }
                    const filePath = pdfFiles[i];
                    const sepIdx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
                    const fileName = sepIdx !== -1 ? filePath.substring(sepIdx + 1) : filePath;

                    if (progressStatus) {
                        progressStatus.textContent = `파싱 중 (${i + 1}/${totalFiles}): ${fileName}`;
                    }
                    ragOutputPre.textContent += `[${i + 1}/${totalFiles}] "${fileName}" 파싱 중...\n`;
                    ragOutputContainer.scrollTop = ragOutputContainer.scrollHeight;

                    try {
                        const res = await invoke('plugin:rag|invoke_sidecar_test', {
                            filePath: filePath,
                            format: format,
                            outputDir: outPath ? outPath : undefined
                        });

                        if (res && res.status === 'success') {
                            successCount++;
                            resultsSummary.push(`- [성공] ${fileName}`);
                            ragOutputPre.textContent += `  => 성공!\n`;
                        } else {
                            failCount++;
                            resultsSummary.push(`- [실패] ${fileName} (원인: 알 수 없음)`);
                            ragOutputPre.textContent += `  => 실패 (알 수 없는 결과)\n`;
                        }
                    } catch (fileErr) {
                        console.error(`Error parsing file ${filePath}:`, fileErr);
                        failCount++;
                        resultsSummary.push(`- [실패] ${fileName} (오류: ${fileErr})`);
                        ragOutputPre.textContent += `  => 실패 (오류: ${fileErr})\n`;
                    }

                    // 프로그레스 바 및 % 갱신
                    const currentCompleted = i + 1;
                    const percent = Math.round((currentCompleted / totalFiles) * 100);
                    if (progressPercent) progressPercent.textContent = `${percent}%`;
                    if (progressBar) progressBar.style.width = `${percent}%`;
                    if (progressFiles) progressFiles.textContent = `(${currentCompleted} / ${totalFiles} 파일 완료)`;
                    ragOutputContainer.scrollTop = ragOutputContainer.scrollHeight;
                }

                // 완료 보고서 작성
                if (progressStatus) {
                    progressStatus.textContent = `일괄 파싱 완료! (성공: ${successCount}, 실패: ${failCount})`;
                }
                
                const finalReport = `========================================\n` +
                                    `📂 폴더 일괄 파싱 작업 완료 보고서\n` +
                                    `========================================\n` +
                                    `- 대상 입력 폴더: ${srcPath}\n` +
                                    `- 저장 출력 폴더: ${outPath || '입력 폴더와 동일'}\n` +
                                    `- 출력 형식: ${format.toUpperCase()}\n` +
                                    `- 총 대상 파일: ${totalFiles}개\n` +
                                    `- 파싱 성공: ${successCount}개\n` +
                                    `- 파싱 실패: ${failCount}개\n\n` +
                                    `[세부 파일별 결과]\n` +
                                    resultsSummary.join('\n') + `\n`;
                
                ragOutputPre.textContent = finalReport;
                ragOutputContainer.scrollTop = 0;

            } catch (err) {
                console.error("폴더 일괄 파싱 전역 오류:", err);
                if (progressStatus) progressStatus.textContent = "오류: 일괄 작업 중 예외가 발생했습니다.";
                ragOutputPre.textContent = `[전역 오류] 작업을 실행하는 동안 예외가 발생했습니다:\n\n${err}`;
            } finally {
                if (progressGifContainer) progressGifContainer.style.display = 'none';
                if (btnAbortFolderParse) btnAbortFolderParse.style.display = 'none';
                btnRunFolderParse.disabled = false;
            }
        };
    }

    // ─── Excel File Selection ───
    if (btnSelectExcel && inputExcelPath) {
        btnSelectExcel.onclick = async () => {
            try {
                if (!window.__TAURI__ || !window.__TAURI__.dialog) {
                    alert("Tauri dialog API is not supported in this environment.");
                    return;
                }
                const file = await window.__TAURI__.dialog.open({
                    directory: false,
                    multiple: false,
                    title: "Select Excel / Spreadsheet File",
                    filters: [{ name: 'Spreadsheet Files', extensions: ['xlsx', 'xls', 'xlsb', 'ods'] }]
                });
                if (file) {
                    inputExcelPath.value = file;
                    // Reset sheet selector when a new file is chosen
                    if (selectExcelSheet) {
                        selectExcelSheet.innerHTML = '<option value="" disabled selected>— Parse a file first —</option>';
                    }
                    cachedExcelSheets = null;
                }
            } catch (err) {
                console.error("Excel Selection Error:", err);
                alert("Error selecting file: " + err);
            }
        };
    }

    // ─── Excel Parse Handler ───
    if (btnRunExcel && inputExcelPath && selectExcelSheet) {
        btnRunExcel.onclick = async () => {
            const filePath = inputExcelPath.value.trim();
            if (!filePath) {
                alert("Please select an Excel file to parse.");
                return;
            }

            // Ensure result card is expanded to show progress
            expandResultCard();

            // Throttling: Disable button and show spinner
            btnRunExcel.disabled = true;
            ragLoader.style.display = 'flex';
            ragOutputContainer.style.display = 'none';
            btnCopyOutput.style.display = 'none';
            btnIndexDb.style.display = 'none';
            ragOutputPre.textContent = '';

            try {
                console.log(`[RAG UI] Launching Excel parse for ${filePath}`);
                const res = await invoke('plugin:rag|parse_excel', { filePath });

                if (res && res.status === 'success') {
                    cachedExcelSheets = res.sheets || {};
                    const sheetNames = res.sheet_names || Object.keys(cachedExcelSheets);

                    // Extract file name for catalog naming
                    const sepIdx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
                    activeExcelSource = sepIdx !== -1 ? filePath.substring(sepIdx + 1) : filePath;

                    // Populate sheet dropdown
                    selectExcelSheet.innerHTML = '';
                    sheetNames.forEach((name, idx) => {
                        const opt = document.createElement('option');
                        opt.value = name;
                        opt.textContent = name;
                        if (idx === 0) opt.selected = true;
                        selectExcelSheet.appendChild(opt);
                    });

                    // Display first sheet data
                    const firstSheet = sheetNames[0];
                    if (firstSheet && cachedExcelSheets[firstSheet]) {
                        const prettyJson = JSON.stringify(cachedExcelSheets[firstSheet], null, 2);
                        ragOutputPre.textContent = prettyJson;
                    } else {
                        ragOutputPre.textContent = '(No data found in workbook)';
                    }

                    btnCopyOutput.style.display = 'inline-block';
                    btnIndexDb.style.display = 'inline-flex';
                } else {
                    throw new Error(res ? res.message || 'Unknown error' : 'Invalid result');
                }
            } catch (err) {
                console.error("Excel parsing failed:", err);
                ragOutputPre.textContent = `[Error] Failed to parse Excel file:\n\n${err}`;
                btnCopyOutput.style.display = 'none';
                btnIndexDb.style.display = 'none';
            } finally {
                btnRunExcel.disabled = false;
                ragLoader.style.display = 'none';
                ragOutputContainer.style.display = 'flex';
            }
        };
    }

    // ─── Sheet Dropdown Change → Update Preview ───
    if (selectExcelSheet) {
        selectExcelSheet.onchange = () => {
            if (!cachedExcelSheets) return;
            const selectedSheet = selectExcelSheet.value;
            if (selectedSheet && cachedExcelSheets[selectedSheet]) {
                ragOutputPre.textContent = JSON.stringify(cachedExcelSheets[selectedSheet], null, 2);
                btnCopyOutput.style.display = 'inline-block';
                btnIndexDb.style.display = 'inline-flex';
            }
        };
    }

    // Collapsible Result Section Elements
    const resultCard = document.getElementById('rag-result-card');
    const resultHeader = document.getElementById('rag-result-header');
    const resultToggleIcon = document.getElementById('rag-result-toggle-icon');
    const resultBody = document.getElementById('rag-result-body');
    let isCollapsed = false;

    const expandResultCard = () => {
        if (resultCard && resultBody && resultToggleIcon && isCollapsed) {
            isCollapsed = false;
            resultBody.style.maxHeight = '2000px';
            resultBody.style.opacity = '1';
            resultBody.style.marginTop = '16px';
            resultCard.style.minHeight = '400px';
            resultToggleIcon.style.transform = 'rotate(0deg)';
        }
    };

    if (resultCard && resultHeader && resultToggleIcon && resultBody) {
        resultHeader.onclick = () => {
            isCollapsed = !isCollapsed;
            if (isCollapsed) {
                // Collapse state
                resultBody.style.maxHeight = '0px';
                resultBody.style.opacity = '0';
                resultBody.style.marginTop = '0px';
                resultCard.style.minHeight = 'auto';
                resultToggleIcon.style.transform = 'rotate(-90deg)';
            } else {
                // Expand state
                resultBody.style.maxHeight = '2000px';
                resultBody.style.opacity = '1';
                resultBody.style.marginTop = '16px';
                resultCard.style.minHeight = '400px';
                resultToggleIcon.style.transform = 'rotate(0deg)';
            }
        };
    }

    // PDF selection - idempotent assignment (.onclick)
    btnSelectPdf.onclick = async () => {
        try {
            if (!window.__TAURI__ || !window.__TAURI__.dialog) {
                console.error("Tauri dialog API not available.");
                alert("Tauri dialog API is not supported in this environment.");
                return;
            }
            
            const file = await window.__TAURI__.dialog.open({
                directory: false,
                multiple: false,
                title: "Select PDF File to Parse",
                filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
            });
            
            if (file) {
                inputPdfPath.value = file;
            }
        } catch (err) {
            console.error("PDF Selection Error:", err);
            alert("Error selecting file: " + err);
        }
    };

    // Output Directory selection - idempotent assignment (.onclick)
    btnSelectDir.onclick = async () => {
        try {
            if (!window.__TAURI__ || !window.__TAURI__.dialog) {
                console.error("Tauri dialog API not available.");
                alert("Tauri dialog API is not supported in this environment.");
                return;
            }
            
            const dir = await window.__TAURI__.dialog.open({
                directory: true,
                multiple: false,
                title: "Select Output Folder for Extracted Specs"
            });
            
            if (dir) {
                inputOutputDir.value = dir;
            }
        } catch (err) {
            console.error("Output Directory Selection Error:", err);
            alert("Error selecting output folder: " + err);
        }
    };

    // Run PDF parser sidecar - idempotent assignment (.onclick) with Throttling & Try-Finally
    btnRunParse.onclick = async () => {
        const filePath = inputPdfPath.value.trim();
        const outputDir = inputOutputDir.value.trim();
        if (!filePath) {
            alert("Please select a PDF file to parse.");
            return;
        }

        // Ensure result card is expanded to show progress
        expandResultCard();

        // Throttling: Disable button and show spinner
        btnRunParse.disabled = true;
        ragLoader.style.display = 'flex';
        ragOutputContainer.style.display = 'none';
        btnCopyOutput.style.display = 'none';
        btnIndexDb.style.display = 'none';
        ragOutputPre.textContent = '';

        try {
            const format = selectFormat.value; // json, markdown, text, html
            console.log(`[RAG UI] Launching sidecar parse for ${filePath} with format ${format}, outputDir: ${outputDir}`);
            
            const res = await invoke('plugin:rag|invoke_sidecar_test', {
                filePath: filePath, // camelCase argument
                format: format,
                outputDir: outputDir ? outputDir : undefined // camelCase argument
            });

            if (res && res.status === 'success') {
                let parsedOutput = res.stdout || '';
                
                // Pretty-print JSON if needed for elegant styling
                if (format === 'json' && parsedOutput) {
                    try {
                        const parsedJson = JSON.parse(parsedOutput);
                        parsedOutput = JSON.stringify(parsedJson, null, 2);
                    } catch (e) {
                        console.warn("[RAG UI] Output format is JSON but failed to parse JSON string. Showing raw stdout.", e);
                    }
                }
                
                ragOutputPre.textContent = parsedOutput;
                btnCopyOutput.style.display = 'inline-block';
                
                // Show Index button if format is JSON and output is valid
                if (format === 'json') {
                    btnIndexDb.style.display = 'inline-flex';
                }
            } else {
                throw new Error(res ? res.stderr || 'An unknown error occurred.' : 'Invalid output result.');
            }
        } catch (err) {
            console.error("PDF parsing failed:", err);
            ragOutputPre.textContent = `[Error] Failed to extract specifications:\n\n${err}`;
            btnCopyOutput.style.display = 'none';
            btnIndexDb.style.display = 'none';
        } finally {
            // Throttling Cleanup: Re-enable trigger button and hide loader
            btnRunParse.disabled = false;
            ragLoader.style.display = 'none';
            ragOutputContainer.style.display = 'flex';
        }
    };

    // Copy to clipboard - idempotent assignment (.onclick)
    btnCopyOutput.onclick = async () => {
        const text = ragOutputPre.textContent.trim();
        if (!text || text.startsWith('(The extracted specifications')) {
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            
            // Rich Visual Feedback for Copying
            const originalText = btnCopyOutput.innerHTML;
            btnCopyOutput.innerHTML = '✅ Copied!';
            btnCopyOutput.disabled = true;
            
            setTimeout(() => {
                btnCopyOutput.innerHTML = originalText;
                btnCopyOutput.disabled = false;
            }, 1500);
        } catch (err) {
            console.error("Clipboard copy failed:", err);
            alert("Error copying to clipboard: " + err);
        }
    };

    // Index parsed JSON content to SQLite & LanceDB
    btnIndexDb.onclick = async () => {
        const textContent = ragOutputPre.textContent.trim();
        if (!textContent || textContent.startsWith('(The extracted specifications')) {
            alert("No parsed JSON specifications to index.");
            return;
        }

        // Determine catalog name based on active source (PDF or Excel)
        let fileName = "Unknown Catalog";
        const pdfPath = inputPdfPath.value.trim();
        const excelPath = inputExcelPath ? inputExcelPath.value.trim() : '';

        if (activeExcelSource && cachedExcelSheets && selectExcelSheet && selectExcelSheet.value) {
            // Excel tab was the source — include sheet name for traceability
            fileName = `${activeExcelSource} (${selectExcelSheet.value})`;
        } else if (pdfPath) {
            const separatorIdx = Math.max(pdfPath.lastIndexOf('/'), pdfPath.lastIndexOf('\\'));
            fileName = separatorIdx !== -1 ? pdfPath.substring(separatorIdx + 1) : pdfPath;
        }

        btnIndexDb.disabled = true;
        const originalHtml = btnIndexDb.innerHTML;
        btnIndexDb.innerHTML = "⚡ Indexing...";

        try {
            console.log(`[RAG UI] Indexing parsed specifications for catalog: ${fileName}`);
            const res = await invoke('plugin:rag|index_parsed_specs', {
                jsonContent: textContent,
                catalogName: fileName
            });

            if (res && res.status === 'success') {
                alert(`Successfully indexed specifications!\n\n${res.message || ''}`);
                btnIndexDb.innerHTML = "✅ Indexed!";
                setTimeout(() => {
                    btnIndexDb.innerHTML = "⚡ Index to DB";
                }, 2000);
            } else {
                throw new Error(res ? res.message || 'An unknown error occurred during indexing.' : 'Invalid response.');
            }
        } catch (err) {
            console.error("Indexing failed:", err);
            alert("Error indexing specifications to DB:\n\n" + err);
            btnIndexDb.innerHTML = originalHtml;
        } finally {
            btnIndexDb.disabled = false;
        }
    };


}

// ===== HISTORY MANAGER (Oxigraph + D3.js Knowledge Graph) =====

let d3Simulation = null;

function setupHistory() {
    const accordionHeader = document.getElementById('history-accordion-header');
    const accordionBody = document.getElementById('history-accordion-body');
    const accordionIcon = document.getElementById('history-accordion-icon');

    // 1. Ingest document accordion toggle
    if (accordionHeader && accordionBody && accordionIcon) {
        accordionHeader.onclick = () => {
            const isHidden = accordionBody.style.display === 'none';
            accordionBody.style.display = isHidden ? 'flex' : 'none';
            accordionIcon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
        };
        // Initial state
        accordionBody.style.display = 'none';
    }

    // 2. Select BOM Excel file
    const btnSelectBomExcel = document.getElementById('btn-history-select-bom-excel');
    const inputBomExcelPath = document.getElementById('history-bom-excel-path');
    if (btnSelectBomExcel && inputBomExcelPath) {
        btnSelectBomExcel.onclick = async () => {
            if (!window.__TAURI__ || !window.__TAURI__.dialog) {
                alert("Tauri dialog API not available.");
                return;
            }
            try {
                const selected = await window.__TAURI__.dialog.open({
                    multiple: false,
                    directory: false,
                    filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }]
                });
                if (selected) {
                    inputBomExcelPath.value = selected;
                }
            } catch (err) {
                console.error("Failed to select Excel BOM file:", err);
            }
        };
    }

    // 3. Select Doc PDF file
    const btnSelectDocPdf = document.getElementById('btn-history-select-doc-pdf');
    const inputDocPdfPath = document.getElementById('history-doc-pdf-path');
    if (btnSelectDocPdf && inputDocPdfPath) {
        btnSelectDocPdf.onclick = async () => {
            if (!window.__TAURI__ || !window.__TAURI__.dialog) {
                alert("Tauri dialog API not available.");
                return;
            }
            try {
                const selected = await window.__TAURI__.dialog.open({
                    multiple: false,
                    directory: false,
                    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
                });
                if (selected) {
                    inputDocPdfPath.value = selected;
                }
            } catch (err) {
                console.error("Failed to select PDF document:", err);
            }
        };
    }

    // 4. Project registration submit
    const btnRegisterProj = document.getElementById('btn-history-register-proj');
    if (btnRegisterProj) {
        btnRegisterProj.onclick = async () => {
            const code = document.getElementById('history-proj-code').value.trim();
            const name = document.getElementById('history-proj-name').value.trim();
            const manager = document.getElementById('history-proj-manager').value.trim();
            const customer = document.getElementById('history-proj-customer').value.trim();
            const desc = document.getElementById('history-proj-desc').value.trim();

            if (!code || !name || !manager || !customer) {
                alert("필수 입력 항목(*)을 모두 입력해 주세요.");
                return;
            }

            btnRegisterProj.disabled = true;
            try {
                const result = await invoke('plugin:knowledge|register_project', {
                    projectCode: code,
                    projectName: name,
                    manager: manager,
                    customer: customer,
                    description: desc || null
                });
                alert("프로젝트가 성공적으로 등록되었습니다!");
                
                // Clear Form
                document.getElementById('history-proj-code').value = "";
                document.getElementById('history-proj-name').value = "";
                document.getElementById('history-proj-manager').value = "";
                document.getElementById('history-proj-customer').value = "";
                document.getElementById('history-proj-desc').value = "";

                await refreshHistory();
            } catch (err) {
                alert("프로젝트 등록 실패: " + err);
            } finally {
                btnRegisterProj.disabled = false;
            }
        };
    }

    // 5. Ingest BOM submit
    const btnIngestBom = document.getElementById('btn-history-ingest-bom');
    const bomProjSelect = document.getElementById('history-bom-proj-select');
    if (btnIngestBom) {
        btnIngestBom.onclick = async () => {
            const projectCode = bomProjSelect.value;
            const excelPath = inputBomExcelPath.value.trim();

            if (!projectCode) {
                alert("대상 프로젝트를 선택해 주세요.");
                return;
            }
            if (!excelPath) {
                alert("BOM 엑셀 파일을 선택해 주세요.");
                return;
            }

            btnIngestBom.disabled = true;
            btnIngestBom.innerHTML = "<span>⚡</span> BOM 지식 적재 중...";
            try {
                const result = await invoke('plugin:knowledge|ingest_bom', {
                    projectCode: projectCode,
                    excelPath: excelPath
                });
                alert(`BOM 지식 적재 성공! (총 ${result.processed_rows}개 항목)`);
                inputBomExcelPath.value = "";
                await refreshHistory();
            } catch (err) {
                alert("BOM 적재 실패: " + err);
            } finally {
                btnIngestBom.disabled = false;
                btnIngestBom.innerHTML = "<span>⚡</span> BOM 데이터 지식 적재";
            }
        };
    }

    // 6. Ingest Document submit
    const btnIngestDoc = document.getElementById('btn-history-ingest-doc');
    const docProjSelect = document.getElementById('history-doc-proj-select');
    const docTypeSelect = document.getElementById('history-doc-type');
    if (btnIngestDoc) {
        btnIngestDoc.onclick = async () => {
            const projectCode = docProjSelect.value;
            const docType = docTypeSelect.value;
            const filePath = inputDocPdfPath.value.trim();

            if (!projectCode) {
                alert("대상 프로젝트를 선택해 주세요.");
                return;
            }
            if (!filePath) {
                alert("산출물 PDF 파일을 선택해 주세요.");
                return;
            }

            btnIngestDoc.disabled = true;
            btnIngestDoc.innerHTML = "<span>⚡</span> PDF 분석 및 벡터 인덱싱 중...";
            try {
                const result = await invoke('plugin:knowledge|ingest_project_document', {
                    projectCode: projectCode,
                    docType: docType,
                    filePath: filePath
                });
                alert(`산출물 벡터 인덱싱 성공! (총 ${result.chunks_indexed}개 청크 적재)`);
                inputDocPdfPath.value = "";
                await refreshHistory();
            } catch (err) {
                alert("산출물 인덱싱 실패: " + err);
            } finally {
                btnIngestDoc.disabled = false;
                btnIngestDoc.innerHTML = "<span>⚡</span> 산출물 텍스트 벡터 인덱싱";
            }
        };
    }

    // 7. 지식 데이터베이스(DB) 검색 실행
    let activeKnowledgeComponents = [];
    let currentKnowledgeTitle = "부품목록";

    const btnRunSparql = document.getElementById('btn-history-run-sparql');
    const btnViewComponents = document.getElementById('btn-history-view-components');
    const inputKeyword = document.getElementById('history-db-search-keyword');
    const selectProject = document.getElementById('history-db-search-proj-select');
    const tbodyResult = document.getElementById('history-sparql-tbody');
    const tableResult = document.getElementById('history-sparql-table');

    if (btnRunSparql && inputKeyword && tbodyResult) {
        btnRunSparql.onclick = async () => {
            const keyword = inputKeyword.value.trim();
            const projectCode = selectProject ? selectProject.value : "";
            btnRunSparql.disabled = true;
            tbodyResult.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--accent-color); padding: 24px;">지식 데이터베이스 검색 중...</td></tr>`;

            // 키워드가 있으면 대소문자 구분 없이 필터링 쿼리 생성, 없으면 전체 조회 쿼리 생성
            let queryStr = "";
            const safeKeyword = keyword.replace(/"/g, '\\"');

            if (!projectCode) {
                // 1) 전체 프로젝트 대상 검색
                if (!keyword) {
                    queryStr = `PREFIX wa: <http://workassist.local/ontology/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT DISTINCT ?대상 ?속성명 ?값 WHERE {
  ?대상 ?속성명 ?값 .
} LIMIT 50`;
                } else {
                    queryStr = `PREFIX wa: <http://workassist.local/ontology/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT DISTINCT ?대상 ?속성명 ?값 WHERE {
  ?대상 ?속성명 ?값 .
  FILTER (
    CONTAINS(LCASE(STR(?대상)), LCASE("${safeKeyword}")) ||
    CONTAINS(LCASE(STR(?속성명)), LCASE("${safeKeyword}")) ||
    CONTAINS(LCASE(STR(?값)), LCASE("${safeKeyword}"))
  )
} LIMIT 100`;
                }
            } else {
                // 2) 특정 프로젝트 범위 내 검색 (BOM 아이템 및 관련 컴포넌트, 프로젝트 메타데이터까지 아우름)
                const sanitizedCode = projectCode.trim().replace(/ /g, "_");
                if (!keyword) {
                    queryStr = `PREFIX wa: <http://workassist.local/ontology/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT DISTINCT ?대상 ?속성명 ?값 WHERE {
  {
    BIND(wa:Project_${sanitizedCode} AS ?대상)
    ?대상 ?속성명 ?값 .
  } UNION {
    wa:Project_${sanitizedCode} wa:hasBOMItem ?대상 .
    ?대상 ?속성명 ?값 .
  } UNION {
    wa:Project_${sanitizedCode} wa:hasBOMItem ?bom .
    ?bom wa:refersToComponent ?대상 .
    ?대상 ?속성명 ?값 .
  }
} LIMIT 50`;
                } else {
                    queryStr = `PREFIX wa: <http://workassist.local/ontology/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT DISTINCT ?대상 ?속성명 ?값 WHERE {
  {
    BIND(wa:Project_${sanitizedCode} AS ?대상)
    ?대상 ?속성명 ?값 .
  } UNION {
    wa:Project_${sanitizedCode} wa:hasBOMItem ?대상 .
    ?대상 ?속성명 ?값 .
  } UNION {
    wa:Project_${sanitizedCode} wa:hasBOMItem ?bom .
    ?bom wa:refersToComponent ?대상 .
    ?대상 ?속성명 ?값 .
  }
  FILTER (
    CONTAINS(LCASE(STR(?대상)), LCASE("${safeKeyword}")) ||
    CONTAINS(LCASE(STR(?속성명)), LCASE("${safeKeyword}")) ||
    CONTAINS(LCASE(STR(?값)), LCASE("${safeKeyword}"))
  )
} LIMIT 100`;
                }
            }

            try {
                const results = await invoke('plugin:knowledge|query_knowledge', { query: queryStr });
                tbodyResult.innerHTML = "";

                if (!results || results.length === 0) {
                    tbodyResult.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary); padding: 24px;">조회 결과가 존재하지 않습니다.</td></tr>`;
                    return;
                }

                // Dynamically build headers based on returned keys
                const sampleRow = results[0];
                const keys = Object.keys(sampleRow);
                
                let theadHtml = `<tr style="border-bottom: 1px solid var(--card-border); color: var(--accent-color);">`;
                keys.forEach(k => {
                    theadHtml += `<th style="padding: 8px;">?${k}</th>`;
                });
                theadHtml += `</tr>`;
                tableResult.querySelector('thead').innerHTML = theadHtml;

                results.forEach(row => {
                    const targetUri = row.대상 ? row.대상.value : '';
                    let trHtml = `<tr data-target="${targetUri}" style="border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='rgba(255,255,255,0.04)'" onmouseout="this.style.backgroundColor='transparent'">`;
                    keys.forEach(k => {
                        const cell = row[k];
                        const val = cell ? cell.value : '';
                        const type = cell ? cell.type : 'literal';
                        const shortened = val.replace("http://workassist.local/ontology/", "wa:");
                        trHtml += `<td style="padding: 8px; font-family: monospace; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${val}">
                            <span style="opacity: 0.6; font-size: 10px; display: block; color: var(--text-secondary);">${type}</span>
                            ${shortened}
                        </td>`;
                    });
                    trHtml += `</tr>`;
                    tbodyResult.insertAdjacentHTML('beforeend', trHtml);
                });
            } catch (err) {
                tbodyResult.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #f87171; padding: 24px;"><strong>검색 에러:</strong><br>${err}</td></tr>`;
            } finally {
                btnRunSparql.disabled = false;
            }
        };

        // 엔터키를 눌렀을 때도 바로 검색이 되도록 UX 개선
        inputKeyword.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                btnRunSparql.click();
            }
        });

        // Component 보기 버튼 클릭 시 팝업창(모달)을 띄워 전체 부품 목록을 표 형태로 표시
        if (btnViewComponents) {
            btnViewComponents.onclick = async () => {
                const modalDetail = document.getElementById('modal-knowledge-detail');
                const detailContent = document.getElementById('knowledge-detail-content');
                const titleElem = document.getElementById('knowledge-detail-title');
                
                if (!modalDetail || !detailContent) return;

                const projectCode = selectProject ? selectProject.value : "";
                btnViewComponents.disabled = true;

                // 팝업창을 띄우고 로딩 메시지 표시
                const titleText = projectCode ? `지식 DB 프로젝트 부품 목록 (wa:Project_${projectCode.trim().replace(/ /g, "_")})` : "지식 DB 부품 목록 (전체)";
                if (titleElem) {
                    titleElem.innerText = titleText;
                }
                currentKnowledgeTitle = projectCode ? `Project_${projectCode.trim().replace(/ /g, "_")}_부품목록` : "전체_부품목록";
                
                detailContent.innerHTML = `<div style="text-align: center; color: var(--accent-color); padding: 24px;">Component 목록을 가져오는 중...</div>`;
                modalDetail.classList.remove('hidden');

                let queryStr = "";
                if (!projectCode) {
                    // 전체 컴포넌트 및 상세 속성 조회
                    queryStr = `PREFIX wa: <http://workassist.local/ontology/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT DISTINCT ?컴포넌트 ?partNumber ?category ?itemName ?maker ?spec ?description WHERE {
  ?컴포넌트 rdf:type wa:Component .
  OPTIONAL { ?컴포넌트 wa:partNumber ?partNumber . }
  OPTIONAL { ?컴포넌트 wa:category ?category . }
  OPTIONAL { ?컴포넌트 wa:itemName ?itemName . }
  OPTIONAL { ?컴포넌트 wa:maker ?maker . }
  OPTIONAL { ?컴포넌트 wa:spec ?spec . }
  OPTIONAL { ?컴포넌트 wa:description ?description . }
} ORDER BY ?partNumber LIMIT 300`;
                } else {
                    // 특정 프로젝트 하위 컴포넌트 및 상세 속성 조회
                    const sanitizedCode = projectCode.trim().replace(/ /g, "_");
                    queryStr = `PREFIX wa: <http://workassist.local/ontology/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT DISTINCT ?컴포넌트 ?partNumber ?category ?itemName ?maker ?spec ?description WHERE {
  wa:Project_${sanitizedCode} wa:hasBOMItem ?bom .
  ?bom wa:refersToComponent ?컴포넌트 .
  OPTIONAL { ?컴포넌트 wa:partNumber ?partNumber . }
  OPTIONAL { ?컴포넌트 wa:category ?category . }
  OPTIONAL { ?컴포넌트 wa:itemName ?itemName . }
  OPTIONAL { ?컴포넌트 wa:maker ?maker . }
  OPTIONAL { ?컴포넌트 wa:spec ?spec . }
  OPTIONAL { ?컴포넌트 wa:description ?description . }
} ORDER BY ?partNumber LIMIT 300`;
                }

                try {
                    const results = await invoke('plugin:knowledge|query_knowledge', { query: queryStr });
                    detailContent.innerHTML = "";

                    if (!results || results.length === 0) {
                        activeKnowledgeComponents = [];
                        detailContent.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 24px;">등록된 Component가 존재하지 않습니다.</div>`;
                        return;
                    }

                    // 내보내기용 글로벌 세션 데이터 캐싱
                    activeKnowledgeComponents = results.map(row => ({
                        partNumber: row.partNumber ? row.partNumber.value : "-",
                        category: row.category ? row.category.value : "-",
                        itemName: row.itemName ? row.itemName.value : "-",
                        maker: row.maker ? row.maker.value : "-",
                        spec: row.spec ? row.spec.value : "-",
                        description: row.description ? row.description.value : "-"
                    }));

                    // 가로형 표 형태로 모든 부품의 목록을 구성
                    let tableRowsHtml = "";
                    activeKnowledgeComponents.forEach(c => {
                        tableRowsHtml += `
                        <tr style="color: var(--text-color); border-bottom: 1px solid rgba(255,255,255,0.05); transition: background-color 0.15s;" onmouseover="this.style.backgroundColor='rgba(255,255,255,0.02)'" onmouseout="this.style.backgroundColor='transparent'">
                            <td style="padding: 16px; font-weight: 600; font-family: monospace; color: var(--text-primary); font-size: 14px;">${c.partNumber}</td>
                            <td style="padding: 16px; color: var(--text-secondary);">${c.category}</td>
                            <td style="padding: 16px; color: var(--text-secondary);">${c.itemName}</td>
                            <td style="padding: 16px; color: var(--text-primary); font-weight: 500;">${c.maker}</td>
                            <td style="padding: 16px; font-family: monospace;">
                                <span style="background: rgba(255,255,255,0.06); padding: 5px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); font-size: 12px; color: var(--accent-color); font-weight: 500; display: inline-block;">${c.spec}</span>
                            </td>
                            <td style="padding: 16px; color: var(--text-secondary); white-space: pre-wrap; word-break: break-all; max-width: 250px;">${c.description}</td>
                        </tr>`;
                    });

                    let tableHtml = `
                    <div style="overflow-x: auto; width: 100%; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.2); box-shadow: inset 0 2px 8px rgba(0,0,0,0.3);">
                        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; min-width: 100%;">
                            <thead>
                                <tr style="color: var(--accent-color);">
                                    <th style="padding: 14px 16px; font-weight: 600; position: sticky; top: 0; background: rgb(18, 22, 28); z-index: 10; border-bottom: 1px solid rgba(255,255,255,0.08);">부품 번호</th>
                                    <th style="padding: 14px 16px; font-weight: 600; position: sticky; top: 0; background: rgb(18, 22, 28); z-index: 10; border-bottom: 1px solid rgba(255,255,255,0.08);">분류</th>
                                    <th style="padding: 14px 16px; font-weight: 600; position: sticky; top: 0; background: rgb(18, 22, 28); z-index: 10; border-bottom: 1px solid rgba(255,255,255,0.08);">품명</th>
                                    <th style="padding: 14px 16px; font-weight: 600; position: sticky; top: 0; background: rgb(18, 22, 28); z-index: 10; border-bottom: 1px solid rgba(255,255,255,0.08);">제조사<br><span style="font-size: 10px; opacity: 0.6; font-weight: normal;">(Maker)</span></th>
                                    <th style="padding: 14px 16px; font-weight: 600; position: sticky; top: 0; background: rgb(18, 22, 28); z-index: 10; border-bottom: 1px solid rgba(255,255,255,0.08);">규격 및 상세 사양<br><span style="font-size: 10px; opacity: 0.6; font-weight: normal;">(Spec)</span></th>
                                    <th style="padding: 14px 16px; font-weight: 600; position: sticky; top: 0; background: rgb(18, 22, 28); z-index: 10; border-bottom: 1px solid rgba(255,255,255,0.08);">견적 비용 및 비고<br><span style="font-size: 10px; opacity: 0.6; font-weight: normal;">(Description)</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tableRowsHtml}
                            </tbody>
                        </table>
                    </div>`;

                    detailContent.innerHTML = tableHtml;

                } catch (err) {
                    detailContent.innerHTML = `<div style="text-align: center; color: #f87171; padding: 24px;">목록 조회 오류:<br>${err}</div>`;
                } finally {
                    btnViewComponents.disabled = false;
                }
            };
        }

        // 지식 DB 검색 결과 행 클릭 시 상세 팝업 바인딩
        tbodyResult.onclick = async (e) => {
            const tr = e.target.closest('tr');
            if (!tr) return;
            const targetUri = tr.getAttribute('data-target');
            if (!targetUri) return;
            
            await showKnowledgeDetail(targetUri);
        };
    }

    // 지식 DB 상세정보 모달 제어
    const modalDetail = document.getElementById('modal-knowledge-detail');
    const btnCloseDetail = document.getElementById('btn-close-knowledge-detail');
    const btnCloseDetailFooter = document.getElementById('btn-close-knowledge-detail-footer');
    const detailContent = document.getElementById('knowledge-detail-content');

    const closeModalDetail = () => {
        if (modalDetail) {
            modalDetail.classList.add('hidden');
        }
    };

    if (btnCloseDetail) btnCloseDetail.onclick = closeModalDetail;
    if (btnCloseDetailFooter) btnCloseDetailFooter.onclick = closeModalDetail;
    if (modalDetail) {
        modalDetail.onclick = (e) => {
            if (e.target === modalDetail) {
                closeModalDetail();
            }
        };
    }

    async function showKnowledgeDetail(targetUri) {
        if (!modalDetail || !detailContent) return;
        
        detailContent.innerHTML = `<div style="text-align: center; color: var(--accent-color); padding: 24px;">세부 정보를 불러오는 중...</div>`;
        modalDetail.classList.remove('hidden');

        // SPARQL 쿼리를 통해 대상의 속성 긁어오기 (Component와 BOMItem 연동 매핑)
        const queryStr = `PREFIX wa: <http://workassist.local/ontology/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT DISTINCT ?속성명 ?값 WHERE {
  {
    ?대상 ?속성명 ?값 .
    FILTER(str(?대상) = "${targetUri}")
  } UNION {
    ?bomItem wa:refersToComponent ?대상 .
    ?대상 ?속성명 ?값 .
    FILTER(str(?bomItem) = "${targetUri}")
  }
}`;

        try {
            const results = await invoke('plugin:knowledge|query_knowledge', { query: queryStr });
            detailContent.innerHTML = "";

            if (!results || results.length === 0) {
                activeKnowledgeComponents = [];
                detailContent.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 24px;">속성 정보가 존재하지 않습니다.</div>`;
                return;
            }

            const properties = {};
            results.forEach(row => {
                const prop = row.속성명 ? row.속성명.value : '';
                const val = row.값 ? row.값.value : '';
                if (prop && val) {
                    properties[prop] = val;
                }
            });

            // 가로형 표(Table) 형식 디자인으로 출력
            const partNumber = properties["http://workassist.local/ontology/partNumber"] || "-";
            const category = properties["http://workassist.local/ontology/category"] || "-";
            const itemName = properties["http://workassist.local/ontology/itemName"] || "-";
            const maker = properties["http://workassist.local/ontology/maker"] || "-";
            const spec = properties["http://workassist.local/ontology/spec"] || "-";
            const description = properties["http://workassist.local/ontology/description"] || "-";

            // 내보내기용 글로벌 세션 데이터 캐싱
            activeKnowledgeComponents = [{
                partNumber: partNumber,
                category: category,
                itemName: itemName,
                maker: maker,
                spec: spec,
                description: description
            }];

            const shortenedUri = targetUri.replace("http://workassist.local/ontology/", "wa:");
            const cleanPart = shortenedUri.replace("wa:Component_", "");
            currentKnowledgeTitle = `부품상세_${cleanPart}`;

            let html = `
            <div style="overflow-x: auto; width: 100%; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.2); box-shadow: inset 0 2px 8px rgba(0,0,0,0.3);">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; min-width: 100%;">
                    <thead>
                        <tr style="color: var(--accent-color);">
                            <th style="padding: 14px 16px; font-weight: 600; position: sticky; top: 0; background: rgb(18, 22, 28); z-index: 10; border-bottom: 1px solid rgba(255,255,255,0.08);">부품 번호</th>
                            <th style="padding: 14px 16px; font-weight: 600; position: sticky; top: 0; background: rgb(18, 22, 28); z-index: 10; border-bottom: 1px solid rgba(255,255,255,0.08);">분류</th>
                            <th style="padding: 14px 16px; font-weight: 600; position: sticky; top: 0; background: rgb(18, 22, 28); z-index: 10; border-bottom: 1px solid rgba(255,255,255,0.08);">품명</th>
                            <th style="padding: 14px 16px; font-weight: 600; position: sticky; top: 0; background: rgb(18, 22, 28); z-index: 10; border-bottom: 1px solid rgba(255,255,255,0.08);">제조사<br><span style="font-size: 10px; opacity: 0.6; font-weight: normal;">(Maker)</span></th>
                            <th style="padding: 14px 16px; font-weight: 600; position: sticky; top: 0; background: rgb(18, 22, 28); z-index: 10; border-bottom: 1px solid rgba(255,255,255,0.08);">규격 및 상세 사양<br><span style="font-size: 10px; opacity: 0.6; font-weight: normal;">(Spec)</span></th>
                            <th style="padding: 14px 16px; font-weight: 600; position: sticky; top: 0; background: rgb(18, 22, 28); z-index: 10; border-bottom: 1px solid rgba(255,255,255,0.08);">견적 비용 및 비고<br><span style="font-size: 10px; opacity: 0.6; font-weight: normal;">(Description)</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="color: var(--text-color); border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <td style="padding: 16px; font-weight: 600; font-family: monospace; color: var(--text-primary); font-size: 14px;">${partNumber}</td>
                            <td style="padding: 16px; color: var(--text-secondary);">${category}</td>
                            <td style="padding: 16px; color: var(--text-secondary);">${itemName}</td>
                            <td style="padding: 16px; color: var(--text-primary); font-weight: 500;">${maker}</td>
                            <td style="padding: 16px; font-family: monospace;">
                                <span style="background: rgba(255,255,255,0.06); padding: 5px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); font-size: 12px; color: var(--accent-color); font-weight: 500; display: inline-block;">${spec}</span>
                            </td>
                            <td style="padding: 16px; color: var(--text-secondary); white-space: pre-wrap; word-break: break-all; max-width: 250px;">${description}</td>
                        </tr>
                    </tbody>
                </table>
            </div>`;

            // 추가 정보가 있는 경우
            let hasExtra = false;
            let extraHtml = `
            <div style="margin-top: 24px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 16px;">
                <div style="font-size: 12px; color: var(--text-secondary); font-weight: 600; margin-bottom: 10px;">📋 추가 지식 속성 정보</div>
                <div style="display: flex; flex-direction: column; gap: 8px;">`;
            
            const standardUris = [
                "http://workassist.local/ontology/partNumber",
                "http://workassist.local/ontology/category",
                "http://workassist.local/ontology/itemName",
                "http://workassist.local/ontology/maker",
                "http://workassist.local/ontology/spec",
                "http://workassist.local/ontology/description"
            ];

            Object.keys(properties).forEach(propUri => {
                if (!standardUris.includes(propUri)) {
                    hasExtra = true;
                    const label = propUri.replace("http://workassist.local/ontology/", "wa:").replace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "rdf:");
                    const val = properties[propUri].replace("http://workassist.local/ontology/", "wa:");
                    extraHtml += `
                    <div style="display: flex; justify-content: space-between; font-size: 12px; background: rgba(0,0,0,0.15); padding: 8px 12px; border-radius: 6px; align-items: center; gap: 10px;">
                        <span style="color: var(--text-secondary); font-family: monospace; font-size: 11px;">${label}</span>
                        <span style="color: var(--text-primary); font-family: monospace; font-size: 11px; text-align: right; word-break: break-all;">${val}</span>
                    </div>`;
                }
            });
            extraHtml += `</div></div>`;

            if (hasExtra) {
                html += extraHtml;
            }

            html += `</div>`;
            detailContent.innerHTML = html;

            const titleElem = document.getElementById('knowledge-detail-title');
            if (titleElem) {
                titleElem.innerText = `지식 DB 부품 상세 정보 (${shortenedUri})`;
            }

        } catch (err) {
            detailContent.innerHTML = `<div style="text-align: center; color: #f87171; padding: 24px;">상세 정보 조회 오류:<br>${err}</div>`;
        }
    }

    // 지식 DB 부품 목록 내보내기 (MD, CSV)
    const btnExportMd = document.getElementById('btn-export-knowledge-md');
    const btnExportCsv = document.getElementById('btn-export-knowledge-csv');

    function cleanMarkdownCell(val) {
        if (!val) return "-";
        return val.toString().replace(/\|/g, "\\|").replace(/\n/g, " ");
    }

    function cleanCSVCell(val) {
        if (!val) return "";
        return val.toString().replace(/"/g, '""');
    }

    if (btnExportMd) {
        btnExportMd.onclick = async () => {
            if (!activeKnowledgeComponents || activeKnowledgeComponents.length === 0) {
                alert("내보낼 부품 데이터가 존재하지 않습니다.");
                return;
            }
            if (!window.__TAURI__ || !window.__TAURI__.dialog) {
                alert("Tauri 데스크톱 환경에서만 파일 저장 대화상자가 지원됩니다.");
                return;
            }
            try {
                let md = `# ${currentKnowledgeTitle.replace(/_/g, " ")}\n\n`;
                md += `| 부품 번호 | 분류 | 품명 | 제조사 (Maker) | 규격 및 상세 사양 (Spec) | 견적 비용 및 비고 (Description) |\n`;
                md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
                activeKnowledgeComponents.forEach(c => {
                    md += `| ${cleanMarkdownCell(c.partNumber)} | ${cleanMarkdownCell(c.category)} | ${cleanMarkdownCell(c.itemName)} | ${cleanMarkdownCell(c.maker)} | ${cleanMarkdownCell(c.spec)} | ${cleanMarkdownCell(c.description)} |\n`;
                });
                md += `\n---\n*Exported by WorkAssist*`;

                const savePath = await window.__TAURI__.dialog.save({
                    filters: [{ name: 'Markdown', extensions: ['md'] }],
                    defaultPath: `${currentKnowledgeTitle}.md`
                });
                if (savePath) {
                    await invoke('plugin:minutes|save_text_file', { path: savePath, content: md });
                    alert(`성공적으로 내보냈습니다!\n저장 경로: ${savePath}`);
                }
            } catch (err) {
                alert("Markdown 내보내기에 실패했습니다: " + err);
            }
        };
    }

    if (btnExportCsv) {
        btnExportCsv.onclick = async () => {
            if (!activeKnowledgeComponents || activeKnowledgeComponents.length === 0) {
                alert("내보낼 부품 데이터가 존재하지 않습니다.");
                return;
            }
            if (!window.__TAURI__ || !window.__TAURI__.dialog) {
                alert("Tauri 데스크톱 환경에서만 파일 저장 대화상자가 지원됩니다.");
                return;
            }
            try {
                let csv = `\ufeff`;
                csv += `"부품 번호","분류","품명","제조사 (Maker)","규격 및 상세 사양 (Spec)","견적 비용 및 비고 (Description)"\n`;
                activeKnowledgeComponents.forEach(c => {
                    csv += `"${cleanCSVCell(c.partNumber)}","${cleanCSVCell(c.category)}","${cleanCSVCell(c.itemName)}","${cleanCSVCell(c.maker)}","${cleanCSVCell(c.spec)}","${cleanCSVCell(c.description)}"\n`;
                });

                const savePath = await window.__TAURI__.dialog.save({
                    filters: [{ name: 'CSV', extensions: ['csv'] }],
                    defaultPath: `${currentKnowledgeTitle}.csv`
                });
                if (savePath) {
                    await invoke('plugin:minutes|save_text_file', { path: savePath, content: csv });
                    alert(`성공적으로 내보냈습니다!\n저장 경로: ${savePath}`);
                }
            } catch (err) {
                alert("CSV 내보내기에 실패했습니다: " + err);
            }
        };
    }

    // 9. Refresh Graph button
    const btnRefreshGraph = document.getElementById('btn-history-refresh-graph');
    if (btnRefreshGraph) {
        btnRefreshGraph.onclick = async () => {
            btnRefreshGraph.disabled = true;
            btnRefreshGraph.innerHTML = "<span>🔄</span> 로딩 중...";
            try {
                await refreshHistory();
            } finally {
                btnRefreshGraph.disabled = false;
                btnRefreshGraph.innerHTML = "<span>🔄</span> 그래프 갱신";
            }
        };
    }
}

async function refreshHistory() {
    try {
        const projects = await invoke('plugin:knowledge|get_all_projects');
        const bomProjSelect = document.getElementById('history-bom-proj-select');
        const docProjSelect = document.getElementById('history-doc-proj-select');
        const searchProjSelect = document.getElementById('history-db-search-proj-select');

        // Populate drop-downs
        if (bomProjSelect && docProjSelect) {
            const buildOptions = () => {
                let html = `<option value="" disabled selected>— 등록된 프로젝트를 선택해 주세요 —</option>`;
                projects.forEach(p => {
                    html += `<option value="${p.project_code}">${p.project_name} [${p.project_code}]</option>`;
                });
                return html;
            };
            bomProjSelect.innerHTML = buildOptions();
            docProjSelect.innerHTML = buildOptions();
        }

        if (searchProjSelect) {
            let html = `<option value="" selected>— 전체 프로젝트 검색 —</option>`;
            projects.forEach(p => {
                html += `<option value="${p.project_code}">${p.project_name} [${p.project_code}]</option>`;
            });
            searchProjSelect.innerHTML = html;
        }

        // Fetch graph data for D3 and render it
        const graphData = await invoke('plugin:knowledge|get_graph_data');
        renderD3Graph(graphData);
    } catch (err) {
        console.error("Failed to refresh history views:", err);
    }
}

function renderD3Graph(graphData) {
    if (!window.d3) {
        console.error("D3.js library is not loaded.");
        const canvas = document.getElementById('history-graph-canvas');
        if (canvas) {
            canvas.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color: #f87171;">D3.js 라이브러리를 로드할 수 없습니다.</div>`;
        }
        return;
    }

    const svg = d3.select("#history-graph-svg");
    svg.selectAll("*").remove(); // Clear previous drawing

    const container = document.getElementById("history-graph-canvas");
    let width = container.clientWidth;
    let height = container.clientHeight;

    // 탭 전환 또는 렌더링 시점에 크기가 0으로 측정되는 문제를 방지하기 위해 getComputedStyle 활용
    if (!width || width < 50) {
        const style = window.getComputedStyle(container);
        width = parseInt(style.width) || 800;
    }
    if (!height || height < 50) {
        const style = window.getComputedStyle(container);
        height = parseInt(style.minHeight) || parseInt(style.height) || 700;
    }

    svg.attr("width", "100%")
       .attr("height", "100%")
       .attr("viewBox", `0 0 ${width} ${height}`);

    // Define Arrow Marker
    svg.append("defs").append("marker")
        .attr("id", "arrowhead")
        .attr("viewBox", "-0 -5 10 10")
        .attr("refX", 22)
        .attr("refY", 0)
        .attr("orient", "auto")
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("xoverflow", "visible")
        .append("svg:path")
        .attr("d", "M 0,-5 L 10 ,0 L 0,5")
        .attr("fill", "rgba(255,255,255,0.2)")
        .style("stroke", "none");

    const g = svg.append("g");

    // Add Zoom behavior
    const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
        });
    svg.call(zoom);

    const nodes = graphData.nodes || [];
    const links = graphData.links || [];

    if (nodes.length === 0) {
        g.append("text")
            .attr("x", width / 2)
            .attr("y", height / 2)
            .attr("text-anchor", "middle")
            .attr("fill", "var(--text-secondary)")
            .style("font-size", "14px")
            .text("지식 그래프 데이터가 비어 있습니다. 프로젝트와 BOM을 등록해 보세요.");
        return;
    }

    // Force simulation
    if (d3Simulation) d3Simulation.stop();
    d3Simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(160))
        .force("charge", d3.forceManyBody().strength(-350))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(38));

    // Render edges
    const link = g.append("g")
        .attr("stroke-opacity", 0.5)
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("stroke", "rgba(255, 255, 255, 0.15)")
        .attr("stroke-width", 1.5)
        .attr("marker-end", "url(#arrowhead)");

    // Render edge labels (Predicate)
    const linkText = g.append("g")
        .selectAll("text")
        .data(links)
        .join("text")
        .style("font-size", "8px")
        .attr("fill", "rgba(255,255,255,0.3)")
        .attr("text-anchor", "middle")
        .text(d => d.type);

    // Node color strategy mapping
    const colorMap = {
        "Project": "#ff79c6",   // Pink
        "BOM": "#8be9fd",       // Cyan
        "Component": "#50fa7b", // Mint
        "Literal": "#f1fa8c"    // Yellow
    };

    // Render nodes
    const node = g.append("g")
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("r", 15)
        .attr("fill", d => colorMap[d.group] || "#bd93f9")
        .attr("stroke", "rgba(0,0,0,0.4)")
        .attr("stroke-width", 1.5)
        .style("cursor", "pointer")
        .call(d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));

    // Node Labels
    const label = g.append("g")
        .selectAll("text")
        .data(nodes)
        .join("text")
        .attr("dy", -22)
        .attr("text-anchor", "middle")
        .style("font-size", "11px")
        .attr("fill", "var(--text-color)")
        .style("pointer-events", "none")
        .style("text-shadow", "0 2px 4px rgba(0,0,0,0.8)")
        .text(d => d.label);

    // Interactive event: Click Node to Inspect
    node.on("click", async (event, d) => {
        event.stopPropagation();
        
        // Visual micro-animation feedback
        node.transition().duration(200).attr("r", n => n.id === d.id ? 22 : 15);

        const content = document.getElementById("history-inspector-content");
        if (!content) return;

        // Literal 노드는 하위 관계를 갖지 않는 순수 값이므로 SPARQL 조회를 차단하고 즉시 정보 표시
        if (d.group === "Literal") {
            content.innerHTML = `
                <div style="margin-bottom: 8px; word-break: break-all;">
                    <strong>Literal Value:</strong> <span style="font-family:monospace; color:var(--accent-color); font-size:12px;">${d.label}</span>
                    <span style="margin-left: 6px;" class="tag-badge" style="background: #f1fa8c; color: #000;">${d.group}</span>
                </div>
                <div style="color: var(--text-secondary); margin-top:8px;">리터럴(상수값) 노드는 하위 관계 트리플 속성을 가질 수 없습니다.</div>
            `;
            return;
        }

        content.innerHTML = `
            <div style="display:flex; justify-content:center; align-items:center; padding: 12px; gap:8px;">
                <div class="spinner" style="border: 2px solid rgba(255,255,255,0.1); border-top-color: var(--accent-color); width: 14px; height: 14px; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                <span>관계 세부 정보 파싱 중...</span>
            </div>
        `;

        try {
            // Expand subject URI
            const uri = d.id.replace("wa:", "http://workassist.local/ontology/");
            
            // URI 안전성 검증: 올바른 URI 형식이 아닐 경우 오류 방지를 위해 쿼리 생략
            if (!uri.startsWith("http://") && !uri.startsWith("https://")) {
                content.innerHTML = `
                    <div style="margin-bottom: 8px; word-break: break-all;">
                        <strong>Value:</strong> <span style="font-family:monospace; color:var(--accent-color); font-size:12px;">${d.label}</span>
                        <span style="margin-left: 6px;" class="tag-badge">${d.group}</span>
                    </div>
                    <div style="color: var(--text-secondary); margin-top:8px;">유효한 RDF 엔티티 URI 형식이 아니므로 하위 관계를 조회할 수 없습니다.</div>
                `;
                return;
            }

            // SPARQL to query all properties of this subject
            // 특수문자나 공백이 포함된 URI가 SPARQL IRIREF 파싱 에러를 유발하지 않도록 BIND/FILTER 문자열 매칭으로 우회합니다.
            const escapedUri = uri.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const sparql = `
                SELECT ?p ?o WHERE {
                    ?s ?p ?o .
                    FILTER(str(?s) = "${escapedUri}")
                } LIMIT 15
            `;
            
            const properties = await invoke("plugin:knowledge|query_knowledge", { query: sparql });
            
            let html = `
                <div style="margin-bottom: 8px; word-break: break-all;">
                    <strong>URI:</strong> <span style="font-family:monospace; color:var(--accent-color); font-size:11px;">${d.id}</span>
                    <span style="margin-left: 6px;" class="tag-badge">${d.group}</span>
                </div>
            `;

            if (d.group === "Project") {
                html += `
                    <button class="btn btn-secondary btn-sm" id="btn-inspector-delete-project" style="margin-bottom: 12px; padding: 4px 8px; font-size: 11px; height: 26px; border-color: #f87171; color: #f87171;">
                        🗑️ 프로젝트 완전 삭제 (연쇄 삭제)
                    </button>
                `;
            }

            if (!properties || properties.length === 0) {
                html += `<div style="color: var(--text-secondary); margin-top:8px;">연관된 트리플 속성이 존재하지 않습니다.</div>`;
            } else {
                html += `
                    <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 8px; border: 1px solid var(--card-border);">
                        <thead>
                          <tr style="background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--card-border); text-align:left;">
                            <th style="padding:6px;">Predicate</th>
                            <th style="padding:6px;">Object Value</th>
                          </tr>
                        </thead>
                        <tbody>
                `;
                properties.forEach(p => {
                    const predShort = p.p.value.replace("http://workassist.local/ontology/", "wa:");
                    const objShort = p.o.value.replace("http://workassist.local/ontology/", "wa:");
                    html += `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                            <td style="padding:6px; font-family:monospace; color: var(--text-secondary);">${predShort}</td>
                            <td style="padding:6px; word-break: break-all;" title="${p.o.value}">${objShort}</td>
                        </tr>
                    `;
                });
                html += `</tbody></table>`;
            }

            content.innerHTML = html;

            // Bind inspector delete action
            const btnDelProj = document.getElementById("btn-inspector-delete-project");
            if (btnDelProj) {
                btnDelProj.onclick = async () => {
                    const confirmDel = confirm(`프로젝트 '${d.label}'와 관련된 지식 그래프 및 LanceDB 문서 벡터 데이터를 모두 완전히 영구 삭제하시겠습니까?`);
                    if (confirmDel) {
                        try {
                            btnDelProj.disabled = true;
                            btnDelProj.textContent = "삭제 진행 중...";
                            await invoke("plugin:knowledge|delete_knowledge_entity", {
                                entityUri: uri,
                                projectCode: d.label
                            });
                            alert("성공적으로 프로젝트가 삭제되었습니다.");
                            content.innerHTML = "노드를 클릭하면 해당 노드의 세부 정보 및 연관된 트리플 목록을 확인하실 수 있습니다.";
                            await refreshHistory();
                        } catch (err) {
                            alert("삭제 실패: " + err);
                            btnDelProj.disabled = false;
                            btnDelProj.textContent = "🗑️ 프로젝트 완전 삭제 (연쇄 삭제)";
                        }
                    }
                };
            }

        } catch (err) {
            content.innerHTML = `<div style="color: #f87171;">데이터 로딩 오류: ${err}</div>`;
        }
    });

    // Reset circle radius on canvas click
    svg.on("click", () => {
        node.transition().duration(200).attr("r", 8);
        const content = document.getElementById("history-inspector-content");
        if (content) {
            content.innerHTML = "노드를 클릭하면 해당 노드의 세부 정보 및 연관된 트리플 목록을 확인하실 수 있습니다.";
        }
    });

    // Physics ticks
    d3Simulation.on("tick", () => {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        linkText
            .attr("x", d => (d.source.x + d.target.x) / 2)
            .attr("y", d => (d.source.y + d.target.y) / 2);

        node
            .attr("cx", d => d.x)
            .attr("cy", d => d.y);

        label
            .attr("x", d => d.x)
            .attr("y", d => d.y);
    });

    function dragstarted(event, d) {
        if (!event.active) d3Simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        if (!event.active) d3Simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }
}

// ==========================================
// DB 관리자 (DB Manager) 모듈 로직
// ==========================================

let dbPreviewItems = []; // HITL 검토 대상 임시 전역 상태

// 100% 한글 콘솔 출력 헬퍼
function writeDbLog(message, isError = false) {
    const consolePre = document.getElementById('db-ingest-console-pre');
    if (!consolePre) return;
    const timeStr = new Date().toLocaleTimeString();
    const formatted = `[${timeStr}] ${isError ? '❌ [에러] ' : '✨ [정보] '}${message}\n`;
    if (consolePre.textContent === '준비 완료.') {
        consolePre.textContent = formatted;
    } else {
        consolePre.textContent += formatted;
    }
    // 스크롤 최하단 이동
    const container = document.getElementById('db-ingest-console-container');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

async function setupDbManager() {
    console.log("DB Manager Module Initialized");

    // 1. 탭 네비게이션 처리
    const dbTabs = document.querySelectorAll('#db-manager-tabs .view-tab');
    dbTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            dbTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const targetTab = tab.getAttribute('data-db-tab');
            document.querySelectorAll('.db-tab-panel').forEach(panel => {
                panel.style.display = 'none';
            });
            if (targetTab === 'ingest') {
                document.getElementById('db-ingest-panel').style.display = 'block';
            } else if (targetTab === 'search') {
                document.getElementById('db-search-panel').style.display = 'block';
                refreshDbSearchFilters(); // 탭 이동시 필터 동적 갱신
            }
        });
    });

    // 2. [DB 입력] 폴더 선택 이벤트
    const btnSelectFolder = document.getElementById('btn-db-select-folder');
    if (btnSelectFolder) {
        btnSelectFolder.addEventListener('click', async () => {
            try {
                const dir = await window.__TAURI__.dialog.open({
                    directory: true,
                    multiple: false,
                    title: "제품 사양 JSON 파일들이 위치한 폴더 선택"
                });
                if (dir) {
                    document.getElementById('db-ingest-folder-path').value = dir;
                    writeDbLog(`폴더 선택 완료: ${dir}`);
                }
            } catch (err) {
                writeDbLog(`폴더 선택 에러: ${err}`, true);
            }
        });
    }

    // 3. [DB 입력] 1단계 프리뷰 버튼 이벤트
    const btnPreviewIngest = document.getElementById('btn-db-preview-ingest');
    if (btnPreviewIngest) {
        btnPreviewIngest.addEventListener('click', async () => {
            const folderPath = document.getElementById('db-ingest-folder-path').value.trim();
            const catalogName = document.getElementById('db-ingest-catalog-name').value.trim();

            if (!folderPath) {
                alert("먼저 사양 JSON 파일이 있는 폴더를 선택해 주세요.");
                return;
            }
            if (!catalogName) {
                alert("카탈로그/문서 식별 명칭을 입력해 주세요. (예: 2026_servo_motor)");
                return;
            }

            try {
                writeDbLog("JSON 파일 분석 및 프리뷰 조회를 시작합니다...");
                
                // 프리뷰 표시 영역 숨김 초기화
                document.getElementById('db-preview-section').style.display = 'none';
                document.getElementById('db-ingest-result-section').style.display = 'none';

                // Tauri 커맨드 호출
                const items = await invoke('plugin:rag|preview_json_folder', {
                    folderPath: folderPath,
                    catalogName: catalogName
                });

                dbPreviewItems = items || [];
                renderDbPreviewTable();
                
                writeDbLog(`분석 완료! 총 ${dbPreviewItems.length}개의 부품 사양이 감지되었습니다.`);
            } catch (err) {
                writeDbLog(`1단계 분석 실패: ${err}`, true);
                alert("JSON 폴더 분석 중 오류가 발생했습니다: " + err);
            }
        });
    }

    // 4. [DB 입력] 전체 선택 체크박스 바인딩
    const selectAllCheckbox = document.getElementById('db-preview-select-all');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.db-preview-item-checkbox').forEach(cb => {
                cb.checked = checked;
            });
            writeDbLog(checked ? "전체 선택되었습니다." : "전체 선택 해제되었습니다.");
        });
    }

    // 5. [DB 입력] 2단계 최종 확정 인입 실행 버튼
    const btnConfirmIngest = document.getElementById('btn-db-confirm-ingest');
    if (btnConfirmIngest) {
        btnConfirmIngest.addEventListener('click', async () => {
            // 체크된 항목들만 추출
            const checkedRows = document.querySelectorAll('.db-preview-item-row');
            const itemsToIngest = [];

            checkedRows.forEach(row => {
                const checkbox = row.querySelector('.db-preview-item-checkbox');
                if (checkbox && checkbox.checked) {
                    const index = parseInt(row.getAttribute('data-index'));
                    
                    // 테이블 셀로부터 편집된 값 가져오기
                    const partNumber = row.querySelector('.cell-part-number').textContent.trim();
                    const manufacturer = row.querySelector('.cell-manufacturer').textContent.trim();
                    const category = row.querySelector('.cell-category').textContent.trim();
                    const specJsonStr = row.querySelector('.cell-spec-json').textContent.trim();
                    
                    let specData = {};
                    try {
                        specData = JSON.parse(specJsonStr);
                    } catch (e) {
                        writeDbLog(`[경고] 파트 넘버 '${partNumber}'의 스펙 JSON 파싱 실패. 원본 값을 유지합니다.`, true);
                        specData = dbPreviewItems[index].spec_data;
                    }

                    itemsToIngest.push({
                        part_number: partNumber,
                        manufacturer: manufacturer,
                        category: category,
                        description: dbPreviewItems[index].description || "",
                        spec_data: specData,
                        chunk_text: dbPreviewItems[index].chunk_text || ""
                    });
                }
            });

            if (itemsToIngest.length === 0) {
                alert("인입할 항목을 1개 이상 선택해 주세요.");
                return;
            }

            try {
                // UI 로딩 표시
                document.getElementById('db-ingest-result-section').style.display = 'flex';
                document.getElementById('db-ingest-loading').style.display = 'block';
                const progressBar = document.getElementById('db-ingest-progress-bar');
                const progressPercent = document.getElementById('db-ingest-progress-percent');
                const progressStatus = document.getElementById('db-ingest-progress-status');
                
                progressBar.style.width = '0%';
                progressPercent.textContent = '0%';
                progressStatus.textContent = '임베딩 추출 및 DB 저장을 시작합니다...';

                writeDbLog(`선택된 ${itemsToIngest.length}개 사양에 대한 DB 인입을 시작합니다...`);

                // 통계 초기화
                document.getElementById('db-stat-total').textContent = itemsToIngest.length;
                document.getElementById('db-stat-success').textContent = '0';
                document.getElementById('db-stat-failed').textContent = '0';

                let successCount = 0;
                let failCount = 0;
                
                progressBar.style.width = '30%';
                progressPercent.textContent = '30%';
                progressStatus.textContent = 'ONNX MiniLM 모델을 로딩 중입니다...';
                writeDbLog("ONNX 384차원 임베딩 모델 로드 중...");

                const catalogName = dbPreviewItems[0]?.catalog_name || null;
                const result = await invoke('plugin:rag|ingest_reviewed_specs', {
                    items: itemsToIngest,
                    catalogName: catalogName
                });

                progressBar.style.width = '100%';
                progressPercent.textContent = '100%';
                progressStatus.textContent = '인입이 완료되었습니다!';
                document.getElementById('db-ingest-loading').style.display = 'none';

                // Backend returns IngestResult { indexed_count, errors }
                successCount = result.indexed_count || 0;
                failCount = itemsToIngest.length - successCount;
                
                document.getElementById('db-stat-success').textContent = successCount;
                document.getElementById('db-stat-failed').textContent = failCount;
                
                if (result.errors && result.errors.length > 0) {
                    result.errors.forEach(errMsg => writeDbLog(`[경고] ${errMsg}`, true));
                }
                
                if (successCount > 0) {
                    writeDbLog(`인입 완료! SQLite 및 LanceDB(벡터 인덱스) 적재 성공: ${successCount}건, 실패: ${failCount}건.`);
                    alert(`사양 데이터 인입 성공! (${successCount}개 항목 적재 완료)`);
                } else {
                    writeDbLog(`인입 실패: 모든 항목에서 오류가 발생했습니다.`, true);
                    alert("인입 실행 중 에러 발생: " + (result.errors ? result.errors.join(', ') : '알 수 없는 오류'));
                }

                // 검색 필터 dynamic 갱신
                await refreshDbSearchFilters();

            } catch (err) {
                document.getElementById('db-ingest-loading').style.display = 'none';
                writeDbLog(`2단계 인입 처리 에러: ${err}`, true);
                alert("인입 실행 중 오류가 발생했습니다: " + err);
            }
        });
    }

    // 6. [DB 검색] 하이브리드 검색 실행 버튼 이벤트
    const btnSearch = document.getElementById('btn-db-search');
    if (btnSearch) {
        btnSearch.addEventListener('click', async () => {
            await runDbHybridSearch();
        });
    }

    // 엔터키 입력 시 검색 실행 추가
    const dbSearchQueryInput = document.getElementById('db-search-query');
    if (dbSearchQueryInput) {
        dbSearchQueryInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                await runDbHybridSearch();
            }
        });
    }
}

// 프리뷰 테이블을 화면에 그리는 함수
function renderDbPreviewTable() {
    const tbody = document.getElementById('db-preview-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    
    if (dbPreviewItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-secondary);">해당 폴더에 파싱 가능한 JSON 파일이 존재하지 않습니다.</td></tr>`;
        document.getElementById('db-preview-section').style.display = 'none';
        return;
    }

    document.getElementById('db-preview-count').textContent = `분석 대상: ${dbPreviewItems.length}개 항목`;
    document.getElementById('db-preview-section').style.display = 'block';

    dbPreviewItems.forEach((item, index) => {
        const row = document.createElement('tr');
        row.className = 'db-preview-item-row';
        row.setAttribute('data-index', index);
        row.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';

        // JSON 포맷 예쁘게 문자열로 전환
        const specJsonStr = JSON.stringify(item.spec_data || {}, null, 2);

        row.innerHTML = `
            <td style="padding: 10px; text-align: center;">
                <input type="checkbox" class="db-preview-item-checkbox" checked style="cursor: pointer;">
            </td>
            <td class="cell-part-number" contenteditable="true" style="padding: 10px; font-weight: 600; color: var(--accent-color); outline: none;">${escapeHtml(item.part_number || '')}</td>
            <td class="cell-manufacturer" contenteditable="true" style="padding: 10px; color: var(--text-color); outline: none;">${escapeHtml(item.manufacturer || '')}</td>
            <td class="cell-category" contenteditable="true" style="padding: 10px; color: var(--text-color); outline: none;">${escapeHtml(item.category || '')}</td>
            <td class="cell-spec-json" contenteditable="true" style="padding: 10px; font-family: 'Consolas', monospace; color: #a9b1d6; white-space: pre-wrap; outline: none; font-size: 11px;">${escapeHtml(specJsonStr)}</td>
            <td style="padding: 10px; color: var(--text-muted); font-size: 11px;">${escapeHtml(item.source_file || '')}</td>
        `;

        tbody.appendChild(row);
    });
}

// 하이브리드 검색 실행 핵심 로직
async function runDbHybridSearch() {
    const query = document.getElementById('db-search-query').value.trim();
    const category = document.getElementById('db-search-category').value;
    const manufacturer = document.getElementById('db-search-manufacturer').value;
    const catalogName = document.getElementById('db-search-catalog').value;
    const limit = parseInt(document.getElementById('db-search-limit').value) || 10;

    const resultsContainer = document.getElementById('db-search-results');
    if (!resultsContainer) return;

    try {
        resultsContainer.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 0; gap: 12px;">
                <img src="assets/typing_3.gif" style="height: 60px; opacity:0.8;" alt="검색중">
                <div style="color: var(--accent-color); font-weight:600; font-size:13px;">실시간 하이브리드 시맨틱 쿼리를 처리하는 중입니다...</div>
            </div>
        `;

        // Rust Tauri 커맨드 호출
        const results = await invoke('plugin:rag|search_hybrid_specs', {
            queryText: query,
            category: category || null,
            manufacturer: manufacturer || null,
            catalogName: catalogName || null,
            limit: limit
        });

        resultsContainer.innerHTML = '';
        document.getElementById('db-search-results-count').textContent = `조회된 항목: ${results.length}개`;

        if (results.length === 0) {
            resultsContainer.innerHTML = `
                <div style="color: var(--text-secondary); text-align: center; padding: 40px 0; border: 1px dashed var(--card-border); border-radius: 12px; background: rgba(0,0,0,0.1); font-size: 13px;">
                    검색 결과가 존재하지 않습니다. 검색어나 필터 설정을 변경해 보세요.
                </div>
            `;
            return;
        }

        results.forEach(res => {
            const card = document.createElement('div');
            card.className = 'search-result-card';
            card.style.background = 'rgba(255, 255, 255, 0.02)';
            card.style.border = '1px solid var(--card-border)';
            card.style.borderRadius = '16px';
            card.style.padding = '20px';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.gap = '14px';
            card.style.transition = 'all 0.3s ease';
            card.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.15)';

            // 마우스 호버 효과
            card.onmouseover = () => {
                card.style.transform = 'translateY(-2px)';
                card.style.borderColor = 'rgba(255, 140, 0, 0.4)';
                card.style.boxShadow = '0 6px 24px rgba(255, 140, 0, 0.1)';
            };
            card.onmouseout = () => {
                card.style.transform = 'none';
                card.style.borderColor = 'var(--card-border)';
                card.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.15)';
            };

            // 유사도 스코어 바 렌더링
            let similarityHtml = '';
            if (res.similarity_score !== undefined && query.length > 0) {
                const scorePercent = Math.round(res.similarity_score * 100);
                similarityHtml = `
                    <div style="display: flex; flex-direction: column; gap: 4px; width: 100%; max-width: 250px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                            <span style="color: var(--text-secondary); font-weight: 500;">시맨틱 유사도</span>
                            <span style="color: var(--accent-color); font-weight: 700;">${scorePercent}%</span>
                        </div>
                        <div style="width: 100%; height: 6px; background: rgba(255, 255, 255, 0.05); border-radius: 3px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.05);">
                            <div style="width: ${scorePercent}%; height: 100%; background: linear-gradient(90deg, var(--accent-color), #ff8c00); border-radius: 3px;"></div>
                        </div>
                    </div>
                `;
            } else {
                similarityHtml = `
                    <span style="font-size: 11px; color: var(--text-muted); background: rgba(255, 255, 255, 0.04); padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.03);">
                        ⚡ 메타데이터 매칭 (SQL 필터)
                    </span>
                `;
            }

            // 스펙 데이터를 키-값 테이블 형식으로 이쁘게 그리기
            let specTableRows = '';
            let specObj = {};
            if (typeof res.spec_data === 'string') {
                try {
                    specObj = JSON.parse(res.spec_data);
                } catch(e) {
                    specObj = {};
                }
            } else {
                specObj = res.spec_data || {};
            }

            Object.entries(specObj).forEach(([key, val]) => {
                let displayVal = val;
                if (typeof val === 'object') {
                    displayVal = JSON.stringify(val);
                }
                specTableRows += `
                    <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.03);">
                        <td style="padding: 6px 12px; font-weight: 600; color: var(--text-secondary); width: 35%; background: rgba(255, 255, 255, 0.01); border-right: 1px solid rgba(255, 255, 255, 0.03);">${escapeHtml(key)}</td>
                        <td style="padding: 6px 12px; color: var(--text-primary); font-family: 'Consolas', monospace; font-size: 12px;">${escapeHtml(String(displayVal))}</td>
                    </tr>
                `;
            });

            if (!specTableRows) {
                specTableRows = `<tr><td colspan="2" style="padding: 8px 12px; text-align: center; color: var(--text-muted);">스펙 상세 항목 정보가 비어있습니다.</td></tr>`;
            }

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px;">
                            <h3 style="margin: 0; font-size: 18px; font-weight: 700; color: var(--text-primary);">${escapeHtml(res.part_number)}</h3>
                            <span style="font-size: 11px; background: rgba(255, 140, 0, 0.15); color: var(--accent-color); padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(255, 140, 0, 0.2); font-weight: 600;">
                                ${escapeHtml(res.category)}
                            </span>
                            <span style="font-size: 11px; background: rgba(255, 255, 255, 0.05); color: var(--text-secondary); padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.05);">
                                ${escapeHtml(res.manufacturer)}
                            </span>
                        </div>
                        <div style="font-size: 12px; color: var(--text-muted);">
                            <span>카탈로그: <strong>${escapeHtml(res.catalog_name)}</strong></span>
                            <span style="margin: 0 8px;">|</span>
                            <span>출처 파일: <strong>${escapeHtml(res.source_file)}</strong></span>
                        </div>
                    </div>
                    <div>
                        ${similarityHtml}
                    </div>
                </div>

                <div style="border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 10px; background: rgba(0, 0, 0, 0.15); overflow: hidden;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
                        <tbody>
                            ${specTableRows}
                        </tbody>
                    </table>
                </div>
            `;

            resultsContainer.appendChild(card);
        });

    } catch (err) {
        console.error("Hybrid Search Error:", err);
        resultsContainer.innerHTML = `
            <div style="color: #ef4444; text-align: center; padding: 40px 0; border: 1px dashed rgba(239, 68, 68, 0.3); border-radius: 12px; background: rgba(239, 68, 68, 0.05); font-size: 13px;">
                ❌ 검색 오류 발생: ${err}
            </div>
        `;
    }
}

// SQLite 메타데이터 필터 조건 dynamic 갱신
async function refreshDbSearchFilters() {
    const categorySelect = document.getElementById('db-search-category');
    const manufacturerSelect = document.getElementById('db-search-manufacturer');
    const catalogSelect = document.getElementById('db-search-catalog');

    if (!categorySelect || !manufacturerSelect || !catalogSelect) return;

    try {
        const metadata = await invoke('plugin:rag|get_unique_metadata');

        // 분류 갱신
        const currentCategory = categorySelect.value;
        categorySelect.innerHTML = '<option value="">전체 분류</option>';
        if (metadata.categories) {
            metadata.categories.forEach(cat => {
                if (cat) {
                    const opt = document.createElement('option');
                    opt.value = cat;
                    opt.textContent = cat;
                    if (cat === currentCategory) opt.selected = true;
                    categorySelect.appendChild(opt);
                }
            });
        }

        // 제조사 갱신
        const currentManufacturer = manufacturerSelect.value;
        manufacturerSelect.innerHTML = '<option value="">전체 제조사</option>';
        if (metadata.manufacturers) {
            metadata.manufacturers.forEach(mfg => {
                if (mfg) {
                    const opt = document.createElement('option');
                    opt.value = mfg;
                    opt.textContent = mfg;
                    if (mfg === currentManufacturer) opt.selected = true;
                    manufacturerSelect.appendChild(opt);
                }
            });
        }

        // 카탈로그 갱신
        const currentCatalog = catalogSelect.value;
        catalogSelect.innerHTML = '<option value="">전체 카탈로그</option>';
        if (metadata.catalog_names) {
            metadata.catalog_names.forEach(catName => {
                if (catName) {
                    const opt = document.createElement('option');
                    opt.value = catName;
                    opt.textContent = catName;
                    if (catName === currentCatalog) opt.selected = true;
                    catalogSelect.appendChild(opt);
                }
            });
        }

        console.log("DB Search Filter Dropdowns dynamically refreshed.");
    } catch (err) {
        console.error("Failed to dynamic refresh filters:", err);
    }
}

// HTML 특수기호 이스케이프 헬퍼
function escapeHtml(text) {
    if (!text) return '';
    return text
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ==========================================
// ====== 수주DB 관리자 (Orders DB) 모듈 ======
// ==========================================

let currentOrders = [];

// 수주DB 이벤트 리스너 설정
function setupOrderDb() {
    console.log("Setting up Order DB event listeners...");
    
    // 1. Form Tab Switching Logic
    const tabButtons = document.querySelectorAll('.form-tab');
    tabButtons.forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const targetTab = btn.getAttribute('data-form-tab');
            document.getElementById('form-panel-basic').style.display = 'none';
            document.getElementById('form-panel-pricing').style.display = 'none';
            document.getElementById('form-panel-delivery').style.display = 'none';
            
            const panel = document.getElementById(`form-panel-${targetTab}`);
            if (panel) panel.style.display = 'flex';
        };
    });

    // 2. Export Excel Template Action
    const btnExportTemplate = document.getElementById('btn-export-excel-template');
    if (btnExportTemplate) {
        btnExportTemplate.onclick = async () => {
            if (!window.__TAURI__ || !window.__TAURI__.dialog) {
                alert("Tauri API가 로드되지 않았습니다.");
                return;
            }
            try {
                const savePath = await window.__TAURI__.dialog.save({
                    title: "수주매출 현황 엑셀 양식 저장",
                    defaultPath: "수주매출_현황_양식.xlsx",
                    filters: [{ name: "Excel Files", extensions: ["xlsx"] }]
                });
                
                if (savePath) {
                    console.log("Exporting template to:", savePath);
                    await invoke('plugin:orders|export_excel_template', { filePath: savePath });
                    alert("수주매출 현황 엑셀 양식이 성공적으로 내보내기 되었습니다!");
                }
            } catch (err) {
                console.error("Failed to export template:", err);
                alert("양식 내보내기 실패: " + err);
            }
        };
    }

    // 3. Import Excel Orders Action
    const btnImportOrders = document.getElementById('btn-import-excel-orders');
    if (btnImportOrders) {
        btnImportOrders.onclick = async () => {
            if (!window.__TAURI__ || !window.__TAURI__.dialog) {
                alert("Tauri API가 로드되지 않았습니다.");
                return;
            }
            try {
                const openPath = await window.__TAURI__.dialog.open({
                    title: "수주매출 엑셀 파일 가져오기",
                    filters: [{ name: "Excel Files", extensions: ["xlsx", "xlsm"] }]
                });
                
                if (openPath) {
                    console.log("Importing excel orders from:", openPath);
                    
                    // Show progress status
                    const btnText = btnImportOrders.innerHTML;
                    btnImportOrders.disabled = true;
                    btnImportOrders.innerHTML = "<span>⏳</span> 임포트 중...";
                    
                    const resultMsg = await invoke('plugin:orders|import_excel_orders', {
                        ownerId: currentUser.id,
                        filePath: openPath
                    });
                    
                    btnImportOrders.disabled = false;
                    btnImportOrders.innerHTML = btnText;
                    
                    alert(resultMsg);
                    await refreshOrders();
                }
            } catch (err) {
                console.error("Failed to import orders:", err);
                const btnImport = document.getElementById('btn-import-excel-orders');
                if (btnImport) {
                    btnImport.disabled = false;
                    btnImport.innerHTML = "<span>📊</span> 엑셀 가져오기";
                }
                alert("엑셀 데이터 가져오기 실패: " + err);
            }
        };
    }

    // 4. Dynamic Auto-calculation Form triggers
    const qtyInput = document.getElementById('order-qty');
    const priceInput = document.getElementById('order-price');
    const amountInput = document.getElementById('order-amount');

    const handleAutoCalc = () => {
        const qty = parseInt(qtyInput.value) || 0;
        const price = parseInt(priceInput.value) || 0;
        amountInput.value = qty * price;
    };
    if (qtyInput) qtyInput.oninput = handleAutoCalc;
    if (priceInput) priceInput.oninput = handleAutoCalc;

    // 5. Year change chart redraw
    const chartYearSelect = document.getElementById('select-chart-year');
    if (chartYearSelect) {
        chartYearSelect.onchange = () => {
            renderOrdersChart();
            renderOrdersTable();
        };
    }

    const btnSave = document.getElementById('btn-save-order');
    if (btnSave) {
        btnSave.onclick = async () => {
            await saveOrder();
        };
    }

    const btnCancel = document.getElementById('btn-cancel-order-edit');
    if (btnCancel) {
        btnCancel.onclick = () => {
            cancelOrderEdit();
        };
    }

    const filterStatus = document.getElementById('filter-order-status');
    if (filterStatus) {
        filterStatus.onchange = () => {
            renderOrdersTable();
        };
    }

    const searchInput = document.getElementById('search-order');
    if (searchInput) {
        searchInput.oninput = () => {
            renderOrdersTable();
        };
    }

    // 전역 스코프에 핸들러 노출 (인라인 onclick 동작 보장)
    window.editOrder = editOrder;
    window.deleteOrder = deleteOrder;
}

// 수주 목록 새로고침 및 메트릭 산출
async function refreshOrders() {
    if (!currentUser) return;
    
    try {
        console.log("Refreshing orders from local isolated SQLite db...");
        const orders = await invoke('plugin:orders|get_orders', { ownerId: currentUser.id });
        currentOrders = orders || [];
        
        renderOrdersTable();
        renderOrdersChart();
    } catch (err) {
        console.error("Failed to fetch orders from SQLite:", err);
    }
}

// 수주 목록 테이블 렌더링 및 통계 계산
function renderOrdersTable() {
    const tableBody = document.getElementById('order-table-body');
    if (!tableBody) return;

    const filterStatus = document.getElementById('filter-order-status');
    const searchInput = document.getElementById('search-order');
    const chartYearSelect = document.getElementById('select-chart-year');

    const statusFilter = filterStatus ? filterStatus.value : 'all';
    const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const selectedYear = chartYearSelect ? chartYearSelect.value : '2026';

    // 필터링 적용
    const filteredOrders = currentOrders.filter(order => {
        const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
        
        const clientText = (order.client || '').toLowerCase();
        const productText = (order.product_name || '').toLowerCase();
        const codeText = (order.project_code || '').toLowerCase();
        
        const matchesSearch = searchQuery === '' || 
                              clientText.includes(searchQuery) || 
                              productText.includes(searchQuery) ||
                              codeText.includes(searchQuery);

        return matchesStatus && matchesSearch;
    });

    // 선택 연도 기준 누계 통계 연산
    let totalAmount = 0;
    let totalRevenue = 0;
    let totalCount = 0;
    let uncollectedCount = 0;

    currentOrders.forEach(order => {
        const orderDateStr = order.order_date || '';
        const orderYear = orderDateStr.split('-')[0];
        
        if (orderYear === selectedYear) {
            totalCount++;
            totalAmount += (order.order_amount || 0);
            
            // Uncollected logic: if actual delivery date exists but settlement amount < order amount
            const actualDeliv = order.actual_delivery_date || '';
            const set1 = order.settlement_1 || 0;
            const set2 = order.settlement_2 || 0;
            const collected = set1 + set2;
            const orderAmt = order.order_amount || 0;
            
            if (actualDeliv && collected < orderAmt) {
                uncollectedCount++;
            }
        }

        // Cumulative revenue calculation based on tax invoice issue dates for selected year
        const tax1Str = order.tax_invoice_1 || '';
        const tax2Str = order.tax_invoice_2 || '';
        if (tax1Str.startsWith(selectedYear)) {
            totalRevenue += (order.settlement_1 || 0);
        }
        if (tax2Str.startsWith(selectedYear)) {
            totalRevenue += (order.settlement_2 || 0);
        }
    });

    // 메트릭 엘리먼트 업데이트
    const statAmount = document.getElementById('order-stat-total-amount');
    const statRevenue = document.getElementById('order-stat-total-revenue');
    const statCount = document.getElementById('order-stat-total-count');
    const statUncollected = document.getElementById('order-stat-uncollected-count');

    if (statAmount) statAmount.textContent = `₩${totalAmount.toLocaleString()}`;
    if (statRevenue) statRevenue.textContent = `₩${totalRevenue.toLocaleString()}`;
    if (statCount) statCount.textContent = `${totalCount}건`;
    if (statUncollected) statUncollected.textContent = `${uncollectedCount}건`;

    // 테이블 행 렌더링
    tableBody.innerHTML = '';
    if (filteredOrders.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="22" style="text-align: center; color: var(--text-secondary); padding: 40px 0;">
                    검색 조건에 맞는 수주 정보가 없습니다.
                </td>
            </tr>
        `;
        return;
    }

    filteredOrders.forEach(order => {
        const id = order.id;
        const orderDate = order.order_date || '-';
        const projectCode = escapeHtml(order.project_code || '-');
        const category = escapeHtml(order.category || '-');
        const client = escapeHtml(order.client);
        const clientPoNum = escapeHtml(order.client_po_num || '-');
        const productName = escapeHtml(order.product_name || '-');
        const clientManager = escapeHtml(order.client_manager || '-');
        const salesManager = escapeHtml(order.sales_manager || '-');
        const requestDate = order.request_date || '-';
        const purchasePlace = escapeHtml(order.purchase_place || '-');
        const qty = order.qty !== null ? order.qty : '-';
        const orderPrice = order.order_price !== null ? `₩${order.order_price.toLocaleString()}` : '-';
        const orderAmount = `₩${(order.order_amount || 0).toLocaleString()}`;
        const estimateDeliveryDate = order.estimate_delivery_date || '-';
        const actualDeliveryDate = order.actual_delivery_date || '-';
        const taxInvoice1 = order.tax_invoice_1 || '-';
        const taxInvoice2 = order.tax_invoice_2 || '-';
        const settlement1 = order.settlement_1 !== null ? `₩${order.settlement_1.toLocaleString()}` : '-';
        const settlement2 = order.settlement_2 !== null ? `₩${order.settlement_2.toLocaleString()}` : '-';
        const status = order.status || '대기';
        const description = escapeHtml(order.description || '-');

        // 상태별 뱃지 스타일
        let badgeBg = 'rgba(100, 116, 139, 0.15)';
        let badgeColor = '#64748b';
        if (status === '진행중') {
            badgeBg = 'rgba(59, 130, 246, 0.15)';
            badgeColor = '#3b82f6';
        } else if (status === '완료') {
            badgeBg = 'rgba(16, 185, 129, 0.15)';
            badgeColor = '#10b981';
        } else if (status === '보류') {
            badgeBg = 'rgba(245, 158, 11, 0.15)';
            badgeColor = '#f59e0b';
        }

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.04)';
        tr.style.transition = 'background-color 0.2s';
        tr.onmouseover = () => tr.style.backgroundColor = 'rgba(255, 255, 255, 0.01)';
        tr.onmouseout = () => tr.style.backgroundColor = 'transparent';

        tr.innerHTML = `
            <td class="order-grid-td" style="text-align: center; display: flex; gap: 4px; justify-content: center; align-items: center; border-bottom: none; height: 38px;">
                <span style="color: var(--accent-color); cursor: pointer; font-weight:600;" onclick="editOrder(${id})">✍️</span>
                <span style="color: #ff5555; cursor: pointer; font-weight:600;" onclick="deleteOrder(${id})">❌</span>
            </td>
            <td class="order-grid-td" style="text-align: center; font-family: monospace;">${orderDate}</td>
            <td class="order-grid-td" style="font-weight: 500;">${projectCode}</td>
            <td class="order-grid-td" style="text-align: center;">${category}</td>
            <td class="order-grid-td" style="font-weight: 600; color: var(--text-color);">${client}</td>
            <td class="order-grid-td">${clientPoNum}</td>
            <td class="order-grid-td">${productName}</td>
            <td class="order-grid-td" style="text-align: center;">${clientManager}</td>
            <td class="order-grid-td" style="text-align: center;">${salesManager}</td>
            <td class="order-grid-td" style="text-align: center; font-family: monospace;">${requestDate}</td>
            <td class="order-grid-td">${purchasePlace}</td>
            <td class="order-grid-td" style="text-align: center;">${qty}</td>
            <td class="order-grid-td" style="text-align: right; font-family: monospace;">${orderPrice}</td>
            <td class="order-grid-td" style="text-align: right; font-weight: 600; color: var(--accent-color); font-family: monospace;">${orderAmount}</td>
            <td class="order-grid-td" style="text-align: center; font-family: monospace;">${estimateDeliveryDate}</td>
            <td class="order-grid-td" style="text-align: center; font-family: monospace;">${actualDeliveryDate}</td>
            <td class="order-grid-td" style="text-align: center; font-family: monospace;">${taxInvoice1}</td>
            <td class="order-grid-td" style="text-align: center; font-family: monospace;">${taxInvoice2}</td>
            <td class="order-grid-td" style="text-align: right; color: #50fa7b; font-family: monospace;">${settlement1}</td>
            <td class="order-grid-td" style="text-align: right; color: #50fa7b; font-family: monospace;">${settlement2}</td>
            <td class="order-grid-td" style="text-align: center;">
                <span style="background: ${badgeBg}; color: ${badgeColor}; padding: 3px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; border: 1px solid ${badgeColor}30;">${status}</span>
            </td>
            <td class="order-grid-td">${description}</td>
        `;
        tableBody.appendChild(tr);
    });
}

// Monthly Comparison Chart renderer inside SVG
function renderOrdersChart() {
    const container = document.getElementById('order-chart-container');
    if (!container) return;

    const chartYearSelect = document.getElementById('select-chart-year');
    const selectedYear = chartYearSelect ? chartYearSelect.value : '2026';

    // 12 months array initialization
    let monthlyOrders = Array(12).fill(0);
    let monthlySales = Array(12).fill(0);

    // Compute live values from currentOrders
    currentOrders.forEach(order => {
        const orderDateStr = order.order_date || '';
        const parts = orderDateStr.split('-');
        if (parts.length === 3 && parts[0] === selectedYear) {
            const mIdx = parseInt(parts[1]) - 1;
            if (mIdx >= 0 && mIdx < 12) {
                monthlyOrders[mIdx] += (order.order_amount || 0);
            }
        }

        // 매출 인식 logic
        const tax1Str = order.tax_invoice_1 || '';
        const tax2Str = order.tax_invoice_2 || '';
        const tax1Parts = tax1Str.split('-');
        const tax2Parts = tax2Str.split('-');

        if (tax1Parts.length === 3 && tax1Parts[0] === selectedYear) {
            const mIdx = parseInt(tax1Parts[1]) - 1;
            if (mIdx >= 0 && mIdx < 12) {
                monthlySales[mIdx] += (order.settlement_1 || 0);
            }
        }
        if (tax2Parts.length === 3 && tax2Parts[0] === selectedYear) {
            const mIdx = parseInt(tax2Parts[1]) - 1;
            if (mIdx >= 0 && mIdx < 12) {
                monthlySales[mIdx] += (order.settlement_2 || 0);
            }
        }
    });

    // Find the max value to scale the chart dynamically
    const maxVal = Math.max(...monthlyOrders, ...monthlySales, 50000000); // minimum scale ceiling 5,000만원
    
    // Draw SVG Chart
    const width = container.clientWidth || 800;
    const height = 220;
    const paddingLeft = 90;
    const paddingRight = 30;
    const paddingTop = 30;
    const paddingBottom = 30;
    
    const graphWidth = width - paddingLeft - paddingRight;
    const graphHeight = height - paddingTop - paddingBottom;

    let svgHtml = `<svg width="${width}" height="${height}" style="background: transparent; font-family: inherit;">`;

    // 1. Grid horizontal lines & Y Labels
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
        const y = paddingTop + (graphHeight / gridLines) * i;
        const val = maxVal - (maxVal / gridLines) * i;
        const formattedVal = (val / 1000000).toFixed(0) + "M"; // in Millions (₩)
        
        svgHtml += `
            <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3" />
            <text x="${paddingLeft - 12}" y="${y + 4}" fill="var(--text-secondary)" font-size="10.5" text-anchor="end">${formattedVal}</text>
        `;
    }

    // 2. Draw 12 Months Bars & month labels
    const barSpacing = graphWidth / 12;
    const innerBarWidth = barSpacing * 0.32;

    for (let m = 0; m < 12; m++) {
        const xCenter = paddingLeft + barSpacing * m + barSpacing / 2;
        
        // Month Label
        svgHtml += `
            <text x="${xCenter}" y="${height - 10}" fill="var(--text-secondary)" font-size="11" text-anchor="middle" font-weight="500">${m + 1}월</text>
        `;

        // a) 수주금액 Bar (Dracula Purple)
        const orderVal = monthlyOrders[m];
        const orderBarHeight = (orderVal / maxVal) * graphHeight;
        const orderY = height - paddingBottom - orderBarHeight;
        const orderX = xCenter - innerBarWidth - 2;

        if (orderVal > 0) {
            svgHtml += `
                <rect x="${orderX}" y="${orderY}" width="${innerBarWidth}" height="${orderBarHeight}" fill="#bd93f9" rx="3" style="transition: all 0.3s;" />
                <!-- Hover value label -->
                <text x="${orderX + innerBarWidth / 2}" y="${orderY - 6}" fill="#bd93f9" font-size="9" text-anchor="middle" font-weight="600">${(orderVal / 1000000).toFixed(0)}M</text>
            `;
        }

        // b) 매출금액 Bar (Dracula Green)
        const salesVal = monthlySales[m];
        const salesBarHeight = (salesVal / maxVal) * graphHeight;
        const salesY = height - paddingBottom - salesBarHeight;
        const salesX = xCenter + 2;

        if (salesVal > 0) {
            svgHtml += `
                <rect x="${salesX}" y="${salesY}" width="${innerBarWidth}" height="${salesBarHeight}" fill="#50fa7b" rx="3" style="transition: all 0.3s;" />
                <!-- Hover value label -->
                <text x="${salesX + innerBarWidth / 2}" y="${salesY - 6}" fill="#50fa7b" font-size="9" text-anchor="middle" font-weight="600">${(salesVal / 1000000).toFixed(0)}M</text>
            `;
        }
    }

    // Baseline axis
    svgHtml += `
        <line x1="${paddingLeft}" y1="${height - paddingBottom}" x2="${width - paddingRight}" y2="${height - paddingBottom}" stroke="rgba(255,255,255,0.15)" stroke-width="1.2" />
    `;

    svgHtml += `</svg>`;
    container.innerHTML = svgHtml;
}

// 신규 수주 저장 또는 기존 수정
async function saveOrder() {
    if (!currentUser) return;

    const idInput = document.getElementById('order-id-input');
    const categorySelect = document.getElementById('order-category');
    const orderDateInput = document.getElementById('order-date');
    const projectCodeInput = document.getElementById('order-project-code');
    const clientInput = document.getElementById('order-client');
    const clientPoNumInput = document.getElementById('order-client-po-num');
    const productNameInput = document.getElementById('order-product-name');
    const clientManagerInput = document.getElementById('order-client-manager');
    const salesManagerInput = document.getElementById('order-sales-manager');
    const requestDateInput = document.getElementById('order-request-date');
    const purchasePlaceInput = document.getElementById('order-purchase-place');
    const qtyInput = document.getElementById('order-qty');
    const priceInput = document.getElementById('order-price');
    const amountInput = document.getElementById('order-amount');
    const estimateDeliveryInput = document.getElementById('order-estimate-delivery-date');
    const actualDeliveryInput = document.getElementById('order-actual-delivery-date');
    const taxInvoice1Input = document.getElementById('order-tax-invoice-1');
    const taxInvoice2Input = document.getElementById('order-tax-invoice-2');
    const settlement1Input = document.getElementById('order-settlement-1');
    const settlement2Input = document.getElementById('order-settlement-2');
    const statusSelect = document.getElementById('order-status');
    const descTextarea = document.getElementById('order-description');

    const client = clientInput ? clientInput.value.trim() : '';
    if (!client) {
        alert("고객사명을 입력해 주세요.");
        return;
    }

    const orderId = idInput && idInput.value ? parseInt(idInput.value) : null;
    
    // Auto-calculate order amount
    const qty = qtyInput ? parseInt(qtyInput.value) : null;
    const price = priceInput ? parseInt(priceInput.value) : null;
    const calculatedAmount = (qty !== null && price !== null) ? qty * price : (amountInput ? parseInt(amountInput.value) : 0);

    const orderDto = {
        id: orderId,
        owner_id: currentUser.id,
        order_date: orderDateInput ? orderDateInput.value || null : null,
        project_code: projectCodeInput ? projectCodeInput.value.trim() || null : null,
        category: categorySelect ? categorySelect.value || null : null,
        client: client,
        client_po_num: clientPoNumInput ? clientPoNumInput.value.trim() || null : null,
        product_name: productNameInput ? productNameInput.value.trim() || null : null,
        client_manager: clientManagerInput ? clientManagerInput.value.trim() || null : null,
        sales_manager: salesManagerInput ? salesManagerInput.value.trim() || null : null,
        request_date: requestDateInput ? requestDateInput.value || null : null,
        purchase_place: purchasePlaceInput ? purchasePlaceInput.value.trim() || null : null,
        qty: qty,
        order_price: price,
        order_amount: calculatedAmount,
        estimate_delivery_date: estimateDeliveryInput ? estimateDeliveryInput.value || null : null,
        actual_delivery_date: actualDeliveryInput ? actualDeliveryInput.value || null : null,
        tax_invoice_1: taxInvoice1Input ? taxInvoice1Input.value || null : null,
        tax_invoice_2: taxInvoice2Input ? taxInvoice2Input.value || null : null,
        settlement_1: settlement1Input ? parseInt(settlement1Input.value) || null : null,
        settlement_2: settlement2Input ? parseInt(settlement2Input.value) || null : null,
        description: descTextarea ? descTextarea.value.trim() || null : null,
        status: statusSelect ? statusSelect.value : '대기',
        created_at: "", // Rust will fill if new
        is_deleted: false
    };

    const btnSave = document.getElementById('btn-save-order');
    let originalHtml = "";
    if (btnSave) {
        originalHtml = btnSave.innerHTML;
        btnSave.disabled = true;
        btnSave.innerHTML = "<span>⏳</span> 저장 중...";
    }

    try {
        console.log("Saving order DTO to isolated SQLite...", orderDto);
        await invoke('plugin:orders|save_order', { order: orderDto });
        
        cancelOrderEdit();
        await refreshOrders();
    } catch (err) {
        console.error("Failed to save order in SQLite:", err);
        alert("수주 정보를 저장하지 못했습니다: " + err);
    } finally {
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = originalHtml;
        }
    }
}

// 기존 수주 정보 수정 모드 돌입
function editOrder(orderId) {
    const order = currentOrders.find(o => o.id === orderId);
    if (!order) return;

    // Reset tabs back to "basic"
    const basicTabBtn = document.querySelector('.form-tab[data-form-tab="basic"]');
    if (basicTabBtn) basicTabBtn.click();

    const idInput = document.getElementById('order-id-input');
    const categorySelect = document.getElementById('order-category');
    const orderDateInput = document.getElementById('order-date');
    const projectCodeInput = document.getElementById('order-project-code');
    const clientInput = document.getElementById('order-client');
    const clientPoNumInput = document.getElementById('order-client-po-num');
    const productNameInput = document.getElementById('order-product-name');
    const clientManagerInput = document.getElementById('order-client-manager');
    const salesManagerInput = document.getElementById('order-sales-manager');
    const requestDateInput = document.getElementById('order-request-date');
    const purchasePlaceInput = document.getElementById('order-purchase-place');
    const qtyInput = document.getElementById('order-qty');
    const priceInput = document.getElementById('order-price');
    const amountInput = document.getElementById('order-amount');
    const estimateDeliveryInput = document.getElementById('order-estimate-delivery-date');
    const actualDeliveryInput = document.getElementById('order-actual-delivery-date');
    const taxInvoice1Input = document.getElementById('order-tax-invoice-1');
    const taxInvoice2Input = document.getElementById('order-tax-invoice-2');
    const settlement1Input = document.getElementById('order-settlement-1');
    const settlement2Input = document.getElementById('order-settlement-2');
    const statusSelect = document.getElementById('order-status');
    const descTextarea = document.getElementById('order-description');

    const formTitle = document.getElementById('order-form-title');
    const btnCancel = document.getElementById('btn-cancel-order-edit');

    if (idInput) idInput.value = order.id;
    if (categorySelect) categorySelect.value = order.category || '상품';
    if (orderDateInput) orderDateInput.value = order.order_date || '';
    if (projectCodeInput) projectCodeInput.value = order.project_code || '';
    if (clientInput) clientInput.value = order.client || '';
    if (clientPoNumInput) clientPoNumInput.value = order.client_po_num || '';
    if (productNameInput) productNameInput.value = order.product_name || '';
    if (clientManagerInput) clientManagerInput.value = order.client_manager || '';
    if (salesManagerInput) salesManagerInput.value = order.sales_manager || '';
    if (requestDateInput) requestDateInput.value = order.request_date || '';
    if (purchasePlaceInput) purchasePlaceInput.value = order.purchase_place || '';
    if (qtyInput) qtyInput.value = order.qty !== null ? order.qty : '';
    if (priceInput) priceInput.value = order.order_price !== null ? order.order_price : '';
    if (amountInput) amountInput.value = order.order_amount || 0;
    if (estimateDeliveryInput) estimateDeliveryInput.value = order.estimate_delivery_date || '';
    if (actualDeliveryInput) actualDeliveryInput.value = order.actual_delivery_date || '';
    if (taxInvoice1Input) taxInvoice1Input.value = order.tax_invoice_1 || '';
    if (taxInvoice2Input) taxInvoice2Input.value = order.tax_invoice_2 || '';
    if (settlement1Input) settlement1Input.value = order.settlement_1 !== null ? order.settlement_1 : '';
    if (settlement2Input) settlement2Input.value = order.settlement_2 !== null ? order.settlement_2 : '';
    if (statusSelect) statusSelect.value = order.status || '대기';
    if (descTextarea) descTextarea.value = order.description || '';

    if (formTitle) formTitle.innerHTML = "✏️ 수주 정보 수정";
    if (btnCancel) btnCancel.style.display = "inline-flex";

    // 폼으로 스크롤 이동
    const formElement = document.getElementById('order-form-title');
    if (formElement) formElement.scrollIntoView({ behavior: 'smooth' });
}

// 수정 취소 및 폼 리셋
function cancelOrderEdit() {
    const basicTabBtn = document.querySelector('.form-tab[data-form-tab="basic"]');
    if (basicTabBtn) basicTabBtn.click();

    const idInput = document.getElementById('order-id-input');
    const categorySelect = document.getElementById('order-category');
    const orderDateInput = document.getElementById('order-date');
    const projectCodeInput = document.getElementById('order-project-code');
    const clientInput = document.getElementById('order-client');
    const clientPoNumInput = document.getElementById('order-client-po-num');
    const productNameInput = document.getElementById('order-product-name');
    const clientManagerInput = document.getElementById('order-client-manager');
    const salesManagerInput = document.getElementById('order-sales-manager');
    const requestDateInput = document.getElementById('order-request-date');
    const purchasePlaceInput = document.getElementById('order-purchase-place');
    const qtyInput = document.getElementById('order-qty');
    const priceInput = document.getElementById('order-price');
    const amountInput = document.getElementById('order-amount');
    const estimateDeliveryInput = document.getElementById('order-estimate-delivery-date');
    const actualDeliveryInput = document.getElementById('order-actual-delivery-date');
    const taxInvoice1Input = document.getElementById('order-tax-invoice-1');
    const taxInvoice2Input = document.getElementById('order-tax-invoice-2');
    const settlement1Input = document.getElementById('order-settlement-1');
    const settlement2Input = document.getElementById('order-settlement-2');
    const statusSelect = document.getElementById('order-status');
    const descTextarea = document.getElementById('order-description');

    const formTitle = document.getElementById('order-form-title');
    const btnCancel = document.getElementById('btn-cancel-order-edit');

    if (idInput) idInput.value = "";
    if (categorySelect) categorySelect.value = "상품";
    if (orderDateInput) orderDateInput.value = "";
    if (projectCodeInput) projectCodeInput.value = "";
    if (clientInput) clientInput.value = "";
    if (clientPoNumInput) clientPoNumInput.value = "";
    if (productNameInput) productNameInput.value = "";
    if (clientManagerInput) clientManagerInput.value = "";
    if (salesManagerInput) salesManagerInput.value = "";
    if (requestDateInput) requestDateInput.value = "";
    if (purchasePlaceInput) purchasePlaceInput.value = "";
    if (qtyInput) qtyInput.value = "";
    if (priceInput) priceInput.value = "";
    if (amountInput) amountInput.value = "";
    if (estimateDeliveryInput) estimateDeliveryInput.value = "";
    if (actualDeliveryInput) actualDeliveryInput.value = "";
    if (taxInvoice1Input) taxInvoice1Input.value = "";
    if (taxInvoice2Input) taxInvoice2Input.value = "";
    if (settlement1Input) settlement1Input.value = "";
    if (settlement2Input) settlement2Input.value = "";
    if (statusSelect) statusSelect.value = "대기";
    if (descTextarea) descTextarea.value = "";

    if (formTitle) formTitle.innerHTML = "✍️ 수주 등록";
    if (btnCancel) btnCancel.style.display = "none";
}

// 수주 정보 소프트 삭제
async function deleteOrder(orderId) {
    const confirmDelete = await askConfirm("정말 이 수주 내역을 삭제하시겠습니까?", "수주 삭제");
    if (!confirmDelete) return;

    try {
        console.log(`Soft deleting order id ${orderId} in SQLite...`);
        await invoke('plugin:orders|delete_order', { orderId: orderId });
        await refreshOrders();
    } catch (err) {
        console.error("Failed to delete order in SQLite:", err);
        alert("수주 정보를 삭제하지 못했습니다: " + err);
    }
}

// ==========================================
// ⚙️ 모터사양 및 토크 계산기 기능 모듈 (Motor Calculator Module)
// ==========================================

let inertiaPoints = [
    { mass: 0.6, radius: 0.7 },
    { mass: 0.5, radius: 0.3 }
];
let rmsStages = [
    { duration: 1.0, torque: 1.0, speedRpm: 4.77 },
    { duration: 2.0, torque: 0.0, speedRpm: 9.55 },
    { duration: 1.0, torque: -1.0, speedRpm: 4.77 }
];

async function refreshMotorCalc() {
    console.log("Refreshing Motor Calculator...");
    
    // 1. Sub-tab click handler (Idempotency bound)
    const tabs = document.querySelectorAll('#motor-calc-tabs .view-tab');
    tabs.forEach(tab => {
        tab.onclick = (e) => {
            e.preventDefault();
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const selectedTab = tab.getAttribute('data-motor-tab');
            document.querySelectorAll('.motor-tab-panel').forEach(panel => {
                panel.style.display = 'none';
            });
            const targetPanel = document.getElementById(`panel-motor-${selectedTab}`);
            if (targetPanel) targetPanel.style.display = 'block';
            
            // Adjust conditional parameter visibility
            if (selectedTab === 'inertia') {
                const shapeSel = document.getElementById('select-inertia-shape');
                if (shapeSel) triggerInertiaShapeVisibility(shapeSel.value);
            }
        };
    });

    // 2. Shape Selector Visibility helper
    const shapeSelector = document.getElementById('select-inertia-shape');
    if (shapeSelector) {
        shapeSelector.onchange = () => {
            triggerInertiaShapeVisibility(shapeSelector.value);
        };
    }

    // 3. Setup core calculators (onclick triggers)
    
    // Torque Calculator
    const btnCalcTorque = document.getElementById('btn-calc-torque');
    if (btnCalcTorque) {
        btnCalcTorque.onclick = async () => {
            const inertia = parseFloat(document.getElementById('input-torque-inertia').value) || 0;
            const acceleration = parseFloat(document.getElementById('input-torque-accel').value) || 0;
            
            btnCalcTorque.disabled = true;
            try {
                const result = await invoke('plugin:motor|calculate_torque', { inertia, acceleration });
                document.getElementById('output-torque-nm').textContent = `${result.torque_nm.toFixed(3)} Nm`;
                document.getElementById('output-torque-ncm').textContent = `${result.torque_ncm.toFixed(1)} Ncm`;
                document.getElementById('output-torque-kgfcm').textContent = `${result.torque_kgfcm.toFixed(3)} kgf·cm`;
            } catch (err) {
                console.error("Torque calculation failed:", err);
                alert("토크 계산에 실패했습니다: " + err);
            } finally {
                btnCalcTorque.disabled = false;
            }
        };
    }

    // Inertia Calculator
    const btnCalcInertia = document.getElementById('btn-calc-inertia');
    if (btnCalcInertia) {
        btnCalcInertia.onclick = async () => {
            const shapeType = document.getElementById('select-inertia-shape').value;
            
            btnCalcInertia.disabled = true;
            try {
                let inertiaResult = 0.0;
                
                if (shapeType === 'multiple_points') {
                    // Sum point masses directly
                    for (const pt of inertiaPoints) {
                        const ptInertia = await invoke('plugin:motor|calculate_inertia', {
                            shapeType: 'point_mass',
                            mass: pt.mass,
                            radius: pt.radius,
                            length: 0.0
                        });
                        inertiaResult += ptInertia;
                    }
                } else {
                    let mass = parseFloat(document.getElementById('input-inertia-mass').value) || 0;
                    let radius = parseFloat(document.getElementById('input-inertia-radius').value) || 0;
                    let length = parseFloat(document.getElementById('input-inertia-length').value) || 0;
                    
                    const unitMass = document.getElementById('unit-inertia-mass').value;
                    const unitRadius = document.getElementById('unit-inertia-radius').value;
                    const unitLength = document.getElementById('unit-inertia-length').value;
                    
                    // Standardize units
                    if (unitMass === 'g') mass /= 1000.0;
                    if (unitRadius === 'cm') radius /= 100.0;
                    else if (unitRadius === 'mm') radius /= 1000.0;
                    if (unitLength === 'cm') length /= 100.0;
                    else if (unitLength === 'mm') length /= 1000.0;
                    
                    inertiaResult = await invoke('plugin:motor|calculate_inertia', {
                        shapeType,
                        mass,
                        radius,
                        length
                    });
                }
                
                // Display results
                document.getElementById('output-inertia-value').textContent = `${inertiaResult.toFixed(4)} kg·m²`;
                document.getElementById('output-inertia-kgcm').textContent = `${(inertiaResult * 10000.0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} kg·cm²`;
                document.getElementById('output-inertia-gcm').textContent = `${(inertiaResult * 10000000.0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} g·cm²`;
                
                // Set detail summary text
                const shapeLabel = shapeType === 'point_mass' ? '1점/링 관성' :
                                   shapeType === 'disc' ? '원판 관성' :
                                   shapeType === 'cylinder_center' ? '원통 가로축(중심)' :
                                   shapeType === 'cylinder_end' ? '원통 가로축(끝단)' : '다중 1점 관성 합산';
                document.getElementById('output-inertia-detail').textContent = `형상: ${shapeLabel} | 계산치: ${inertiaResult.toFixed(5)} kg·m²`;
                
                // Save calculated inertia to memory for application
                document.getElementById('btn-inertia-apply').onclick = () => {
                    const torqueInertiaInput = document.getElementById('input-torque-inertia');
                    if (torqueInertiaInput) {
                        torqueInertiaInput.value = inertiaResult.toFixed(5);
                        alert(`관성 모멘트치 [${inertiaResult.toFixed(5)} kg·m²]가 1번 탭 입력으로 적용되었습니다!`);
                        // Auto-switch to torque tab
                        const torqueTab = document.querySelector('#motor-calc-tabs [data-motor-tab="torque"]');
                        if (torqueTab) torqueTab.click();
                    }
                };
            } catch (err) {
                console.error("Inertia calculation failed:", err);
                alert("관성 모멘트 계산에 실패했습니다: " + err);
            } finally {
                btnCalcInertia.disabled = false;
            }
        };
    }

    // Speed Conversion Binders
    const inputConvVal = document.getElementById('input-conv-val');
    const selectConvFrom = document.getElementById('select-conv-from');
    
    const triggerSpeedConversion = async () => {
        const value = parseFloat(inputConvVal.value) || 0;
        const fromUnit = selectConvFrom.value;
        try {
            const rads = await invoke('plugin:motor|convert_speed', { value, fromUnit, toUnit: 'rads' });
            const rpm = await invoke('plugin:motor|convert_speed', { value, fromUnit, toUnit: 'rpm' });
            const degs = await invoke('plugin:motor|convert_speed', { value, fromUnit, toUnit: 'degs' });
            
            document.getElementById('output-speed-rads').textContent = `${rads.toFixed(3)} rad/sec`;
            document.getElementById('output-speed-rpm').textContent = `${rpm.toFixed(1)} rpm`;
            document.getElementById('output-speed-degs').textContent = `${degs.toFixed(3)} deg/sec`;
        } catch (err) {
            console.error("Speed conversion failed:", err);
        }
    };
    
    if (inputConvVal) inputConvVal.oninput = triggerSpeedConversion;
    if (selectConvFrom) selectConvFrom.onchange = triggerSpeedConversion;

    // Angular Acceleration Solver
    const btnAccelApply = document.getElementById('btn-accelsolver-apply');
    const inputSolverTime = document.getElementById('input-accelsolver-time');
    const inputSolverV0 = document.getElementById('input-accelsolver-v0');
    const inputSolverVt = document.getElementById('input-accelsolver-vt');
    const selectSolverUnit = document.getElementById('select-accelsolver-unit');

    const triggerAccelSolve = async () => {
        const time = parseFloat(inputSolverTime.value) || 0;
        const initialSpeed = parseFloat(inputSolverV0.value) || 0;
        const finalSpeed = parseFloat(inputSolverVt.value) || 0;
        const unit = selectSolverUnit.value;
        
        if (time <= 0) {
            document.getElementById('output-accelsolver-val').textContent = "시간 오류 (Time > 0)";
            return;
        }
        
        try {
            const alpha = await invoke('plugin:motor|calculate_angular_acceleration', {
                initialSpeed,
                finalSpeed,
                time,
                unit
            });
            document.getElementById('output-accelsolver-val').textContent = `${alpha.toFixed(3)} rad/s²`;
            
            btnAccelApply.onclick = () => {
                const torqueAccelInput = document.getElementById('input-torque-accel');
                if (torqueAccelInput) {
                    torqueAccelInput.value = alpha.toFixed(3);
                    alert(`도출된 각가속도 [${alpha.toFixed(3)} rad/s²]가 1번 탭 입력으로 적용되었습니다!`);
                    // Switch tab
                    const torqueTab = document.querySelector('#motor-calc-tabs [data-motor-tab="torque"]');
                    if (torqueTab) torqueTab.click();
                }
            };
        } catch (err) {
            console.error("Acceleration solve failed:", err);
            document.getElementById('output-accelsolver-val').textContent = "오류";
        }
    };

    if (inputSolverTime) inputSolverTime.oninput = triggerAccelSolve;
    if (inputSolverV0) inputSolverV0.oninput = triggerAccelSolve;
    if (inputSolverVt) inputSolverVt.oninput = triggerAccelSolve;
    if (selectSolverUnit) selectSolverUnit.onchange = triggerAccelSolve;

    // Combined Torque Calculator
    const btnCalcCombined = document.getElementById('btn-calc-combined');
    if (btnCalcCombined) {
        btnCalcCombined.onclick = async () => {
            const mass = parseFloat(document.getElementById('input-comb-mass').value) || 0;
            const armLength = parseFloat(document.getElementById('input-comb-length').value) || 0;
            const angleDeg = parseFloat(document.getElementById('input-comb-angle').value) || 0;
            const acceleration = parseFloat(document.getElementById('input-comb-accel').value) || 0;
            
            btnCalcCombined.disabled = true;
            try {
                const result = await invoke('plugin:motor|calculate_combined_torque', {
                    mass,
                    armLength,
                    angleDeg,
                    acceleration
                });
                
                document.getElementById('output-comb-ta').textContent = `${result.torque_acceleration.toFixed(2)} Nm`;
                document.getElementById('output-comb-tg').textContent = `${result.torque_gravity.toFixed(2)} Nm`;
                document.getElementById('output-comb-total').textContent = `${result.torque_total.toFixed(2)} Nm`;
            } catch (err) {
                console.error("Combined torque failed:", err);
                alert("가속+중력 합산 계산에 실패했습니다: " + err);
            } finally {
                btnCalcCombined.disabled = false;
            }
        };
    }

    // Motor Specs Calculator
    const btnCalcSpecs = document.getElementById('btn-calc-specs');
    if (btnCalcSpecs) {
        btnCalcSpecs.onclick = async () => {
            const voltageIn = parseFloat(document.getElementById('input-specs-vin').value) || 0;
            const kbVKrpm = parseFloat(document.getElementById('input-specs-kb').value) || 0;
            const torqueRequired = parseFloat(document.getElementById('input-specs-tr').value) || 0;
            
            btnCalcSpecs.disabled = true;
            try {
                const result = await invoke('plugin:motor|calculate_motor_specs', {
                    voltageIn,
                    kbVKrpm,
                    torqueRequired
                });
                
                document.getElementById('output-specs-kt').textContent = `${result.kt_nm_a.toFixed(3)} Nm/Amp`;
                document.getElementById('output-specs-maxspd').textContent = `${Math.round(result.max_speed_rpm).toLocaleString()} rpm`;
                document.getElementById('output-specs-safespd').textContent = `${Math.round(result.safe_speed_rpm).toLocaleString()} rpm`;
                document.getElementById('output-specs-current').textContent = `${result.required_current_a.toFixed(2)} A`;
            } catch (err) {
                console.error("Motor specs failed:", err);
                alert("모터 특성 및 필요 전류 연산에 실패했습니다: " + err);
            } finally {
                btnCalcSpecs.disabled = false;
            }
        };
    }

    // RMS Cycle Calculator
    const btnCalcRms = document.getElementById('btn-calc-rms');
    if (btnCalcRms) {
        btnCalcRms.onclick = async () => {
            if (rmsStages.length === 0) {
                alert("최소 하나 이상의 구동 구간을 추가해 주세요.");
                return;
            }
            
            btnCalcRms.disabled = true;
            try {
                // Map local stage parameters to serde-friendly camelCase naming
                const mappedStages = rmsStages.map(stage => ({
                    duration: stage.duration,
                    torque: stage.torque,
                    speed_rpm: stage.speedRpm
                }));
                
                const result = await invoke('plugin:motor|calculate_rms_cycle', { stages: mappedStages });
                
                document.getElementById('output-rms-time').textContent = `${result.total_time.toFixed(2)} 초`;
                document.getElementById('output-rms-torque').textContent = `${result.rms_torque.toFixed(3)} Nm`;
                document.getElementById('output-rms-speed').textContent = `${result.average_speed_rpm.toFixed(2)} rpm`;
                document.getElementById('output-rms-power').textContent = `${result.continuous_power_w.toFixed(3)} W`;
            } catch (err) {
                console.error("RMS cycle calculation failed:", err);
                alert("RMS 토크 및 연속 파워 연산에 실패했습니다: " + err);
            } finally {
                btnCalcRms.disabled = false;
            }
        };
    }

    // Add list items onclick triggers
    const btnInertiaAddPoint = document.getElementById('btn-inertia-add-point');
    if (btnInertiaAddPoint) {
        btnInertiaAddPoint.onclick = () => {
            inertiaPoints.push({ mass: 0.5, radius: 0.5 });
            renderInertiaPointsTable();
        };
    }

    const btnRmsAddStage = document.getElementById('btn-rms-add-stage');
    if (btnRmsAddStage) {
        btnRmsAddStage.onclick = () => {
            rmsStages.push({ duration: 1.0, torque: 0.5, speedRpm: 10.0 });
            renderRmsStagesTable();
        };
    }

    // 4. Presets Buttons bindings
    document.getElementById('btn-preset-torque').onclick = () => {
        document.getElementById('input-torque-inertia').value = "0.5";
        document.getElementById('input-torque-accel').value = "4";
        const tabBtn = document.querySelector('#motor-calc-tabs [data-motor-tab="torque"]');
        if (tabBtn) tabBtn.click();
        btnCalcTorque.click();
    };

    document.getElementById('btn-preset-combined').onclick = () => {
        document.getElementById('input-comb-mass').value = "1.0";
        document.getElementById('input-comb-length').value = "1.0";
        document.getElementById('input-comb-angle').value = "30";
        document.getElementById('input-comb-accel').value = "1.0";
        const tabBtn = document.querySelector('#motor-calc-tabs [data-motor-tab="combined"]');
        if (tabBtn) tabBtn.click();
        btnCalcCombined.click();
    };

    document.getElementById('btn-preset-motor').onclick = () => {
        document.getElementById('input-specs-vin').value = "320";
        document.getElementById('input-specs-kb').value = "90.9";
        document.getElementById('input-specs-tr').value = "3.0";
        const tabBtn = document.querySelector('#motor-calc-tabs [data-motor-tab="specs"]');
        if (tabBtn) tabBtn.click();
        btnCalcSpecs.click();
    };

    document.getElementById('btn-preset-rms').onclick = () => {
        rmsStages = [
            { duration: 1.0, torque: 1.0, speedRpm: 4.77 },
            { duration: 2.0, torque: 0.0, speedRpm: 9.55 },
            { duration: 1.0, torque: -1.0, speedRpm: 4.77 }
        ];
        renderRmsStagesTable();
        const tabBtn = document.querySelector('#motor-calc-tabs [data-motor-tab="rms"]');
        if (tabBtn) tabBtn.click();
        btnCalcRms.click();
    };

    // 5. Run initial renderings
    renderInertiaPointsTable();
    renderRmsStagesTable();
    triggerSpeedConversion();
    triggerAccelSolve();
    
    // Auto-click first presets to populate values
    btnCalcTorque.click();
}

function triggerInertiaShapeVisibility(shape) {
    const basicParams = document.getElementById('inertia-params-basic');
    const multipleParams = document.getElementById('inertia-params-multiple');
    const lengthGroup = document.getElementById('group-inertia-length');
    
    if (shape === 'multiple_points') {
        basicParams.style.display = 'none';
        multipleParams.style.display = 'flex';
    } else {
        basicParams.style.display = 'flex';
        multipleParams.style.display = 'none';
        
        if (shape.includes('cylinder_')) {
            lengthGroup.style.display = 'block';
        } else {
            lengthGroup.style.display = 'none';
        }
    }
}

function renderInertiaPointsTable() {
    const tbody = document.getElementById('tbody-inertia-points');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    inertiaPoints.forEach((pt, index) => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
        
        tr.innerHTML = `
            <td style="padding: 4px 0;">
                <input type="number" value="${pt.mass}" step="0.1" style="width: 70px; background: rgba(0,0,0,0.3); border: 1px solid var(--card-border); color: #fff; padding: 4px; border-radius: 4px; font-size:12px;" id="input-pt-mass-${index}"> kg
            </td>
            <td style="padding: 4px 0;">
                <input type="number" value="${pt.radius}" step="0.1" style="width: 70px; background: rgba(0,0,0,0.3); border: 1px solid var(--card-border); color: #fff; padding: 4px; border-radius: 4px; font-size:12px;" id="input-pt-rad-${index}"> m
            </td>
            <td style="padding: 4px 0; text-align: right;">
                <button class="btn btn-secondary" style="padding: 2px 6px; font-size: 10px; color: #f87171;" id="btn-pt-del-${index}">삭제</button>
            </td>
        `;
        
        tbody.appendChild(tr);
        
        const massIn = document.getElementById(`input-pt-mass-${index}`);
        const radIn = document.getElementById(`input-pt-rad-${index}`);
        const delBtn = document.getElementById(`btn-pt-del-${index}`);
        
        if (massIn) {
            massIn.oninput = () => {
                inertiaPoints[index].mass = parseFloat(massIn.value) || 0.0;
            };
        }
        if (radIn) {
            radIn.oninput = () => {
                inertiaPoints[index].radius = parseFloat(radIn.value) || 0.0;
            };
        }
        if (delBtn) {
            delBtn.onclick = () => {
                inertiaPoints.splice(index, 1);
                renderInertiaPointsTable();
            };
        }
    });
}

function renderRmsStagesTable() {
    const tbody = document.getElementById('tbody-rms-stages');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    rmsStages.forEach((stage, index) => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
        
        tr.innerHTML = `
            <td style="padding: 6px 4px; color: var(--text-secondary);">${index + 1}</td>
            <td style="padding: 4px;">
                <input type="number" value="${stage.duration}" step="0.1" style="width: 60px; background: rgba(0,0,0,0.3); border: 1px solid var(--card-border); color: #fff; padding: 4px; border-radius: 4px; font-size:12px;" id="input-rms-dur-${index}"> s
            </td>
            <td style="padding: 4px;">
                <input type="number" value="${stage.torque}" step="0.1" style="width: 60px; background: rgba(0,0,0,0.3); border: 1px solid var(--card-border); color: #fff; padding: 4px; border-radius: 4px; font-size:12px;" id="input-rms-tq-${index}"> Nm
            </td>
            <td style="padding: 4px;">
                <input type="number" value="${stage.speedRpm}" step="1" style="width: 60px; background: rgba(0,0,0,0.3); border: 1px solid var(--card-border); color: #fff; padding: 4px; border-radius: 4px; font-size:12px;" id="input-rms-spd-${index}"> rpm
            </td>
            <td style="padding: 4px; text-align: right;">
                <button class="btn btn-secondary" style="padding: 2px 6px; font-size: 10px; color: #f87171;" id="btn-rms-del-${index}">삭제</button>
            </td>
        `;
        
        tbody.appendChild(tr);
        
        const durIn = document.getElementById(`input-rms-dur-${index}`);
        const tqIn = document.getElementById(`input-rms-tq-${index}`);
        const spdIn = document.getElementById(`input-rms-spd-${index}`);
        const delBtn = document.getElementById(`btn-rms-del-${index}`);
        
        if (durIn) {
            durIn.oninput = () => {
                rmsStages[index].duration = parseFloat(durIn.value) || 0.0;
                updateRmsProfileGraph();
            };
        }
        if (tqIn) {
            tqIn.oninput = () => {
                rmsStages[index].torque = parseFloat(tqIn.value) || 0.0;
                updateRmsProfileGraph();
            };
        }
        if (spdIn) {
            spdIn.oninput = () => {
                rmsStages[index].speedRpm = parseFloat(spdIn.value) || 0.0;
                updateRmsProfileGraph();
            };
        }
        if (delBtn) {
            delBtn.onclick = () => {
                rmsStages.splice(index, 1);
                renderRmsStagesTable();
            };
        }
    });

    updateRmsProfileGraph();
}

function updateRmsProfileGraph() {
    const svg = document.getElementById('svg-rms-profile');
    if (!svg) return;
    svg.innerHTML = '';
    
    if (!rmsStages || rmsStages.length === 0) {
        svg.innerHTML = `<text x="225" y="80" fill="var(--text-secondary)" font-size="12" text-anchor="middle">구간을 추가해 주세요.</text>`;
        return;
    }
    
    let totalTime = 0;
    let maxAbsSpeed = 0.1;
    let maxAbsTorque = 0.1;
    
    rmsStages.forEach(stage => {
        totalTime += Math.max(0, stage.duration);
        if (Math.abs(stage.speedRpm) > maxAbsSpeed) maxAbsSpeed = Math.abs(stage.speedRpm);
        if (Math.abs(stage.torque) > maxAbsTorque) maxAbsTorque = Math.abs(stage.torque);
    });
    
    if (totalTime <= 0) totalTime = 1.0;
    
    const paddingLeft = 45;
    const paddingRight = 45;
    const paddingTop = 20;
    const paddingBottom = 25;
    const width = 450;
    const height = 160;
    
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;
    const centerY = paddingTop + plotHeight / 2; // Y=67.5 (0선)
    
    // Draw grid/axis lines
    // Center reference line (0)
    svg.innerHTML += `<line x1="${paddingLeft}" y1="${centerY}" x2="${width - paddingRight}" y2="${centerY}" stroke="rgba(255, 255, 255, 0.15)" stroke-dasharray="3,3" />`;
    // Boundary vertical lines
    svg.innerHTML += `<line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${height - paddingBottom}" stroke="rgba(255, 255, 255, 0.1)" />`;
    svg.innerHTML += `<line x1="${width - paddingRight}" y1="${paddingTop}" x2="${width - paddingRight}" y2="${height - paddingBottom}" stroke="rgba(255, 255, 255, 0.1)" />`;

    let currentTime = 0;
    let lastYSpeed = centerY;
    let lastYTorque = centerY;
    
    rmsStages.forEach((stage, index) => {
        const duration = Math.max(0, stage.duration);
        const nextTime = currentTime + duration;
        const startX = paddingLeft + (currentTime / totalTime) * plotWidth;
        const endX = paddingLeft + (nextTime / totalTime) * plotWidth;
        
        // Speed line Y coord
        const ySpeed = centerY - (stage.speedRpm / maxAbsSpeed) * (plotHeight / 2);
        // Torque line Y coord
        const yTorque = centerY - (stage.torque / maxAbsTorque) * (plotHeight / 2);
        
        // Vertical step connectors (if not the first stage)
        if (index > 0) {
            svg.innerHTML += `<line x1="${startX}" y1="${lastYSpeed}" x2="${startX}" y2="${ySpeed}" stroke="#89b4fa" stroke-width="1.2" stroke-dasharray="2,2" />`;
            svg.innerHTML += `<line x1="${startX}" y1="${lastYTorque}" x2="${startX}" y2="${yTorque}" stroke="#ffaa40" stroke-width="1.2" stroke-dasharray="2,2" />`;
        }
        
        // Horizontal segment lines
        svg.innerHTML += `<line x1="${startX}" y1="${ySpeed}" x2="${endX}" y2="${ySpeed}" stroke="#89b4fa" stroke-width="2.5" stroke-linecap="round" />`;
        svg.innerHTML += `<line x1="${startX}" y1="${yTorque}" x2="${endX}" y2="${yTorque}" stroke="#ffaa40" stroke-width="2.5" stroke-linecap="round" />`;
        
        // Add markers
        svg.innerHTML += `<circle cx="${endX}" cy="${ySpeed}" r="2.5" fill="#89b4fa" />`;
        svg.innerHTML += `<circle cx="${endX}" cy="${yTorque}" r="2.5" fill="#ffaa40" />`;

        // Time labels at boundaries
        if (index === 0) {
            svg.innerHTML += `<text x="${startX}" y="${height - 8}" fill="var(--text-secondary)" font-size="8.5" text-anchor="middle">0s</text>`;
        }
        svg.innerHTML += `<text x="${endX}" y="${height - 8}" fill="var(--text-secondary)" font-size="8.5" text-anchor="middle">${nextTime.toFixed(1)}s</text>`;
        
        currentTime = nextTime;
        lastYSpeed = ySpeed;
        lastYTorque = yTorque;
    });
    
    // Y-axis labels on left (Speed - blue)
    svg.innerHTML += `<text x="${paddingLeft - 8}" y="${paddingTop + 3}" fill="#89b4fa" font-size="8.5" text-anchor="end">+${maxAbsSpeed.toFixed(0)}</text>`;
    svg.innerHTML += `<text x="${paddingLeft - 8}" y="${centerY + 3}" fill="var(--text-secondary)" font-size="8.5" text-anchor="end">0 rpm</text>`;
    svg.innerHTML += `<text x="${paddingLeft - 8}" y="${height - paddingBottom}" fill="#89b4fa" font-size="8.5" text-anchor="end">-${maxAbsSpeed.toFixed(0)}</text>`;
    
    // Y-axis labels on right (Torque - orange)
    svg.innerHTML += `<text x="${width - paddingRight + 8}" y="${paddingTop + 3}" fill="#ffaa40" font-size="8.5" text-anchor="start">+${maxAbsTorque.toFixed(1)}</text>`;
    svg.innerHTML += `<text x="${width - paddingRight + 8}" y="${centerY + 3}" fill="var(--text-secondary)" font-size="8.5" text-anchor="start">0 Nm</text>`;
    svg.innerHTML += `<text x="${width - paddingRight + 8}" y="${height - paddingBottom}" fill="#ffaa40" font-size="8.5" text-anchor="start">-${maxAbsTorque.toFixed(1)}</text>`;
}


