// SPA Router - Detects mode and shows appropriate view
let appConfig = null;
let currentView = null;

// Set SPA mode flag for app.js
window.spaMode = true;

// Utility function
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize SPA
async function initSPA() {
    try {
        const response = await fetch('/api/config');
        appConfig = await response.json();
    } catch (err) {
        console.error('Failed to load config:', err);
        appConfig = { multiHost: false, defaultSession: 'screen' };
    }

    route();
}

function route() {
    const urlParams = new URLSearchParams(window.location.search);
    const hostParam = urlParams.get('host');

    if (appConfig.multiHost && !hostParam) {
        showView('host-selector');
    } else {
        showView('terminal');
    }
}

function showView(viewName) {
    const hostSelectorView = document.getElementById('view-host-selector');
    const terminalView = document.getElementById('view-terminal');

    if (viewName === 'host-selector') {
        hostSelectorView.style.display = 'flex';
        terminalView.style.display = 'none';
        currentView = 'host-selector';
        initHostSelector();
    } else {
        hostSelectorView.style.display = 'none';
        terminalView.style.display = 'flex';
        currentView = 'terminal';

        // Force layout recalculation
        terminalView.offsetHeight;

        // Wait for layout to fully settle before initializing terminal
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                initTerminalView();
            });
        });
    }
}

// Make showView globally available for app.js
window.showView = showView;

// Host Selector Logic
function initHostSelector() {
    loadSavedHosts();
    if (appConfig.exposeHosts) {
        discoverHosts();
    }

    // Add host dialog event listeners
    const showAddHost = document.getElementById('show-add-host');
    const closeAddHost = document.getElementById('close-add-host');
    const addHostDialog = document.getElementById('add-host-dialog');
    const addHostOverlay = document.getElementById('add-host-overlay');

    showAddHost.addEventListener('click', () => {
        addHostDialog.classList.add('active');
        addHostOverlay.classList.add('active');
    });

    closeAddHost.addEventListener('click', () => {
        addHostDialog.classList.remove('active');
        addHostOverlay.classList.remove('active');
    });

    addHostOverlay.addEventListener('click', () => {
        addHostDialog.classList.remove('active');
        addHostOverlay.classList.remove('active');
    });

    document.getElementById('add-host-submit').addEventListener('click', addHost);
}

function loadSavedHosts() {
    const hosts = JSON.parse(localStorage.getItem('wmux_hosts') || '[]');
    const container = document.getElementById('saved-hosts');

    // Get current server URL (this server)
    const currentServer = `${window.location.protocol}//${window.location.host}`;

    let html = '';

    // Add "This Server" as first option
    html += `
        <div class="host-item" style="border-color: #0066FF;">
            <div class="host-info">
                <div class="host-name">
                    This Server
                    <span style="color: #0066FF; font-size: 0.8em; margin-left: 10px;">[LOCAL]</span>
                </div>
                <div class="host-url">${currentServer}</div>
            </div>
            <button onclick="connectToHost('${escapeHtml(currentServer)}')" style="background: var(--accent); color: white; border: 1px solid var(--accent); padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 0.85em; text-transform: uppercase;">Connect</button>
        </div>
    `;

    // Add saved hosts
    if (hosts.length > 0) {
        html += hosts.map(host => `
            <div class="host-item">
                <div class="host-info">
                    <div class="host-name">${escapeHtml(host.name)}</div>
                    <div class="host-url">${escapeHtml(host.url)}</div>
                </div>
                <button onclick="connectToHost('${escapeHtml(host.url)}')" style="background: var(--accent); color: white; border: 1px solid var(--accent); padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 0.85em; text-transform: uppercase;">Connect</button>
            </div>
        `).join('');
    }

    container.innerHTML = html;
}

async function discoverHosts() {
    try {
        const response = await fetch('/api/discover');
        const hosts = await response.json();

        const container = document.getElementById('discovered-hosts');
        if (!hosts || hosts.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = '<h3 style="margin-bottom: 10px;">Discovered Hosts</h3>' +
            hosts.map(host => `
                <div class="host-item">
                    <div class="host-info">
                        <div class="host-name">${escapeHtml(host.Name)}</div>
                        <div class="host-url">${escapeHtml(host.URL)}</div>
                    </div>
                    <button onclick="connectToHost('${escapeHtml(host.URL)}')" style="background: var(--accent); color: white; border: 1px solid var(--accent); padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 0.85em; text-transform: uppercase;">Connect</button>
                </div>
            `).join('');
    } catch (err) {
        console.error('Discovery failed:', err);
    }
}

function addHost() {
    const name = document.getElementById('host-name-input').value.trim();
    const url = document.getElementById('host-url-input').value.trim();

    if (!name || !url) {
        alert('Please enter both name and URL');
        return;
    }

    const hosts = JSON.parse(localStorage.getItem('wmux_hosts') || '[]');
    hosts.push({ name, url });
    localStorage.setItem('wmux_hosts', JSON.stringify(hosts));

    document.getElementById('host-name-input').value = '';
    document.getElementById('host-url-input').value = '';

    loadSavedHosts();

    // Close dialog
    document.getElementById('add-host-dialog').classList.remove('active');
    document.getElementById('add-host-overlay').classList.remove('active');
}

function connectToHost(url) {
    const currentServer = `${window.location.protocol}//${window.location.host}`;

    if (url === currentServer) {
        // Connecting to this server - just show terminal view
        showView('terminal');
    } else {
        // Connecting to remote host - redirect to it
        window.location.href = url;
    }
}

// Terminal View Logic - will be initialized from app.js
let terminalInitialized = false;

function initTerminalView() {
    if (terminalInitialized) return;
    terminalInitialized = true;

    // Wait for app.js to load, then call initApp
    // app.js sets window.initTerminalView to point to initApp
    const attemptInit = () => {
        if (typeof initApp === 'function') {
            initApp();
        } else {
            // app.js not loaded yet, retry
            setTimeout(attemptInit, 50);
        }
    };
    attemptInit();
}

// Start SPA after DOM and scripts are loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSPA);
} else {
    // DOM already loaded
    initSPA();
}
