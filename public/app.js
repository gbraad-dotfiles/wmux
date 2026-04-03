// Initialize xterm.js
// Load font size from localStorage or use default
const savedFontSize = parseInt(localStorage.getItem('wmux_font_size')) || 13;

let term = null;
let fitAddon = null;
let webLinksAddon = null;

function initTerminal() {
    term = new Terminal({
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

    fitAddon = new FitAddon.FitAddon();
    webLinksAddon = new WebLinksAddon.WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(document.getElementById('terminal'));

    // Attach custom key event handler to intercept prefix key before xterm processes it
    term.attachCustomKeyEventHandler((e) => {
        // Intercept Ctrl+Space (prefix key)
        if (e.ctrlKey && e.key === ' ' && !e.shiftKey && !e.metaKey) {
            // Prevent xterm from processing this event
            return false;
        }

        // Intercept command keys after prefix (H, A, W, P, S)
        if (prefixKeyPressed) {
            const key = e.key.toLowerCase();
            if (key === 'h' || key === 'a' || key === 'w' || key === 'p' || key === 's') {
                // Prevent xterm from processing these keys when prefix is active
                return false;
            }
        }

        // Allow xterm to process all other keys normally
        return true;
    });
}

function setupClipboardSupport() {
    // Clipboard support - Copy
    term.onSelectionChange(() => {
        const selection = term.getSelection();
        if (selection && sessionActive) {
            navigator.clipboard.writeText(selection).catch(err => {
                // Silently fail - don't spam console
            });
        }
    });
}

// Helper function to properly encode UTF-8 to base64
function utf8ToBase64(str) {
    try {
        // Modern approach using TextEncoder
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);

        // Convert Uint8Array to base64
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    } catch (err) {
        console.error('Base64 encoding failed:', err);
        // Fallback: try direct btoa
        return btoa(str);
    }
}

// Clipboard support - Paste
async function pasteFromClipboard() {
    if (!connected || !sessionActive) {
        return;
    }

    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            send({
                type: 'input',
                data: utf8ToBase64(text)
            });
        }
    } catch (err) {
        console.error('Paste failed:', err.name);
        if (sessionActive) {
            term.write('\r\n\x1b[33mClipboard paste failed: ' + err.message + '\x1b[0m\r\n');
        }
    }
}

function setupEventListeners() {
    // Desktop paste support (Ctrl+V)
    document.addEventListener('paste', async (e) => {
        if (sessionActive) {
            e.preventDefault();
            await pasteFromClipboard();
        }
    });

    // Desktop keyboard shortcuts - use capture phase to intercept before terminal
    window.addEventListener('keydown', async (e) => {
        // Check if hosts dialog is handling this event (from spa-router.js)
        if (typeof window.handleHostsKeydown === 'function' && window.handleHostsKeydown(e)) {
            e.stopPropagation();
            return;
        }

        // Check if apps dialog is handling this event
        if (handleAppsKeydown(e)) {
            e.stopPropagation();
            return;
        }

        // Check if windows dialog is handling this event
        if (handleWindowsKeydown(e)) {
            e.stopPropagation();
            return;
        }

        // Check if sessions dialog is handling this event
        if (handleSessionsKeydown(e)) {
            e.stopPropagation();
            return;
        }

        // Check if panes dialog is handling this event
        if (handlePanesKeydown(e)) {
            e.stopPropagation();
            return;
        }

        // ESC closes any open dialog
        if (e.key === 'Escape') {
            const activeDialogs = [
                { dialog: 'hosts-dialog', overlay: 'hosts-overlay' },
                { dialog: 'apps-dialog', overlay: 'apps-overlay' },
                { dialog: 'sessions-dialog', overlay: 'sessions-overlay' },
                { dialog: 'windows-dialog', overlay: 'windows-overlay' },
                { dialog: 'controls-dialog', overlay: 'controls-overlay' },
                { dialog: 'confirm-kill-dialog', overlay: 'confirm-kill-overlay' },
                { dialog: 'add-host-dialog', overlay: 'add-host-overlay' },
                { dialog: 'rename-window-dialog', overlay: 'rename-window-overlay' }
            ];

            let closedAny = false;
            activeDialogs.forEach(({ dialog, overlay }) => {
                const dialogEl = document.getElementById(dialog);
                const overlayEl = document.getElementById(overlay);
                if (dialogEl && dialogEl.classList.contains('active')) {
                    dialogEl.classList.remove('active');
                    if (overlayEl) overlayEl.classList.remove('active');
                    closedAny = true;
                }
            });

            // Close menu if open
            const navMenu = document.getElementById('nav-menu');
            const navOverlay = document.getElementById('nav-overlay');
            if (navMenu && navMenu.classList.contains('active')) {
                navMenu.classList.remove('active');
                if (navOverlay) navOverlay.classList.remove('active');
                closedAny = true;
            }

            if (closedAny) {
                e.preventDefault();
                return;
            }
        }

        // Don't intercept shortcuts if user is typing in an input field (but allow terminal textarea)
        const isTyping = (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') &&
                         !e.target.closest('#terminal-container');

        // Prefix key: Ctrl+Space
        if (e.ctrlKey && e.key === ' ' && !e.shiftKey && !e.metaKey && !isTyping) {
            e.preventDefault();
            e.stopPropagation();
            prefixKeyPressed = true;

            // Clear existing timeout
            if (prefixKeyTimeout) {
                clearTimeout(prefixKeyTimeout);
            }

            // Set timeout to clear prefix state
            prefixKeyTimeout = setTimeout(() => {
                prefixKeyPressed = false;
                prefixKeyTimeout = null;
            }, PREFIX_KEY_TIMEOUT);

            console.log('Prefix key pressed - waiting for command key (A/W/P/S)');
            return;
        }

        // Handle commands after prefix key
        if (prefixKeyPressed && !isTyping) {
            // Clear prefix state
            prefixKeyPressed = false;
            if (prefixKeyTimeout) {
                clearTimeout(prefixKeyTimeout);
                prefixKeyTimeout = null;
            }

            // H for Hosts
            if (e.key === 'h' || e.key === 'H') {
                e.preventDefault();
                e.stopPropagation();
                const hostsDialog = document.getElementById('hosts-dialog');
                const hostsOverlay = document.getElementById('hosts-overlay');
                if (hostsDialog && hostsOverlay && typeof window.loadHostsDialog === 'function') {
                    window.loadHostsDialog();
                    hostsDialog.classList.add('active');
                    hostsOverlay.classList.add('active');
                }
                return;
            }

            // A for Apps
            if (e.key === 'a' || e.key === 'A') {
                e.preventDefault();
                e.stopPropagation();
                const appsDialog = document.getElementById('apps-dialog');
                const appsOverlay = document.getElementById('apps-overlay');
                if (appsDialog && appsOverlay) {
                    loadApps();
                    appSearchQuery = '';
                    selectedAppIndex = 0;
                    appsDialog.classList.add('active');
                    appsOverlay.classList.add('active');
                    performAppSearch('');
                }
                return;
            }

            // W for Windows
            if (e.key === 'w' || e.key === 'W') {
                e.preventDefault();
                e.stopPropagation();
                const windowsDialog = document.getElementById('windows-dialog');
                const windowsOverlay = document.getElementById('windows-overlay');
                if (windowsDialog && windowsOverlay && sessionActive) {
                    send({ type: 'list_windows' });
                    windowSearchQuery = '';
                    selectedWindowIndex = 0;
                    windowsDialog.classList.add('active');
                    windowsOverlay.classList.add('active');
                }
                return;
            }

            // P for Panes
            if (e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                e.stopPropagation();
                const controlsDialog = document.getElementById('controls-dialog');
                const controlsOverlay = document.getElementById('controls-overlay');
                if (controlsDialog && controlsOverlay && sessionActive) {
                    highlightPaneButton(null);
                    controlsDialog.classList.add('active');
                    controlsOverlay.classList.add('active');
                }
                return;
            }

            // S for Sessions
            if (e.key === 's' || e.key === 'S') {
                e.preventDefault();
                e.stopPropagation();
                const sessionsDialog = document.getElementById('sessions-dialog');
                const sessionsOverlay = document.getElementById('sessions-overlay');
                if (sessionsDialog && sessionsOverlay) {
                    sessionSearchQuery = '';
                    selectedSessionIndex = 0;
                    send({ type: 'list' });
                    sessionsDialog.classList.add('active');
                    sessionsOverlay.classList.add('active');
                }
                return;
            }
        }
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
    }, true); // Use capture phase to intercept before terminal

    // Handle terminal input
    term.onData((data) => {
        if (connected && sessionActive) {
            // xterm.js onData provides binary string, use btoa directly
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
}

// Mobile keyboard handling
let keyboardMode = false;
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
let terminalTextarea = null;

function setupMobileKeyboard() {
    const keyboardToggle = document.getElementById('keyboard-toggle');
    const pasteToggle = document.getElementById('paste-toggle');
    const terminalElement = document.querySelector('.xterm');

    // Show keyboard toggle and paste buttons on mobile
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

    // Set initial keyboard mode on mobile after a short delay
    if (isMobile) {
        setTimeout(() => {
            setKeyboardMode(false);
        }, 500);
    }
}

// WebSocket connection
let ws = null;
let connected = false;
let sessionActive = false;
let currentRemoteHost = null; // Track remote host for reconnections
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

function setupViewport() {
    // Set on load and when viewport changes
    setActualVH();
    window.addEventListener('resize', setActualVH);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', setActualVH);
    }

    // Multiple fitting attempts to ensure proper sizing in SPA
    const performFit = (attempt = 1) => {
        setActualVH();
        fitAddon.fit();
        console.log(`Terminal fit attempt ${attempt} - cols: ${term.cols}, rows: ${term.rows}`);
    };

    // Use requestAnimationFrame to ensure DOM is rendered before fitting
    requestAnimationFrame(() => {
        performFit(1);

        // Second attempt after short delay
        setTimeout(() => {
            performFit(2);
        }, 100);

        // Third attempt after longer delay (for SPA view switching)
        setTimeout(() => {
            performFit(3);
        }, 300);

        // Final attempt
        setTimeout(() => {
            performFit(4);
        }, 500);
    });
}

// Update debug info
function updateDebugInfo() {
    if (!term) return; // Terminal not initialized yet

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

// Update debug info periodically and on events - only start when terminal is initialized
let debugUpdateInterval = null;
function startDebugUpdates() {
    if (!debugUpdateInterval) {
        debugUpdateInterval = setInterval(updateDebugInfo, 1000);
        updateDebugInfo();
    }
}

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

function renderSessions(sessions) {
    const listEl = document.getElementById('sessions-list');
    filteredSessions = sessions;

    if (!sessions || sessions.length === 0) {
        listEl.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">No sessions available</div>';
        return;
    }

    // Ensure selected index is within bounds
    if (selectedSessionIndex >= sessions.length) {
        selectedSessionIndex = sessions.length - 1;
    }
    if (selectedSessionIndex < 0) {
        selectedSessionIndex = 0;
    }

    listEl.innerHTML = sessions.map((sessionName, idx) => {
        const isSelected = idx === selectedSessionIndex;
        const isActive = sessionName === currentSessionName;
        const isDefault = sessionName === defaultSessionName;

        let displayText = sessionName;
        if (isActive) displayText += ' (active)';
        if (isDefault) displayText += ' (default)';

        const highlightedText = highlightMatches(displayText, sessionSearchQuery);

        return `
            <div class="app-item session-item" data-index="${idx}" data-session="${sessionName}" style="cursor: pointer; ${isSelected ? 'background: var(--accent); border-color: var(--accent);' : (isActive ? 'background: #2a2a2a;' : '')}">
                <div style="flex: 1; color: var(--text-primary);">${highlightedText}</div>
                ${!isDefault && !isActive ? `<button class="session-kill-btn" data-session="${sessionName}" style="background: var(--accent); color: white; border: 1px solid var(--accent); padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.75em;">Kill</button>` : ''}
            </div>
        `;
    }).join('');

    // Add click handlers for sessions
    listEl.querySelectorAll('.session-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't trigger if clicking kill button
            if (e.target.classList.contains('session-kill-btn')) {
                return;
            }
            const sessionName = item.dataset.session;
            attachToSession(sessionName);
        });
    });

    // Add click handlers for kill buttons
    listEl.querySelectorAll('.session-kill-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const sessionName = btn.dataset.session;
            showConfirmKill(sessionName);
        });
    });

    // Scroll selected item into view
    const selectedItem = listEl.querySelector(`[data-index="${selectedSessionIndex}"]`);
    if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function performSessionSearch(query) {
    sessionSearchQuery = query;
    const queryDisplay = document.getElementById('session-search-query');
    if (queryDisplay) {
        queryDisplay.textContent = query ? `"${query}"` : '';
    }

    if (!query) {
        selectedSessionIndex = 0;
        renderSessions(sessionsCache);
        return;
    }

    // Fuzzy search
    const results = sessionsCache.map((sessionName, idx) => {
        let displayText = sessionName;
        if (sessionName === currentSessionName) displayText += ' (active)';
        if (sessionName === defaultSessionName) displayText += ' (default)';

        const match = fuzzyMatch(query, displayText);

        return {
            sessionName,
            match: match.match,
            score: match.score,
            originalIndex: idx
        };
    }).filter(r => r.match)
      .sort((a, b) => b.score - a.score)
      .map(r => r.sessionName);

    selectedSessionIndex = 0;
    renderSessions(results);
}

function updateSessionList(sessions) {
    sessionsCache = sessions || [];
    renderSessions(sessionsCache);
}

function attachToSession(sessionName) {
    if (!sessionName) return;

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

    const sessionsDialog = document.getElementById('sessions-dialog');
    const sessionsOverlay = document.getElementById('sessions-overlay');
    sessionsDialog.classList.remove('active');
    sessionsOverlay.classList.remove('active');
    sessionSearchQuery = '';
    selectedSessionIndex = 0;
}

function renderWindows(windows) {
    const listEl = document.getElementById('windows-list');
    filteredWindows = windows;

    if (!windows || windows.length === 0) {
        listEl.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">No windows available</div>';
        return;
    }

    // Ensure selected index is within bounds
    if (selectedWindowIndex >= windows.length) {
        selectedWindowIndex = windows.length - 1;
    }
    if (selectedWindowIndex < 0) {
        selectedWindowIndex = 0;
    }

    listEl.innerHTML = windows.map((w, idx) => {
        const isSelected = idx === selectedWindowIndex;
        const displayText = `${w.index}: ${w.name}`;
        const highlightedText = highlightMatches(displayText, windowSearchQuery);

        return `
            <div class="app-item window-item" data-index="${idx}" data-window-index="${w.index}" style="cursor: pointer; ${isSelected ? 'background: var(--accent); border-color: var(--accent);' : ''}">
                <div style="flex: 1; color: var(--text-primary);">${highlightedText}</div>
            </div>
        `;
    }).join('');

    // Add click handlers
    listEl.querySelectorAll('.window-item').forEach(item => {
        item.addEventListener('click', () => {
            const windowIndex = item.dataset.windowIndex;
            send({ type: 'select_window', index: parseInt(windowIndex) });
            windowsDialog.classList.remove('active');
            windowsOverlay.classList.remove('active');
            windowSearchQuery = '';
            selectedWindowIndex = 0;
        });
    });

    // Scroll selected item into view
    const selectedItem = listEl.querySelector(`[data-index="${selectedWindowIndex}"]`);
    if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function performWindowSearch(query) {
    windowSearchQuery = query;
    const queryDisplay = document.getElementById('window-search-query');
    if (queryDisplay) {
        queryDisplay.textContent = query ? `"${query}"` : '';
    }

    if (!query) {
        selectedWindowIndex = 0;
        renderWindows(windowsCache);
        return;
    }

    // Fuzzy search
    const results = windowsCache.map((w, idx) => {
        const displayText = `${w.index}: ${w.name}`;
        const match = fuzzyMatch(query, displayText);

        return {
            window: w,
            match: match.match,
            score: match.score,
            originalIndex: idx
        };
    }).filter(r => r.match)
      .sort((a, b) => b.score - a.score)
      .map(r => r.window);

    selectedWindowIndex = 0;
    renderWindows(results);
}

function updateWindowsList(windows) {
    windowsCache = windows || [];

    // If no search query, set selection to active window
    if (!windowSearchQuery) {
        const activeIndex = windowsCache.findIndex(w => w.active);
        if (activeIndex !== -1) {
            selectedWindowIndex = activeIndex;
        }
    }

    renderWindows(windowsCache);
}

function connect(remoteHost) {
    // Save remote host for reconnections
    if (remoteHost) {
        currentRemoteHost = remoteHost;
    }

    // Use saved remote host if reconnecting
    const targetHost = remoteHost || currentRemoteHost;

    // Check if this is remote hosting (no ?host parameter means auto-detect)
    const urlParams = new URLSearchParams(window.location.search);
    const hostParam = urlParams.get('host');

    // If no host parameter and this is first connection, try to detect
    if (!hostParam && !targetHost && reconnectAttempts === 0 && !sessionStorage.getItem('wmux_mode_detected')) {
        // Mark that we're attempting detection
        sessionStorage.setItem('wmux_mode_detected', 'trying');
    }

    let wsUrl;
    if (targetHost) {
        // Connect to remote host
        try {
            const url = new URL(targetHost);

            // IMPORTANT: Use WebSocket protocol that matches CURRENT page, not target
            // Browser blocks ws:// from https:// page and wss:// from http:// page (mixed content)
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            wsUrl = `${wsProtocol}//${url.host}/ws`;

            console.log(`Target: ${targetHost}, Current page: ${window.location.protocol}, Using: ${wsProtocol}`);
        } catch (err) {
            console.error('Invalid remote host URL:', targetHost);
            updateStatus('Invalid host URL', false);
            return;
        }
    } else {
        // Connect to current server
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}/ws`;
    }

    console.log('Connecting to:', wsUrl);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        updateStatus('Ready', true);
        reconnectAttempts = 0; // Reset on successful connection

        // Mark mode as detected (connection successful)
        if (sessionStorage.getItem('wmux_mode_detected') === 'trying') {
            sessionStorage.setItem('wmux_mode_detected', 'done');
        }

        // If we had a session before disconnecting, inform user
        const lastSession = localStorage.getItem('wmux_last_session');
        if (lastSession && reconnectAttempts > 0) {
            term.write(`\x1b[32mReconnected! Last session: ${lastSession}\x1b[0m\r\n`);
        }

        // Force terminal resize when WebSocket opens (for SPA initial load)
        setTimeout(() => {
            setActualVH();
            fitAddon.fit();
            console.log(`Terminal fit on WebSocket open - cols: ${term.cols}, rows: ${term.rows}`);
        }, 100);
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

                // Check for auto-connect session in priority order:
                // 1. Server default session (from --default-session flag)
                // 2. Last connected session
                let sessionToConnect = null;

                if (msg.session && msg.sessions && msg.sessions.includes(msg.session)) {
                    sessionToConnect = msg.session;
                    console.log('Auto-attaching to server default session:', sessionToConnect);
                } else {
                    const lastSession = localStorage.getItem('wmux_last_session');
                    if (lastSession && msg.sessions && msg.sessions.includes(lastSession)) {
                        sessionToConnect = lastSession;
                        console.log('Auto-attaching to last session:', sessionToConnect);
                    }
                }

                if (sessionToConnect) {
                    setTimeout(() => {
                        term.reset();
                        term.clear();
                        fitAddon.fit();

                        setTimeout(() => {
                            send({
                                type: 'start',
                                session: sessionToConnect,
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
                document.getElementById('apps-btn').style.display = 'block';
                document.getElementById('sessions-btn').style.display = 'block';
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
                document.getElementById('apps-btn').style.display = 'none';
                document.getElementById('sessions-btn').style.display = 'none';
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

        // If first connection failed and no ?host param, likely remote hosting
        const urlParams = new URLSearchParams(window.location.search);
        const hostParam = urlParams.get('host');

        if (reconnectAttempts === 0 && !hostParam && sessionStorage.getItem('wmux_mode_detected') === 'trying') {
            sessionStorage.removeItem('wmux_mode_detected');
            console.log('No local wmux server detected');

            // In SPA mode, show host selector; otherwise redirect
            if (window.spaMode && typeof window.showView === 'function') {
                window.showView('host-selector');
            } else {
                window.location.href = '/host-manager.html';
            }
            return;
        }

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
            term.write('\x1b[31mMax reconnection attempts reached. Click "Reconnect to Server" to try again.\x1b[0m\r\n');
            updateStatus('Disconnected (manual reconnect required)', false);
        }
    };

    ws.onerror = (error) => {
        updateStatus('Connection error', false);
        console.error('WebSocket error:', error);
    };

    ws.onclose = (event) => {
        updateStatus('Disconnected', false);
        term.write('\r\n\x1b[33mDisconnected from server\x1b[0m\r\n');
        sessionActive = false;
        connected = false;
        ws = null;

        // If WSS connection failed immediately (likely certificate issue)
        if (wsUrl.startsWith('wss://') && reconnectAttempts === 0 && !event.wasClean) {
            const hostUrl = wsUrl.replace('wss://', 'https://').replace('/ws', '');

            term.write('\r\n\x1b[31mSecure WebSocket connection failed!\x1b[0m\r\n');
            term.write('\x1b[33mOpening certificate acceptance page...\x1b[0m\r\n\r\n');

            // Auto-open the HTTPS URL in a new window
            const certWindow = window.open(hostUrl, '_blank');

            if (certWindow) {
                term.write('\x1b[36mSteps:\x1b[0m\r\n');
                term.write('\x1b[36m1. Accept the certificate in the new tab\x1b[0m\r\n');
                term.write('\x1b[36m2. Return here and reconnect\x1b[0m\r\n\r\n');
            } else {
                term.write(`\x1b[36mPlease open: ${hostUrl}\x1b[0m\r\n`);
                term.write('\x1b[36mAccept the certificate, then reconnect\x1b[0m\r\n\r\n');
            }

            // Don't auto-reconnect for certificate issues
            return;
        }

        // If first connection failed and no ?host param, likely remote hosting
        const urlParams = new URLSearchParams(window.location.search);
        const hostParam = urlParams.get('host');

        if (reconnectAttempts === 0 && !hostParam && sessionStorage.getItem('wmux_mode_detected') === 'trying') {
            sessionStorage.removeItem('wmux_mode_detected');
            console.log('No local wmux server detected');

            // In SPA mode, show host selector; otherwise redirect
            if (window.spaMode && typeof window.showView === 'function') {
                window.showView('host-selector');
            } else {
                window.location.href = '/host-manager.html';
            }
            return;
        }

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
            term.write('\x1b[31mMax reconnection attempts reached. Click "Reconnect to Server" to try again.\x1b[0m\r\n');
            updateStatus('Disconnected (manual reconnect required)', false);
        }
    };
}

// Expose connect function for multi-host mode (must be here, not at end of file)
window.connectToBackend = connect;

function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
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
    highlightPaneButton(null);
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
    windowSearchQuery = '';
    selectedWindowIndex = 0;
    send({ type: 'list_windows' });
    windowsDialog.classList.add('active');
    windowsOverlay.classList.add('active');
});

closeWindows.addEventListener('click', () => {
    windowsDialog.classList.remove('active');
    windowsOverlay.classList.remove('active');
    windowSearchQuery = '';
    selectedWindowIndex = 0;
});

windowsOverlay.addEventListener('click', () => {
    windowsDialog.classList.remove('active');
    windowsOverlay.classList.remove('active');
    windowSearchQuery = '';
    selectedWindowIndex = 0;
});

// Sessions dialog toggle
const sessionsBtn = document.getElementById('sessions-btn');
const closeSessions = document.getElementById('close-sessions');
const sessionsDialog = document.getElementById('sessions-dialog');
const sessionsOverlay = document.getElementById('sessions-overlay');

sessionsBtn.addEventListener('click', () => {
    // Refresh session list when opening
    sessionSearchQuery = '';
    selectedSessionIndex = 0;
    send({ type: 'list' });
    sessionsDialog.classList.add('active');
    sessionsOverlay.classList.add('active');
});

closeSessions.addEventListener('click', () => {
    sessionsDialog.classList.remove('active');
    sessionsOverlay.classList.remove('active');
    sessionSearchQuery = '';
    selectedSessionIndex = 0;
});

sessionsOverlay.addEventListener('click', () => {
    sessionsDialog.classList.remove('active');
    sessionsOverlay.classList.remove('active');
    sessionSearchQuery = '';
    selectedSessionIndex = 0;
});

// Applications dialog
let appsCache = [];
let filteredApps = [];
let selectedAppIndex = 0;
let appSearchQuery = '';
let defaultSession = 'screen';

// Windows dialog
let windowsCache = [];
let filteredWindows = [];
let selectedWindowIndex = 0;
let windowSearchQuery = '';

// Sessions dialog
let sessionsCache = [];
let filteredSessions = [];
let selectedSessionIndex = 0;
let sessionSearchQuery = '';

// Prefix key handling (like tmux Ctrl+b)
let prefixKeyPressed = false;
let prefixKeyTimeout = null;
const PREFIX_KEY_TIMEOUT = 1000; // 1 second to press second key

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

function highlightMatches(text, query) {
    if (!query) return text;

    let result = '';
    let textLower = text.toLowerCase();
    let queryLower = query.toLowerCase();
    let queryIdx = 0;

    for (let i = 0; i < text.length && queryIdx < queryLower.length; i++) {
        if (textLower[i] === queryLower[queryIdx]) {
            result += `<span style="color: #0066FF; font-weight: bold;">${text[i]}</span>`;
            queryIdx++;
        } else {
            result += text[i];
        }
    }

    // Add remaining characters
    result += text.slice(result.replace(/<[^>]*>/g, '').length);
    return result;
}

function renderApps(apps) {
    filteredApps = apps;

    if (apps.length === 0) {
        appsList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No apps found</div>';
        return;
    }

    // Ensure selected index is within bounds
    if (selectedAppIndex >= apps.length) {
        selectedAppIndex = apps.length - 1;
    }
    if (selectedAppIndex < 0) {
        selectedAppIndex = 0;
    }

    appsList.innerHTML = apps.map((app, idx) => {
        const isSelected = idx === selectedAppIndex;
        const title = app.title || app.name;
        const highlightedTitle = highlightMatches(title, appSearchQuery);
        const highlightedName = highlightMatches(app.name, appSearchQuery);

        return `
            <div class="app-item" data-app="${app.name}" data-index="${idx}" style="cursor: pointer; ${isSelected ? 'background: var(--accent); border-color: var(--accent);' : ''}">
                <div style="flex: 1;">
                    <div style="font-weight: 500; color: var(--text-primary);">${highlightedTitle}</div>
                    <div style="font-size: 0.75em; color: var(--text-secondary); margin-top: 2px;">${highlightedName}</div>
                </div>
            </div>
        `;
    }).join('');

    // Add click handlers
    appsList.querySelectorAll('.app-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            const appName = item.dataset.app;
            await launchApp(appName);
        });
    });

    // Scroll selected item into view
    const selectedItem = appsList.querySelector(`[data-index="${selectedAppIndex}"]`);
    if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

async function launchApp(appName) {
    // Close apps dialog immediately
    appsDialog.classList.remove('active');
    appsOverlay.classList.remove('active');
    appSearchQuery = '';
    selectedAppIndex = 0;

    console.log(`Starting ${appName}...`);

    // Show loading button immediately for GUI apps
    // (We'll update it when the app is ready)
    const loadingButton = createXpraAppButton(appName, true);

    try {
        const response = await fetch(`/api/apps/${appName}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: currentSessionName || defaultSession })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Server error (${response.status}):`, errorText);
            // Remove loading button on error
            if (loadingButton) loadingButton.remove();
            return;
        }

        const result = await response.json();

        if (result.status === 'success') {
            // Handle xpra mode - show in integrated view
            if (result.mode === 'xpra' && result.session && result.session.url) {
                console.log('Opening xpra session:', result.session.url);

                // Update button to ready state
                updateXpraButtonReady(appName);

                // Store in active apps
                activeXpraApps.set(appName, {
                    url: result.session.url,
                    button: loadingButton
                });

                // Show this app
                showXpraView(appName);
            } else {
                // Terminal app - remove loading button, refresh windows list
                if (loadingButton) loadingButton.remove();
                send({ type: 'list_windows' });
            }
        } else {
            console.error('Launch failed:', result);
            // Remove loading button on error
            if (loadingButton) loadingButton.remove();
        }
    } catch (err) {
        console.error('Failed to launch app:', err);
        // Remove loading button on error
        if (loadingButton) loadingButton.remove();
    }
}

// Apps dialog keyboard navigation
function handleAppsKeydown(e) {
    const appsDialog = document.getElementById('apps-dialog');
    if (!appsDialog || !appsDialog.classList.contains('active')) {
        return false;
    }

    // Handle navigation keys
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedAppIndex = Math.min(selectedAppIndex + 1, filteredApps.length - 1);
        renderApps(filteredApps);
        return true;
    }

    if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedAppIndex = Math.max(selectedAppIndex - 1, 0);
        renderApps(filteredApps);
        return true;
    }

    if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredApps.length > 0 && selectedAppIndex >= 0 && selectedAppIndex < filteredApps.length) {
            const selectedApp = filteredApps[selectedAppIndex];
            launchApp(selectedApp.name);
        }
        return true;
    }

    if (e.key === 'Escape') {
        e.preventDefault();
        appsDialog.classList.remove('active');
        document.getElementById('apps-overlay').classList.remove('active');
        appSearchQuery = '';
        selectedAppIndex = 0;
        return true;
    }

    if (e.key === 'Backspace') {
        e.preventDefault();
        appSearchQuery = appSearchQuery.slice(0, -1);
        performAppSearch(appSearchQuery);
        return true;
    }

    // Handle typing (single printable characters)
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        appSearchQuery += e.key;
        performAppSearch(appSearchQuery);
        return true;
    }

    return false;
}

// Windows dialog keyboard navigation
function handleWindowsKeydown(e) {
    const windowsDialog = document.getElementById('windows-dialog');
    if (!windowsDialog || !windowsDialog.classList.contains('active')) {
        return false;
    }

    // Up/Down = navigate list selection
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedWindowIndex = Math.min(selectedWindowIndex + 1, filteredWindows.length - 1);
        renderWindows(filteredWindows);
        return true;
    }

    if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedWindowIndex = Math.max(selectedWindowIndex - 1, 0);
        renderWindows(filteredWindows);
        return true;
    }

    // ArrowLeft = previous window (tmux action)
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        send({ type: 'prev_window' });
        // Refresh window list to update active state
        setTimeout(() => send({ type: 'list_windows' }), 100);
        return true;
    }

    // ArrowRight = next window (tmux action)
    if (e.key === 'ArrowRight') {
        e.preventDefault();
        send({ type: 'next_window' });
        // Refresh window list to update active state
        setTimeout(() => send({ type: 'list_windows' }), 100);
        return true;
    }

    // = or + = new window
    if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        send({ type: 'new_window' });
        // Refresh window list to show new window
        setTimeout(() => send({ type: 'list_windows' }), 100);
        return true;
    }

    if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredWindows.length > 0 && selectedWindowIndex >= 0 && selectedWindowIndex < filteredWindows.length) {
            const selectedWindow = filteredWindows[selectedWindowIndex];
            send({ type: 'select_window', index: selectedWindow.index });
            windowsDialog.classList.remove('active');
            document.getElementById('windows-overlay').classList.remove('active');
            windowSearchQuery = '';
            selectedWindowIndex = 0;
        }
        return true;
    }

    if (e.key === 'Escape') {
        e.preventDefault();
        windowsDialog.classList.remove('active');
        document.getElementById('windows-overlay').classList.remove('active');
        windowSearchQuery = '';
        selectedWindowIndex = 0;
        return true;
    }

    if (e.key === 'Backspace') {
        e.preventDefault();
        windowSearchQuery = windowSearchQuery.slice(0, -1);
        performWindowSearch(windowSearchQuery);
        return true;
    }

    // Handle typing (single printable characters)
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        windowSearchQuery += e.key;
        performWindowSearch(windowSearchQuery);
        return true;
    }

    return false;
}

// Sessions dialog keyboard navigation
function handleSessionsKeydown(e) {
    const sessionsDialog = document.getElementById('sessions-dialog');
    if (!sessionsDialog || !sessionsDialog.classList.contains('active')) {
        return false;
    }

    // Don't handle if typing in the new session name input
    if (e.target.id === 'new-session-name') {
        return false;
    }

    // Handle navigation keys
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedSessionIndex = Math.min(selectedSessionIndex + 1, filteredSessions.length - 1);
        renderSessions(filteredSessions);
        return true;
    }

    if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedSessionIndex = Math.max(selectedSessionIndex - 1, 0);
        renderSessions(filteredSessions);
        return true;
    }

    if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredSessions.length > 0 && selectedSessionIndex >= 0 && selectedSessionIndex < filteredSessions.length) {
            const selectedSession = filteredSessions[selectedSessionIndex];
            attachToSession(selectedSession);
        }
        return true;
    }

    if (e.key === 'Escape') {
        e.preventDefault();
        sessionsDialog.classList.remove('active');
        document.getElementById('sessions-overlay').classList.remove('active');
        sessionSearchQuery = '';
        selectedSessionIndex = 0;
        return true;
    }

    if (e.key === 'Backspace') {
        e.preventDefault();
        sessionSearchQuery = sessionSearchQuery.slice(0, -1);
        performSessionSearch(sessionSearchQuery);
        return true;
    }

    // Handle typing (single printable characters)
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        sessionSearchQuery += e.key;
        performSessionSearch(sessionSearchQuery);
        return true;
    }

    return false;
}

// Panes dialog keyboard navigation
let selectedPaneAction = null; // 'split-h', 'split-v', 'close-pane', 'zoom-pane'

function highlightPaneButton(action) {
    // Remove all highlights
    ['split-h', 'split-v', 'close-pane', 'zoom-pane'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.style.background = 'var(--bg-tertiary)';
            btn.style.borderColor = 'var(--border)';
        }
    });

    // Highlight selected
    if (action) {
        const btn = document.getElementById(action);
        if (btn) {
            btn.style.background = 'var(--accent)';
            btn.style.borderColor = 'var(--accent)';
        }
    }
    selectedPaneAction = action;
}

function handlePanesKeydown(e) {
    const controlsDialog = document.getElementById('controls-dialog');
    if (!controlsDialog || !controlsDialog.classList.contains('active')) {
        return false;
    }

    // H for Horizontal split
    if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        highlightPaneButton('split-h');
        return true;
    }

    // V for Vertical split
    if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        highlightPaneButton('split-v');
        return true;
    }

    // \ or | for Horizontal split (execute directly)
    if (e.key === '\\' || e.key === '|') {
        e.preventDefault();
        send({ type: 'split_horizontal' });
        return true;
    }

    // - or _ for Vertical split (execute directly)
    if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        send({ type: 'split_vertical' });
        return true;
    }

    // C for Close pane
    if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        highlightPaneButton('close-pane');
        return true;
    }

    // Z for Zoom toggle
    if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        highlightPaneButton('zoom-pane');
        return true;
    }

    // Enter to activate selected button
    if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedPaneAction) {
            const btn = document.getElementById(selectedPaneAction);
            if (btn) {
                btn.click();
            }
        }
        return true;
    }

    // Escape to close
    if (e.key === 'Escape') {
        e.preventDefault();
        controlsDialog.classList.remove('active');
        document.getElementById('controls-overlay').classList.remove('active');
        highlightPaneButton(null);
        return true;
    }

    return false;
}

if (appsBtn) {
    appsBtn.addEventListener('click', () => {
        loadApps();
        appSearchQuery = '';
        selectedAppIndex = 0;
        appsDialog.classList.add('active');
        appsOverlay.classList.add('active');
        performAppSearch('');
    });
}

if (closeApps) {
    closeApps.addEventListener('click', () => {
        appsDialog.classList.remove('active');
        appsOverlay.classList.remove('active');
        appSearchQuery = '';
        selectedAppIndex = 0;
    });
}

if (appsOverlay) {
    appsOverlay.addEventListener('click', () => {
        appsDialog.classList.remove('active');
        appsOverlay.classList.remove('active');
        appSearchQuery = '';
        selectedAppIndex = 0;
    });
}

// Fuzzy search function with scoring
function fuzzyMatch(query, text) {
    if (!query) return { match: true, score: 0 };
    if (!text) return { match: false, score: -1 };

    query = query.toLowerCase();
    text = text.toLowerCase();

    // Exact match
    if (text === query) return { match: true, score: 1000 };

    // Contains match
    if (text.includes(query)) {
        const score = text.startsWith(query) ? 500 : 100;
        return { match: true, score };
    }

    // Character-by-character fuzzy matching
    let queryIdx = 0;
    let lastMatchIdx = -1;
    let score = 50;

    for (let i = 0; i < text.length && queryIdx < query.length; i++) {
        if (text[i] === query[queryIdx]) {
            // Bonus for consecutive matches
            if (lastMatchIdx === i - 1) {
                score += 5;
            }
            lastMatchIdx = i;
            queryIdx++;
        }
    }

    if (queryIdx === query.length) {
        return { match: true, score };
    }

    return { match: false, score: -1 };
}

function performAppSearch(query) {
    appSearchQuery = query;
    const queryDisplay = document.getElementById('app-search-query');
    if (queryDisplay) {
        queryDisplay.textContent = query ? `"${query}"` : '';
    }

    if (!query) {
        selectedAppIndex = 0;
        renderApps(appsCache);
        return;
    }

    // Fuzzy search with scoring
    const results = appsCache.map(app => {
        const nameMatch = fuzzyMatch(query, app.name);
        const titleMatch = fuzzyMatch(query, app.title || '');
        const bestScore = Math.max(nameMatch.score, titleMatch.score);

        return {
            app,
            match: nameMatch.match || titleMatch.match,
            score: bestScore
        };
    }).filter(r => r.match)
      .sort((a, b) => b.score - a.score)
      .map(r => r.app);

    selectedAppIndex = 0;
    renderApps(results);
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

    // Clear input
    document.getElementById('new-session-name').value = '';

    sessionsDialog.classList.remove('active');
    sessionsOverlay.classList.remove('active');
    sessionSearchQuery = '';
    selectedSessionIndex = 0;
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

// Kill buttons are now in the session list items (rendered dynamically)

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

    // Mark that mode has already been detected (don't trigger host selector on failure)
    sessionStorage.setItem('wmux_mode_detected', 'done');

    // Reset reconnect counter and connect
    reconnectAttempts = 0;
    term.write('\r\n\x1b[36mManual reconnect initiated...\x1b[0m\r\n');
    updateStatus('Reconnecting...', false);
    connect();

    navMenu.classList.remove('active');
    navOverlay.classList.remove('active');
});

document.getElementById('disconnect-btn').addEventListener('click', () => {
    if (sessionActive) {
        send({ type: 'disconnect' });
        sessionActive = false;
        term.clear();
        updateStatus('Ready', true);

        // Hide controls button
        document.getElementById('controls-btn').style.display = 'none';

        navMenu.classList.remove('active');
        navOverlay.classList.remove('active');
    }
});
document.getElementById('split-h').addEventListener('click', () => {
    send({ type: 'split_horizontal' });
    controlsDialog.classList.remove('active');
    controlsOverlay.classList.remove('active');
    term.focus();
});

document.getElementById('split-v').addEventListener('click', () => {
    send({ type: 'split_vertical' });
    controlsDialog.classList.remove('active');
    controlsOverlay.classList.remove('active');
    term.focus();
});

document.getElementById('new-window').addEventListener('click', () => {
    send({ type: 'new_window' });
});

document.getElementById('next-window').addEventListener('click', () => {
    send({ type: 'next_window' });
});

document.getElementById('prev-window').addEventListener('click', () => {
    send({ type: 'prev_window' });
});

document.getElementById('close-window').addEventListener('click', () => {
    if (filteredWindows.length > 0 && selectedWindowIndex >= 0 && selectedWindowIndex < filteredWindows.length) {
        const windowIndex = filteredWindows[selectedWindowIndex].index;
        send({ type: 'kill_window', index: windowIndex });
    }
});

document.getElementById('rename-window').addEventListener('click', () => {
    const renameDialog = document.getElementById('rename-window-dialog');
    const renameOverlay = document.getElementById('rename-window-overlay');
    const renameInput = document.getElementById('rename-window-input');

    // Get current window name if possible
    if (filteredWindows.length > 0 && selectedWindowIndex >= 0 && selectedWindowIndex < filteredWindows.length) {
        const currentWindow = filteredWindows[selectedWindowIndex];
        renameInput.value = currentWindow.name;
    } else {
        renameInput.value = '';
    }

    // Close Windows dialog
    windowsDialog.classList.remove('active');
    windowsOverlay.classList.remove('active');

    // Open rename dialog
    renameDialog.classList.add('active');
    renameOverlay.classList.add('active');

    // Focus the input
    setTimeout(() => renameInput.focus(), 100);
});

document.getElementById('close-pane').addEventListener('click', () => {
    send({ type: 'kill_pane' });
    controlsDialog.classList.remove('active');
    controlsOverlay.classList.remove('active');
    term.focus();
});

document.getElementById('zoom-pane').addEventListener('click', () => {
    send({ type: 'zoom_pane' });
    controlsDialog.classList.remove('active');
    controlsOverlay.classList.remove('active');
    term.focus();
});

// Rename window dialog handlers
const renameWindowDialog = document.getElementById('rename-window-dialog');
const renameWindowOverlay = document.getElementById('rename-window-overlay');
const renameWindowInput = document.getElementById('rename-window-input');
const closeRenameWindow = document.getElementById('close-rename-window');
const renameWindowSubmit = document.getElementById('rename-window-submit');

closeRenameWindow.addEventListener('click', () => {
    renameWindowDialog.classList.remove('active');
    renameWindowOverlay.classList.remove('active');
});

renameWindowOverlay.addEventListener('click', () => {
    renameWindowDialog.classList.remove('active');
    renameWindowOverlay.classList.remove('active');
});

renameWindowSubmit.addEventListener('click', () => {
    const newName = renameWindowInput.value.trim();

    // Close rename dialog
    renameWindowDialog.classList.remove('active');
    renameWindowOverlay.classList.remove('active');

    if (newName && sessionActive && filteredWindows.length > 0 && selectedWindowIndex >= 0 && selectedWindowIndex < filteredWindows.length) {
        const windowIndex = filteredWindows[selectedWindowIndex].index;
        // Send backend rename command
        send({
            type: 'rename_window',
            index: windowIndex,
            data: newName
        });
        // Refresh window list to see the new name
        setTimeout(() => send({ type: 'list_windows' }), 100);
    }

    // Refocus terminal
    term.focus();
});

// Allow Enter key to submit rename
renameWindowInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        renameWindowSubmit.click();
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        renameWindowDialog.classList.remove('active');
        renameWindowOverlay.classList.remove('active');
    }
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

// Xpra overlay functions
// Removed - now using currentXpraApp in activeXpraApps system above

function showXpraView(appName) {
    const appData = activeXpraApps.get(appName);
    if (!appData) {
        console.error(`App ${appName} not found in active apps`);
        return;
    }

    const xpraOverlay = document.getElementById('xpra-overlay');
    const xpraFrame = document.getElementById('xpra-frame');
    const xpraLoading = document.getElementById('xpra-loading');

    if (xpraOverlay && xpraFrame && xpraLoading) {
        currentXpraApp = appName;

        // Show overlay with loading message
        xpraOverlay.style.display = 'block';
        xpraLoading.style.display = 'flex';
        xpraFrame.style.display = 'none';

        // Set iframe URL
        xpraFrame.src = appData.url;

        // Wait for iframe to load, then hide loading
        xpraFrame.onload = function() {
            xpraLoading.style.display = 'none';
            xpraFrame.style.display = 'block';
            console.log(`Xpra app ${appName} loaded`);
        };

        console.log(`Showing xpra overlay for ${appName} at ${appData.url}`);
    }
}

function hideXpraView() {
    const xpraOverlay = document.getElementById('xpra-overlay');

    if (xpraOverlay) {
        // Hide overlay (but keep iframe loaded and buttons visible)
        xpraOverlay.style.display = 'none';
        currentXpraApp = null;

        console.log('Hid xpra overlay (apps still running)');
    }
}

async function closeXpraApp(appName) {
    if (!activeXpraApps.has(appName)) return;

    const xpraOverlay = document.getElementById('xpra-overlay');
    const xpraFrame = document.getElementById('xpra-frame');

    // Call API to stop xpra session
    try {
        const response = await fetch('/api/xpra/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appName: appName })
        });

        if (!response.ok) {
            console.error('Failed to stop xpra session:', await response.text());
        } else {
            console.log('Xpra session stopped successfully');
        }
    } catch (err) {
        console.error('Error stopping xpra session:', err);
    }

    // Remove from active apps
    removeXpraAppButton(appName);
    activeXpraApps.delete(appName);

    // If this was the current app, hide the overlay
    if (currentXpraApp === appName) {
        if (xpraOverlay) xpraOverlay.style.display = 'none';
        if (xpraFrame) xpraFrame.src = '';
        currentXpraApp = null;
    }

    console.log(`Closed xpra app ${appName} completely`);
}

// toggleXpraView removed - toggle logic now in createXpraAppButton() click handlers

// Setup xpra buttons
// Xpra app buttons are now created dynamically in createXpraAppButton()
// Old static button code removed

// Other buttons (Windows, Panes) hide xpra overlay to show terminal
if (controlsBtn) {
    controlsBtn.addEventListener('click', () => {
        if (currentXpraApp) hideXpraView();
    });
}

if (windowsBtn) {
    windowsBtn.addEventListener('click', () => {
        if (currentXpraApp) hideXpraView();
    });
}

// Track all active xpra apps
const activeXpraApps = new Map(); // appName -> { url, button }
let currentXpraApp = null;

// Create app button dynamically
function createXpraAppButton(appName, isLoading = false) {
    const container = document.getElementById('xpra-app-buttons');
    if (!container) return null;

    const button = document.createElement('button');
    button.className = 'controls-button';
    button.dataset.appName = appName;

    if (isLoading) {
        button.innerHTML = `
            <span class="app-name-click" style="cursor: pointer;">${appName}</span>
            <span style="margin: 0 4px; color: white;">│</span>
            <span>⏳</span>
        `;
    } else {
        button.innerHTML = `
            <span class="app-name-click" style="cursor: pointer;">${appName}</span>
            <span style="margin: 0 4px; color: white;">│</span>
            <span class="app-close-btn" style="cursor: pointer;">✕</span>
        `;
    }

    if (!isLoading) {
        // Click on app name → show/toggle view
        button.querySelector('.app-name-click').addEventListener('click', () => {
            if (currentXpraApp === appName) {
                hideXpraView();
            } else {
                showXpraView(appName);
            }
        });

        // Click on ✕ → close app completely
        const closeBtn = button.querySelector('.app-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await closeXpraApp(appName);
            });
        }
    }

    container.appendChild(button);
    return button;
}

// Update button from loading to ready
function updateXpraButtonReady(appName) {
    const container = document.getElementById('xpra-app-buttons');
    if (!container) return;

    const button = container.querySelector(`[data-app-name="${appName}"]`);
    if (!button) return;

    button.innerHTML = `
        <span class="app-name-click" style="cursor: pointer;">${appName}</span>
        <span style="margin: 0 4px; color: white;">│</span>
        <span class="app-close-btn" style="cursor: pointer;">✕</span>
    `;

    // Re-attach click handlers
    button.querySelector('.app-name-click').addEventListener('click', () => {
        if (currentXpraApp === appName) {
            hideXpraView();
        } else {
            showXpraView(appName);
        }
    });

    button.querySelector('.app-close-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        await closeXpraApp(appName);
    });
}

// Remove app button
function removeXpraAppButton(appName) {
    const container = document.getElementById('xpra-app-buttons');
    if (!container) return;

    const button = container.querySelector(`[data-app-name="${appName}"]`);
    if (button) {
        button.remove();
    }
}

// Restore active xpra sessions on page load
async function restoreXpraSessions() {
    try {
        const response = await fetch('/api/xpra/sessions');
        if (!response.ok) return;

        const data = await response.json();
        if (!data.sessions || data.sessions.length === 0) return;

        // Restore each active session (buttons only, don't show apps)
        for (const session of data.sessions) {
            const button = createXpraAppButton(session.app_name);
            activeXpraApps.set(session.app_name, {
                url: session.url,
                button: button
            });
        }

        // Don't auto-show any app - keep terminal visible
        // User can click app button to switch to it
        console.log(`Restored ${data.sessions.length} xpra session(s)`);
    } catch (err) {
        console.error('Failed to restore xpra sessions:', err);
    }
}

// Main initialization function for SPA
async function initApp() {
    if (!term) {
        initTerminal();
        setupClipboardSupport();
        setupMobileKeyboard();
        setupViewport();
        setupEventListeners();
        startDebugUpdates();
    }

    // Check if we should auto-connect
    const urlParams = new URLSearchParams(window.location.search);
    const hostParam = urlParams.get('host');

    // Try to detect if backend is available
    let hasBackend = false;
    try {
        const response = await fetch('/api/config', { method: 'HEAD' });
        hasBackend = response.ok;
    } catch (err) {
        hasBackend = false;
    }

    // Only connect if:
    // 1. There's a host parameter (explicit connection to different host)
    // 2. OR backend is available on current server
    if (hostParam || hasBackend) {
        connect();
        restoreXpraSessions();
    } else {
        // No backend - static deployment mode
        console.log('No local backend detected - multi-host mode');
        updateStatus('No connection', false);
    }
}

// For backwards compatibility and SPA routing
if (typeof window.initTerminalView === 'undefined') {
    window.initTerminalView = initApp;
}

// Auto-init if not in SPA mode (connect.html)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('terminal') && !window.spaMode) {
            initApp();
        }
    });
} else {
    if (document.getElementById('terminal') && !window.spaMode) {
        initApp();
    }
}
