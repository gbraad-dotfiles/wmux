// Initialize xterm.js
// Load font size from localStorage or use default
const savedFontSize = parseInt(localStorage.getItem('wmux_font_size')) || 13;

const term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: savedFontSize,
    fontFamily: '"Sauce Code Pro Nerd Font", "Source Code Pro", "Sauce Code Pro", Monaco, Menlo, Consolas, monospace',
    theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#00FF00',
        cursorAccent: '#000000',
        selection: '#3a3a3a',
        black: '#000000',
        red: '#CF1A37',
        green: '#00FF00',
        yellow: '#ffff00',
        blue: '#0066FF',
        magenta: '#ff00ff',
        cyan: '#00ffff',
        white: '#ffffff'
    },
    allowProposedApi: true,
    scrollback: 10000,
    disableStdin: false,
    convertEol: false,
    windowsMode: false,
    altClickMovesCursor: false,
    screenReaderMode: false
});

const fitAddon = new FitAddon.FitAddon();
const webLinksAddon = new WebLinksAddon.WebLinksAddon();

term.loadAddon(fitAddon);
term.loadAddon(webLinksAddon);

term.open(document.getElementById('terminal'));

// Clipboard support - Copy
term.onSelectionChange(() => {
    const selection = term.getSelection();
    if (selection) {
        // Try modern clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(selection).catch(err => {
                console.log('Modern clipboard failed, using fallback:', err);
                copyToClipboardFallback(selection);
            });
        } else {
            copyToClipboardFallback(selection);
        }
    }
});

function copyToClipboardFallback(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        console.log('Copied via fallback');
    } catch (err) {
        console.error('Fallback copy failed:', err);
    }
    document.body.removeChild(textarea);
}

// Clipboard support - Paste
async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            if (connected && sessionActive) {
                send({
                    type: 'input',
                    data: btoa(text)
                });
                console.log('Pasted:', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
            } else {
                console.log('Not connected or no active session');
            }
        }
    } catch (err) {
        console.error('Paste failed:', err);
        // Fallback: show message in terminal
        if (sessionActive) {
            term.write('\r\n\x1b[33mClipboard access denied. Please grant clipboard permissions.\x1b[0m\r\n');
        }
    }
}

// Desktop paste support (Ctrl+V)
document.addEventListener('paste', async (e) => {
    if (sessionActive) {
        e.preventDefault();
        await pasteFromClipboard();
    }
});

// Desktop keyboard shortcuts
document.addEventListener('keydown', async (e) => {
    // Ctrl+Shift+V or Cmd+Shift+V for paste
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        console.log('Ctrl+Shift+V detected');
        await pasteFromClipboard();
    }
    // Shift+Insert for paste (traditional terminal shortcut)
    if (e.shiftKey && e.key === 'Insert') {
        e.preventDefault();
        console.log('Shift+Insert detected');
        await pasteFromClipboard();
    }
    // Ctrl+Insert for copy (traditional terminal shortcut)
    if (e.ctrlKey && e.key === 'Insert') {
        e.preventDefault();
        const selection = term.getSelection();
        if (selection) {
            try {
                await navigator.clipboard.writeText(selection);
                console.log('Copied via Ctrl+Insert');
            } catch (err) {
                console.error('Copy failed:', err);
            }
        }
    }
});

// Mobile keyboard handling
let keyboardMode = false;
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const keyboardToggle = document.getElementById('keyboard-toggle');
const terminalElement = document.querySelector('.xterm');
let terminalTextarea = null;

// Show keyboard toggle and paste buttons on mobile
const pasteToggle = document.getElementById('paste-toggle');
if (isMobile) {
    if (keyboardToggle) {
        keyboardToggle.style.display = 'block';
    }
    if (pasteToggle) {
        pasteToggle.style.display = 'block';
    }
}

// Function to enable/disable keyboard input
function setKeyboardMode(enabled) {
    keyboardMode = enabled;

    if (!terminalTextarea) {
        terminalTextarea = document.querySelector('.xterm textarea');
    }

    if (terminalTextarea) {
        // Always disable Android keyboard interference
        terminalTextarea.setAttribute('autocomplete', 'off');
        terminalTextarea.setAttribute('autocorrect', 'off');
        terminalTextarea.setAttribute('autocapitalize', 'off');
        terminalTextarea.setAttribute('spellcheck', 'false');

        if (enabled) {
            // Enable keyboard
            terminalTextarea.removeAttribute('readonly');
            terminalTextarea.removeAttribute('inputmode');
            terminalTextarea.style.opacity = '1';
            terminalTextarea.style.pointerEvents = 'auto';
            terminalTextarea.focus();
            if (keyboardToggle) {
                keyboardToggle.style.background = '#00FF00';
                keyboardToggle.textContent = 'ON';
            }
        } else {
            // Disable keyboard (mouse mode)
            terminalTextarea.setAttribute('readonly', 'readonly');
            terminalTextarea.setAttribute('inputmode', 'none');
            terminalTextarea.style.opacity = '0';
            terminalTextarea.style.pointerEvents = 'none';
            terminalTextarea.blur();
            if (keyboardToggle) {
                keyboardToggle.style.background = 'var(--accent)';
                keyboardToggle.textContent = 'KB';
            }
        }
    }
}

// Keyboard toggle button
if (keyboardToggle) {
    keyboardToggle.addEventListener('click', () => {
        setKeyboardMode(!keyboardMode);
    });
}

// Paste button
if (pasteToggle) {
    pasteToggle.addEventListener('click', async () => {
        await pasteFromClipboard();
    });
}

// Watch for textarea creation and initially disable keyboard
const observer = new MutationObserver(() => {
    if (!terminalTextarea) {
        terminalTextarea = document.querySelector('.xterm textarea');
        if (terminalTextarea && isMobile) {
            setKeyboardMode(false); // Start in mouse mode on mobile
        }
    }
});

if (terminalElement) {
    observer.observe(terminalElement, { childList: true, subtree: true });
}

// Auto-disable keyboard mode after 30 seconds of no typing
let keyboardTimeout;
if (isMobile) {
    document.addEventListener('input', () => {
        if (keyboardMode) {
            clearTimeout(keyboardTimeout);
            keyboardTimeout = setTimeout(() => {
                setKeyboardMode(false);
            }, 30000);
        }
    });
}

// WebSocket connection
let ws = null;
let connected = false;
let sessionActive = false;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let reconnectTimeout = null;
let currentSessionName = null;
let defaultSessionName = null;

// Fix mobile viewport height
function setActualVH() {
    // Get actual viewport height (excluding browser chrome)
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
}

// Set on load and when viewport changes
setActualVH();
window.addEventListener('resize', setActualVH);
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', setActualVH);
}

// Initial fit after setting viewport
fitAddon.fit();

// Set initial keyboard mode on mobile after a short delay (wait for textarea to be created)
if (isMobile) {
    setTimeout(() => {
        setKeyboardMode(false);
    }, 500);
}

// Update debug info
function updateDebugInfo() {
    const debugEl = document.getElementById('debug-info');
    if (debugEl) {
        const container = document.getElementById('terminal-container');
        const banner = document.querySelector('.top-banner');
        const body = document.body;

        const info = `Terminal Dimensions:
  Columns (width):  ${term.cols}
  Rows (height):    ${term.rows}

Container:
  Offset Height: ${container.offsetHeight}px
  Client Height: ${container.clientHeight}px
  Scroll Height: ${container.scrollHeight}px

Banner Height: ${banner ? banner.offsetHeight : 0}px

Body:
  Client Height: ${body.clientHeight}px
  Offset Height: ${body.offsetHeight}px
  Scroll Height: ${body.scrollHeight}px
  ScrollTop: ${body.scrollTop}px

HTML:
  Scroll Height: ${document.documentElement.scrollHeight}px
  ScrollTop: ${document.documentElement.scrollTop}px

Viewport:
  Window Inner:  ${window.innerWidth}x${window.innerHeight}
  Visual:        ${window.visualViewport ? window.visualViewport.width + 'x' + window.visualViewport.height : 'N/A'}
  --vh value: ${getComputedStyle(document.documentElement).getPropertyValue('--vh')}

Status: ${sessionActive ? 'Active' : 'Idle'}`;
        debugEl.textContent = info;
    }
}

// Update debug info periodically and on events
setInterval(updateDebugInfo, 1000);
updateDebugInfo();

function updateStatus(text, isConnected = false) {
    const statusEl = document.getElementById('status');
    const dot = statusEl.querySelector('.indicator-dot');
    const textEl = statusEl.querySelector('.indicator-text');

    textEl.textContent = text;
    if (isConnected) {
        statusEl.classList.add('connected');
    } else {
        statusEl.classList.remove('connected');
    }
    connected = isConnected;
}

function updateSessionList(sessions) {
    const select = document.getElementById('session-select');
    select.innerHTML = '';

    if (sessions && sessions.length > 0) {
        sessions.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            // Mark active session
            if (s === currentSessionName) {
                opt.textContent = s + ' (active)';
                opt.style.fontWeight = 'bold';
                opt.style.color = 'var(--accent)';
            } else {
                opt.textContent = s;
            }
            select.appendChild(opt);
        });
        // Select the active session in dropdown
        if (currentSessionName) {
            select.value = currentSessionName;
        }
    } else {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No sessions available';
        select.appendChild(opt);
    }
    updateKillButtonState();
}

function updateKillButtonState() {
    const killBtn = document.getElementById('kill-session-btn');
    const select = document.getElementById('session-select');
    const selectedSession = select.value;

    if (!killBtn) return;

    // Disable kill button if:
    // - No session selected
    // - Selected session is the default session
    // - Selected session is the currently active session
    const shouldDisable = !selectedSession ||
                         selectedSession === defaultSessionName ||
                         selectedSession === currentSessionName;

    killBtn.disabled = shouldDisable;
    if (shouldDisable) {
        killBtn.style.opacity = '0.5';
        killBtn.style.cursor = 'not-allowed';
    } else {
        killBtn.style.opacity = '1';
        killBtn.style.cursor = 'pointer';
    }
}

function updateWindowsList(windows) {
    const listEl = document.getElementById('windows-list');
    listEl.innerHTML = '';

    if (windows && windows.length > 0) {
        windows.forEach(w => {
            const btn = document.createElement('button');
            btn.className = 'control-btn';
            btn.style.cssText = 'width: 100%; margin-bottom: 8px; text-align: left; padding: 12px;';
            if (w.active) {
                btn.style.background = 'var(--accent)';
                btn.style.borderColor = 'var(--accent)';
            }
            btn.textContent = `${w.index}: ${w.name}${w.active ? ' *' : ''}`;
            btn.addEventListener('click', () => {
                send({ type: 'select_window', index: w.index });
                windowsDialog.classList.remove('active');
                windowsOverlay.classList.remove('active');
            });
            listEl.appendChild(btn);
        });
    } else {
        listEl.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">No windows available</div>';
    }
}

function connect() {
    // Get target host from sessionStorage (set by host manager)
    const targetHost = sessionStorage.getItem('wmux_target_host');

    if (!targetHost) {
        alert('No target host specified. Redirecting to host manager...');
        window.location.href = '/';
        return;
    }

    // Parse target host URL to construct WebSocket URL
    let wsUrl;
    try {
        const url = new URL(targetHost);
        const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${url.host}/ws`;
    } catch (e) {
        alert('Invalid target host URL: ' + targetHost);
        window.location.href = '/';
        return;
    }

    console.log('Connecting to:', wsUrl);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        updateStatus('Ready', true);
        reconnectAttempts = 0; // Reset on successful connection

        // If we had a session before disconnecting, inform user
        const lastSession = localStorage.getItem('wmux_last_session');
        if (lastSession && reconnectAttempts > 0) {
            term.write(`\x1b[32mReconnected! Last session: ${lastSession}\x1b[0m\r\n`);
        }
    };

    ws.onmessage = (event) => {
        // Handle binary messages (terminal output)
        if (event.data instanceof Blob) {
            event.data.arrayBuffer().then(buffer => {
                const uint8Array = new Uint8Array(buffer);
                term.write(uint8Array);
            });
            return;
        }

        // Handle JSON messages (control messages)
        const msg = JSON.parse(event.data);

        switch (msg.type) {
            case 'ready':
                // Store default session name
                defaultSessionName = msg.session || null;
                updateSessionList(msg.sessions);
                updateKillButtonState();

                // Check for auto-connect session in priority order:
                // 1. Host-specific auto-session (from host config in multi-host mode)
                // 2. Server default session (from --default-session flag)
                // 3. Last connected session
                let sessionToAttach = sessionStorage.getItem('wmux_auto_session');

                if (!sessionToAttach && msg.session && msg.sessions && msg.sessions.includes(msg.session)) {
                    sessionToAttach = msg.session;
                    console.log('Using server default session:', sessionToAttach);
                }

                if (!sessionToAttach) {
                    const lastSession = localStorage.getItem('wmux_last_session');
                    if (lastSession && msg.sessions && msg.sessions.includes(lastSession)) {
                        sessionToAttach = lastSession;
                        console.log('Using last connected session:', sessionToAttach);
                    }
                }

                if (sessionToAttach) {
                    // Auto-attach to the session
                    console.log('Auto-attaching to session:', sessionToAttach);
                    setTimeout(() => {
                        term.reset();
                        term.clear();
                        fitAddon.fit();

                        setTimeout(() => {
                            send({
                                type: 'start',
                                session: sessionToAttach,
                                newSession: false,
                                rows: term.rows,
                                cols: term.cols
                            });
                        }, 100);
                    }, 500);
                }
                break;

            case 'sessions':
                updateSessionList(msg.sessions);
                updateKillButtonState();
                break;

            case 'attached':
                updateStatus('Session Active', true);
                sessionActive = true;

                // Store session name for auto-reconnect and track current session
                if (msg.session) {
                    currentSessionName = msg.session;
                    localStorage.setItem('wmux_last_session', msg.session);
                }

                // Show controls and windows buttons
                document.getElementById('controls-btn').style.display = 'block';
                document.getElementById('windows-btn').style.display = 'block';

                // Request window list
                send({ type: 'list_windows' });

                // Force a resize to ensure tmux knows the correct size
                setTimeout(() => {
                    fitAddon.fit();
                    console.log(`Forcing resize after attach - cols: ${term.cols}, rows: ${term.rows}`);
                    send({
                        type: 'resize',
                        rows: term.rows,
                        cols: term.cols
                    });
                }, 200);

                term.focus();
                break;

            case 'close':
                updateStatus('Ready', true);
                sessionActive = false;
                currentSessionName = null;

                // Hide controls and windows buttons
                document.getElementById('controls-btn').style.display = 'none';
                document.getElementById('windows-btn').style.display = 'none';

                // Close dialogs if open
                controlsDialog.classList.remove('active');
                controlsOverlay.classList.remove('active');
                windowsDialog.classList.remove('active');
                windowsOverlay.classList.remove('active');

                term.clear();
                // Refresh session list
                send({ type: 'list' });
                break;

            case 'windows':
                updateWindowsList(msg.windows);
                break;

            case 'error':
                term.write(`\x1b[31mError: ${msg.data}\x1b[0m\r\n`);
                updateStatus('Error', false);
                break;
        }
    };

    ws.onclose = () => {
        updateStatus('Disconnected', false);
        term.write('\r\n\x1b[33mDisconnected from server\x1b[0m\r\n');
        sessionActive = false;
        connected = false;
        ws = null;

        // Auto-reconnect with backoff: 1s, 2s, 3s, 5s, 10s, 15s, 30s, 30s...
        if (reconnectAttempts < maxReconnectAttempts) {
            const delays = [1000, 2000, 3000, 5000, 10000, 15000, 30000];
            const delay = delays[Math.min(reconnectAttempts, delays.length - 1)];
            reconnectAttempts++;
            term.write(`\x1b[33mReconnecting in ${delay/1000}s (attempt ${reconnectAttempts}/${maxReconnectAttempts})...\x1b[0m\r\n`);
            updateStatus(`Reconnecting (${reconnectAttempts}/${maxReconnectAttempts})...`, false);

            reconnectTimeout = setTimeout(() => {
                connect();
            }, delay);
        } else {
            term.write('\x1b[31mMax reconnection attempts reached. Click "Reconnect to Host" to try again.\x1b[0m\r\n');
            updateStatus('Disconnected (manual reconnect required)', false);
        }
    };

    ws.onerror = (error) => {
        updateStatus('Connection error', false);
        console.error('WebSocket error:', error);
    };
}

function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

// Handle terminal input
term.onData((data) => {
    if (connected && sessionActive) {
        send({
            type: 'input',
            data: btoa(data)
        });
    }
});

// Handle terminal resize
let resizeTimeout;
function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        setActualVH(); // Update viewport height first
        fitAddon.fit(); // Then recalculate terminal dimensions
        updateDebugInfo();
        if (connected && sessionActive) {
            console.log(`Terminal dimensions - cols: ${term.cols}, rows: ${term.rows}`);
            send({
                type: 'resize',
                rows: term.rows,
                cols: term.cols
            });
        }
    }, 100);
}

window.addEventListener('resize', handleResize);

// Handle mobile viewport changes (address bar hide/show)
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleResize);
    window.visualViewport.addEventListener('scroll', () => {
        setActualVH();
        // Don't resize terminal on scroll, just update available height
    });
}

// Menu toggle
const menuBtn = document.getElementById('menu-btn');
const closeMenu = document.getElementById('close-menu');
const navMenu = document.getElementById('nav-menu');
const navOverlay = document.getElementById('nav-overlay');

menuBtn.addEventListener('click', () => {
    navMenu.classList.add('active');
    navOverlay.classList.add('active');
});

closeMenu.addEventListener('click', () => {
    navMenu.classList.remove('active');
    navOverlay.classList.remove('active');
});

navOverlay.addEventListener('click', () => {
    navMenu.classList.remove('active');
    navOverlay.classList.remove('active');
});

// Controls dialog toggle
const controlsBtn = document.getElementById('controls-btn');
const closeControls = document.getElementById('close-controls');
const controlsDialog = document.getElementById('controls-dialog');
const controlsOverlay = document.getElementById('controls-overlay');

const windowsBtn = document.getElementById('windows-btn');
const closeWindows = document.getElementById('close-windows');
const windowsDialog = document.getElementById('windows-dialog');
const windowsOverlay = document.getElementById('windows-overlay');

controlsBtn.addEventListener('click', () => {
    controlsDialog.classList.add('active');
    controlsOverlay.classList.add('active');
});

closeControls.addEventListener('click', () => {
    controlsDialog.classList.remove('active');
    controlsOverlay.classList.remove('active');
});

controlsOverlay.addEventListener('click', () => {
    controlsDialog.classList.remove('active');
    controlsOverlay.classList.remove('active');
});

windowsBtn.addEventListener('click', () => {
    // Refresh window list when opening
    send({ type: 'list_windows' });
    windowsDialog.classList.add('active');
    windowsOverlay.classList.add('active');
});

closeWindows.addEventListener('click', () => {
    windowsDialog.classList.remove('active');
    windowsOverlay.classList.remove('active');
});

windowsOverlay.addEventListener('click', () => {
    windowsDialog.classList.remove('active');
    windowsOverlay.classList.remove('active');
});

// Sessions dialog toggle
const sessionsBtn = document.getElementById('sessions-btn');
const closeSessions = document.getElementById('close-sessions');
const sessionsDialog = document.getElementById('sessions-dialog');
const sessionsOverlay = document.getElementById('sessions-overlay');

sessionsBtn.addEventListener('click', () => {
    // Refresh session list when opening
    send({ type: 'list' });
    sessionsDialog.classList.add('active');
    sessionsOverlay.classList.add('active');
});

closeSessions.addEventListener('click', () => {
    sessionsDialog.classList.remove('active');
    sessionsOverlay.classList.remove('active');
});

sessionsOverlay.addEventListener('click', () => {
    sessionsDialog.classList.remove('active');
    sessionsOverlay.classList.remove('active');
});

// Applications dialog
let appsCache = [];
let defaultSession = 'screen';

// Fetch config
fetch('/api/config')
    .then(r => r.json())
    .then(config => {
        if (config.defaultSession) {
            defaultSession = config.defaultSession;
        }
    })
    .catch(err => console.log('Config fetch failed:', err));

const appsBtn = document.getElementById('apps-btn');
const closeApps = document.getElementById('close-apps');
const appsDialog = document.getElementById('apps-dialog');
const appsOverlay = document.getElementById('apps-overlay');
const appsList = document.getElementById('apps-list');
const appSearch = document.getElementById('app-search');

async function loadApps() {
    try {
        const response = await fetch('/api/apps');
        const data = await response.json();
        appsCache = data.apps || [];
        renderApps(appsCache);
    } catch (err) {
        appsList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--accent);">Failed to load apps. Is amux running?</div>';
        console.error('Failed to load apps:', err);
    }
}

function renderApps(apps) {
    if (apps.length === 0) {
        appsList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No apps found</div>';
        return;
    }

    appsList.innerHTML = apps.map(app => `
        <div class="app-item" data-app="${app.name}">
            <div style="flex: 1;">
                <div style="font-weight: 500; color: var(--text-primary);">${app.title || app.name}</div>
                <div style="font-size: 0.75em; color: var(--text-secondary); margin-top: 2px;">${app.name}</div>
            </div>
            <button class="app-launch-btn" data-app="${app.name}" style="background: var(--accent); color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85em;">Launch</button>
        </div>
    `).join('');

    // Add launch handlers
    appsList.querySelectorAll('.app-launch-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const appName = btn.dataset.app;
            await launchApp(appName);
        });
    });
}

async function launchApp(appName) {
    try {
        const response = await fetch(`/api/apps/${appName}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: currentSessionName || defaultSession })
        });
        const result = await response.json();

        if (result.status === 'success') {
            // Close apps dialog
            appsDialog.classList.remove('active');
            appsOverlay.classList.remove('active');

            // Refresh windows list
            send({ type: 'list_windows' });
        } else {
            console.error('Launch failed:', result);
        }
    } catch (err) {
        console.error('Failed to launch app:', err);
    }
}

if (appsBtn) {
    appsBtn.addEventListener('click', () => {
        loadApps();
        appsDialog.classList.add('active');
        appsOverlay.classList.add('active');
    });
}

if (closeApps) {
    closeApps.addEventListener('click', () => {
        appsDialog.classList.remove('active');
        appsOverlay.classList.remove('active');
    });
}

if (appsOverlay) {
    appsOverlay.addEventListener('click', () => {
        appsDialog.classList.remove('active');
        appsOverlay.classList.remove('active');
    });
}

if (appSearch) {
    appSearch.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = appsCache.filter(app =>
            app.name.toLowerCase().includes(query) ||
            (app.title && app.title.toLowerCase().includes(query))
        );
        renderApps(filtered);
    });
}

// Font size control
const fontSizeSlider = document.getElementById('font-size');
const fontSizeValue = document.getElementById('font-size-value');

if (fontSizeSlider && fontSizeValue) {
    // Set initial value from localStorage
    fontSizeSlider.value = savedFontSize;
    fontSizeValue.textContent = savedFontSize;

    fontSizeSlider.addEventListener('input', (e) => {
        const size = parseInt(e.target.value);
        fontSizeValue.textContent = size;
        term.options.fontSize = size;
        localStorage.setItem('wmux_font_size', size);

        // Wait for font size change to take effect, then resize
        setTimeout(() => {
            fitAddon.fit();
            // Fit again to ensure proper sizing
            setTimeout(() => {
                fitAddon.fit();
                updateDebugInfo();
                if (connected && sessionActive) {
                    send({
                        type: 'resize',
                        rows: term.rows,
                        cols: term.cols
                    });
                }
            }, 50);
        }, 50);
    });
}

// Session management
// Session select change handler
document.getElementById('session-select').addEventListener('change', () => {
    updateKillButtonState();
});

// Confirm kill dialog
const confirmKillDialog = document.getElementById('confirm-kill-dialog');
const confirmKillOverlay = document.getElementById('confirm-kill-overlay');
const confirmKillMessage = document.getElementById('confirm-kill-message');
const confirmKillYes = document.getElementById('confirm-kill-yes');
const confirmKillCancel = document.getElementById('confirm-kill-cancel');
const closeConfirmKill = document.getElementById('close-confirm-kill');

let sessionToKill = null;

function showConfirmKill(sessionName) {
    sessionToKill = sessionName;
    confirmKillMessage.textContent = `Kill session "${sessionName}"?`;
    confirmKillDialog.classList.add('active');
    confirmKillOverlay.classList.add('active');
}

function hideConfirmKill() {
    sessionToKill = null;
    confirmKillDialog.classList.remove('active');
    confirmKillOverlay.classList.remove('active');
}

confirmKillYes.addEventListener('click', () => {
    if (sessionToKill) {
        send({
            type: 'kill_session',
            session: sessionToKill
        });
    }
    hideConfirmKill();
});

confirmKillCancel.addEventListener('click', hideConfirmKill);
closeConfirmKill.addEventListener('click', hideConfirmKill);
confirmKillOverlay.addEventListener('click', hideConfirmKill);

// Kill session button
document.getElementById('kill-session-btn').addEventListener('click', () => {
    const sessionName = document.getElementById('session-select').value;
    if (!sessionName) {
        return;
    }

    // Don't allow killing default or active sessions
    if (sessionName === defaultSessionName) {
        term.write('\x1b[31mCannot kill the default session\x1b[0m\r\n');
        return;
    }

    if (sessionName === currentSessionName) {
        term.write('\x1b[31mCannot kill the active session. Detach first.\x1b[0m\r\n');
        return;
    }

    showConfirmKill(sessionName);
});

document.getElementById('attach-btn').addEventListener('click', () => {
    const sessionName = document.getElementById('session-select').value;
    if (!sessionName) {
        alert('No session selected');
        return;
    }

    // If already in a session, disconnect first
    if (sessionActive) {
        send({ type: 'disconnect' });
        sessionActive = false;
        currentSessionName = null;
    }

    term.reset();
    term.clear();

    // Ensure terminal is properly sized before starting
    fitAddon.fit();

    // Small delay to ensure fit is applied
    setTimeout(() => {
        console.log(`Starting session - cols: ${term.cols}, rows: ${term.rows}`);
        send({
            type: 'start',
            session: sessionName,
            newSession: false,
            rows: term.rows,
            cols: term.cols
        });
        updateDebugInfo();
    }, 100);

    sessionsDialog.classList.remove('active');
    sessionsOverlay.classList.remove('active');
});

document.getElementById('create-btn').addEventListener('click', () => {
    const sessionName = document.getElementById('new-session-name').value.trim() || `wmux_${Date.now()}`;

    // If already in a session, disconnect first
    if (sessionActive) {
        send({ type: 'disconnect' });
        sessionActive = false;
        currentSessionName = null;
    }

    term.reset();
    term.clear();

    // Ensure terminal is properly sized before starting
    fitAddon.fit();

    // Small delay to ensure fit is applied
    setTimeout(() => {
        console.log(`Creating session - cols: ${term.cols}, rows: ${term.rows}`);
        send({
            type: 'start',
            session: sessionName,
            newSession: true,
            rows: term.rows,
            cols: term.cols
        });
        updateDebugInfo();
    }, 100);

    sessionsDialog.classList.remove('active');
    sessionsOverlay.classList.remove('active');
});

document.getElementById('detach-session-btn').addEventListener('click', () => {
    if (sessionActive) {
        send({ type: 'disconnect' });
        sessionActive = false;
        term.clear();
        updateStatus('Ready', true);

        // Hide controls button
        document.getElementById('controls-btn').style.display = 'none';

        sessionsDialog.classList.remove('active');
        sessionsOverlay.classList.remove('active');
    }
});

document.getElementById('reconnect-btn').addEventListener('click', () => {
    // Clear any pending reconnect timeout
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    // Close existing connection if any
    if (ws) {
        ws.close();
        ws = null;
    }

    // Reset reconnect counter and connect
    reconnectAttempts = 0;
    term.write('\r\n\x1b[36mManual reconnect initiated...\x1b[0m\r\n');
    updateStatus('Reconnecting...', false);
    connect();

    navMenu.classList.remove('active');
    navOverlay.classList.remove('active');
});

document.getElementById('disconnect-btn').addEventListener('click', () => {
    if (ws) {
        ws.close();
    }
    // Return to host manager
    window.location.href = '/';
});

// tmux controls - send Ctrl+b prefix + key
function sendTmuxKey(key) {
    if (sessionActive) {
        // Send Ctrl+b (prefix)
        send({ type: 'input', data: btoa('\x02') });
        // Then send the key
        setTimeout(() => {
            send({ type: 'input', data: btoa(key) });
        }, 50);

        // Close controls dialog after action
        controlsDialog.classList.remove('active');
        controlsOverlay.classList.remove('active');

        // Focus terminal
        term.focus();
    }
}

document.getElementById('split-h').addEventListener('click', () => {
    sendTmuxKey('%');
});

document.getElementById('split-v').addEventListener('click', () => {
    sendTmuxKey('"');
});

document.getElementById('new-window').addEventListener('click', () => {
    sendTmuxKey('c');
});

document.getElementById('next-window').addEventListener('click', () => {
    sendTmuxKey('n');
});

document.getElementById('prev-window').addEventListener('click', () => {
    sendTmuxKey('p');
});

document.getElementById('close-pane').addEventListener('click', () => {
    sendTmuxKey('x');
});

document.getElementById('zoom-pane').addEventListener('click', () => {
    sendTmuxKey('z');
});

// Prevent body scrolling on mobile
document.body.addEventListener('touchmove', (e) => {
    // Allow scrolling in dialogs and menus
    if (e.target.closest('.dialog-content') || e.target.closest('.menu-panel')) {
        return;
    }
    // Prevent all other scrolling
    e.preventDefault();
}, { passive: false });

// Ensure page is always scrolled to top
function ensureNoScroll() {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
}
ensureNoScroll();
setInterval(ensureNoScroll, 100);

// Debug info toggle
const debugToggle = document.getElementById('debug-toggle');
const debugSection = document.getElementById('debug-section');
if (debugToggle && debugSection) {
    debugToggle.addEventListener('click', () => {
        if (debugSection.style.display === 'none') {
            debugSection.style.display = 'block';
            debugToggle.textContent = 'Debug Info ▲';
        } else {
            debugSection.style.display = 'none';
            debugToggle.textContent = 'Debug Info ▼';
        }
    });
}

// Connect on load
connect();
