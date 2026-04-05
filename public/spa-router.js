// SPA Router - Detects mode and shows appropriate view
let appConfig = null;
let currentView = null;

// Set SPA mode flag for app.js
window.spaMode = true;

// Hosts dialog state
let hostsCache = [];
let filteredHosts = [];
let selectedHostIndex = 0;
let hostSearchQuery = '';

// Utility function
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Fuzzy match for hosts (reuse from app.js concept)
function fuzzyMatchHost(query, text) {
    if (!query) return { match: true, score: 0 };
    if (!text) return { match: false, score: -1 };

    query = query.toLowerCase();
    text = text.toLowerCase();

    if (text === query) return { match: true, score: 1000 };
    if (text.includes(query)) {
        const score = text.startsWith(query) ? 500 : 100;
        return { match: true, score };
    }

    let queryIdx = 0;
    let lastMatchIdx = -1;
    let score = 50;

    for (let i = 0; i < text.length && queryIdx < query.length; i++) {
        if (text[i] === query[queryIdx]) {
            if (lastMatchIdx === i - 1) score += 5;
            lastMatchIdx = i;
            queryIdx++;
        }
    }

    if (queryIdx === query.length) {
        return { match: true, score };
    }

    return { match: false, score: -1 };
}

function highlightMatchesHost(text, query) {
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

    result += text.slice(result.replace(/<[^>]*>/g, '').length);
    return result;
}

// Initialize SPA
async function initSPA() {
    try {
        const response = await fetch('/api/config');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        appConfig = await response.json();
    } catch (err) {
        console.error('Failed to load config:', err);
        // No backend detected - default to multi-host mode (static deployment)
        appConfig = { multiHost: true, defaultSession: 'screen' };
    }

    route();
}

async function route() {
    const urlParams = new URLSearchParams(window.location.search);
    const hostParam = urlParams.get('host');

    // Always show terminal view
    showView('terminal');

    // In multi-host mode, check for auto-connect or show hosts dialog
    if (appConfig.multiHost && !hostParam) {
        const autoConnectHost = localStorage.getItem('wmux_auto_connect_host');
        const currentServer = `${window.location.protocol}//${window.location.host}`;

        // Auto-connect to different server
        if (autoConnectHost && autoConnectHost !== currentServer) {
            console.log('Auto-connecting to remote:', autoConnectHost);
            connectToHost(autoConnectHost);
            return;
        }

        // Auto-connect to current server (this server)
        if (autoConnectHost && autoConnectHost === currentServer) {
            console.log('Auto-connect to current server - initApp will handle connection');
            // Do nothing - initApp() will connect normally
            return;
        }

        // No auto-connect configured - check if backend exists
        let hasBackend = false;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); // Increased timeout
            const response = await fetch('/api/config', {
                method: 'HEAD',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            hasBackend = response.ok;
        } catch (err) {
            hasBackend = false;
        }

        if (!hasBackend) {
            // No backend - static deployment, show hosts dialog
            setTimeout(() => {
                const hostsDialog = document.getElementById('hosts-dialog');
                const hostsOverlay = document.getElementById('hosts-overlay');
                if (hostsDialog && hostsOverlay) {
                    loadHostsDialog();
                    hostsDialog.classList.add('active');
                    hostsOverlay.classList.add('active');
                }
            }, 100);
        }
        // If hasBackend but no auto-connect, let initApp() connect normally
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

        // Show hosts button in multi-host mode
        const hostsBtn = document.getElementById('hosts-btn');
        if (hostsBtn && appConfig && appConfig.multiHost) {
            hostsBtn.style.display = 'block';
        }

        // Initialize hosts dialog event listeners
        initHostSelector();

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

// Hosts dialog keyboard navigation
function handleHostsKeydown(e) {
    const hostsDialog = document.getElementById('hosts-dialog');
    const addHostDialog = document.getElementById('add-host-dialog');

    // Don't handle if add-host dialog is open
    if (addHostDialog && addHostDialog.classList.contains('active')) {
        return false;
    }

    if (!hostsDialog || !hostsDialog.classList.contains('active')) {
        return false;
    }

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedHostIndex = Math.min(selectedHostIndex + 1, filteredHosts.length - 1);
        renderHosts(filteredHosts);
        return true;
    }

    if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedHostIndex = Math.max(selectedHostIndex - 1, 0);
        renderHosts(filteredHosts);
        return true;
    }

    if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredHosts.length > 0 && selectedHostIndex >= 0 && selectedHostIndex < filteredHosts.length) {
            const selectedHost = filteredHosts[selectedHostIndex];
            connectToHost(selectedHost.url);
        }
        return true;
    }

    if (e.key === 'Escape') {
        e.preventDefault();
        hostsDialog.classList.remove('active');
        document.getElementById('hosts-overlay').classList.remove('active');
        hostSearchQuery = '';
        selectedHostIndex = 0;
        return true;
    }

    if (e.key === 'Backspace') {
        e.preventDefault();
        hostSearchQuery = hostSearchQuery.slice(0, -1);
        performHostSearch(hostSearchQuery);
        return true;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        hostSearchQuery += e.key;
        performHostSearch(hostSearchQuery);
        return true;
    }

    return false;
}

// Make available globally for app.js
window.handleHostsKeydown = handleHostsKeydown;

// Host Selector Logic
let hostSelectorInitialized = false;

async function initHostSelector() {
    await loadSavedHosts();
    if (appConfig && appConfig.exposeHosts) {
        discoverHosts();
    }

    // Only attach event listeners once
    if (hostSelectorInitialized) return;
    hostSelectorInitialized = true;

    // Add host dialog event listeners
    const showAddHost = document.getElementById('show-add-host-dialog');
    const closeAddHost = document.getElementById('close-add-host');
    const addHostDialog = document.getElementById('add-host-dialog');
    const addHostOverlay = document.getElementById('add-host-overlay');

    if (showAddHost) {
        showAddHost.addEventListener('click', () => {
            // Close hosts dialog
            const hostsDialog = document.getElementById('hosts-dialog');
            const hostsOverlay = document.getElementById('hosts-overlay');
            if (hostsDialog && hostsOverlay) {
                hostsDialog.classList.remove('active');
                hostsOverlay.classList.remove('active');
            }

            // Open add host dialog
            addHostDialog.classList.add('active');
            addHostOverlay.classList.add('active');

            // Focus name input
            setTimeout(() => {
                const nameInput = document.getElementById('host-name-input');
                if (nameInput) nameInput.focus();
            }, 100);
        });
    }

    if (closeAddHost) {
        closeAddHost.addEventListener('click', () => {
            addHostDialog.classList.remove('active');
            addHostOverlay.classList.remove('active');
            // Don't reopen hosts dialog on cancel
        });
    }

    if (addHostOverlay) {
        addHostOverlay.addEventListener('click', () => {
            addHostDialog.classList.remove('active');
            addHostOverlay.classList.remove('active');
            // Don't reopen hosts dialog on cancel
        });
    }

    const addHostSubmit = document.getElementById('add-host-submit');
    if (addHostSubmit) {
        addHostSubmit.addEventListener('click', addHost);
    }

    // Handle Enter key in input fields
    const nameInput = document.getElementById('host-name-input');
    const urlInput = document.getElementById('host-url-input');

    if (nameInput) {
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                // Move to URL field
                urlInput.focus();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                addHostDialog.classList.remove('active');
                addHostOverlay.classList.remove('active');
            }
        });
    }

    if (urlInput) {
        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addHostSubmit.click();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                addHostDialog.classList.remove('active');
                addHostOverlay.classList.remove('active');
            }
        });
    }

    // Hosts button and dialog event listeners
    const hostsBtn = document.getElementById('hosts-btn');
    const closeHosts = document.getElementById('close-hosts');
    const hostsDialog = document.getElementById('hosts-dialog');
    const hostsOverlay = document.getElementById('hosts-overlay');

    if (hostsBtn) {
        hostsBtn.addEventListener('click', () => {
            loadHostsDialog();
            hostsDialog.classList.add('active');
            hostsOverlay.classList.add('active');
        });
    }

    if (closeHosts) {
        closeHosts.addEventListener('click', () => {
            hostsDialog.classList.remove('active');
            hostsOverlay.classList.remove('active');
            hostSearchQuery = '';
            selectedHostIndex = 0;
        });
    }

    if (hostsOverlay) {
        hostsOverlay.addEventListener('click', () => {
            hostsDialog.classList.remove('active');
            hostsOverlay.classList.remove('active');
            hostSearchQuery = '';
            selectedHostIndex = 0;
        });
    }
}

async function loadSavedHosts() {
    const hosts = JSON.parse(localStorage.getItem('wmux_hosts') || '[]');
    const container = document.getElementById('saved-hosts');

    // Get current server URL (this server)
    const currentServer = `${window.location.protocol}//${window.location.host}`;
    const autoConnectHost = localStorage.getItem('wmux_auto_connect_host');

    // Sync autoConnect property on hosts based on wmux_auto_connect_host
    hosts.forEach(host => {
        host.autoConnect = (autoConnectHost === host.url);
    });

    // Check if current server has backend
    let hasBackend = false;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000); // 1 second timeout
        const response = await fetch('/api/config', {
            method: 'HEAD',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        hasBackend = response.ok;
    } catch (err) {
        hasBackend = false;
    }

    console.log('Backend detection:', hasBackend);

    let html = '';

    // Only add "This Server" if backend exists
    if (hasBackend) {
        const localAutoConnect = autoConnectHost === currentServer;
        html += `
            <div class="host-item" style="border-color: #0066FF; ${localAutoConnect ? 'background: #1a1a2a;' : ''}">
                <div class="host-info">
                    <div class="host-name">
                        This Server
                        <span style="color: #0066FF; font-size: 0.8em; margin-left: 10px;">[LOCAL]</span>
                        ${localAutoConnect ? '<span style="color: var(--accent); font-size: 0.8em; margin-left: 10px;">[AUTO]</span>' : ''}
                    </div>
                    <div class="host-url">${currentServer}</div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button onclick="toggleAutoConnect('${escapeHtml(currentServer)}')" style="background: ${localAutoConnect ? 'var(--accent)' : 'var(--bg-tertiary)'}; color: white; border: 1px solid ${localAutoConnect ? 'var(--accent)' : 'var(--border)'}; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 0.75em; text-transform: uppercase;">Auto</button>
                    <button onclick="connectToHost('${escapeHtml(currentServer)}')" style="background: var(--accent); color: white; border: 1px solid var(--accent); padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 0.85em; text-transform: uppercase;">Connect</button>
                </div>
            </div>
        `;
    }

    // Add saved hosts
    if (hosts.length > 0) {
        html += hosts.map((host, idx) => {
            const isAutoConnect = host.autoConnect || false;
            return `
                <div class="host-item" style="${isAutoConnect ? 'background: #1a1a2a;' : ''}">
                    <div class="host-info">
                        <div class="host-name">
                            ${escapeHtml(host.name)}
                            ${isAutoConnect ? '<span style="color: var(--accent); font-size: 0.8em; margin-left: 10px;">[AUTO]</span>' : ''}
                        </div>
                        <div class="host-url">${escapeHtml(host.url)}</div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="toggleHostAutoConnect(${idx})" style="background: ${isAutoConnect ? 'var(--accent)' : 'var(--bg-tertiary)'}; color: white; border: 1px solid ${isAutoConnect ? 'var(--accent)' : 'var(--border)'}; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 0.75em; text-transform: uppercase;">Auto</button>
                        <button onclick="removeHost(${idx})" style="background: var(--bg-tertiary); color: white; border: 1px solid var(--border); padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 0.75em; text-transform: uppercase;">Remove</button>
                        <button onclick="connectToHost('${escapeHtml(host.url)}')" style="background: var(--accent); color: white; border: 1px solid var(--accent); padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 0.85em; text-transform: uppercase;">Connect</button>
                    </div>
                </div>
            `;
        }).join('');
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

async function addHost() {
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

    // Close add dialog
    document.getElementById('add-host-dialog').classList.remove('active');
    document.getElementById('add-host-overlay').classList.remove('active');

    // Reload the hosts dialog to show the new host
    await loadHostsDialog();

    // Reopen hosts dialog
    const hostsDialog = document.getElementById('hosts-dialog');
    const hostsOverlay = document.getElementById('hosts-overlay');
    if (hostsDialog && hostsOverlay) {
        hostsDialog.classList.add('active');
        hostsOverlay.classList.add('active');
    }
}

function renderHosts(hosts) {
    const listEl = document.getElementById('hosts-list');
    filteredHosts = hosts;

    if (!hosts || hosts.length === 0) {
        listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No hosts available</div>';
        return;
    }

    if (selectedHostIndex >= hosts.length) {
        selectedHostIndex = hosts.length - 1;
    }
    if (selectedHostIndex < 0) {
        selectedHostIndex = 0;
    }

    listEl.innerHTML = hosts.map((host, idx) => {
        const isSelected = idx === selectedHostIndex;
        const isAutoConnect = host.autoConnect || false;
        const displayText = `${host.name} - ${host.url}`;
        const highlightedName = highlightMatchesHost(host.name, hostSearchQuery);
        const highlightedUrl = highlightMatchesHost(host.url, hostSearchQuery);

        return `
            <div class="app-item host-item-dialog" data-index="${idx}" data-url="${escapeHtml(host.url)}" style="cursor: pointer; ${isSelected ? 'background: var(--accent); border-color: var(--accent);' : (isAutoConnect ? 'background: #1a1a2a;' : '')}">
                <div style="flex: 1;">
                    <div style="font-weight: 500; color: var(--text-primary);">
                        ${highlightedName}
                        ${host.isLocal ? '<span style="color: #0066FF; font-size: 0.8em; margin-left: 10px;">[LOCAL]</span>' : ''}
                        ${isAutoConnect ? '<span style="color: #0066FF; font-size: 0.8em; margin-left: 10px;">[AUTO]</span>' : ''}
                    </div>
                    <div style="font-size: 0.75em; color: var(--text-secondary); margin-top: 2px;">${highlightedUrl}</div>
                </div>
                <button class="host-auto-btn" data-index="${idx}" data-is-local="${host.isLocal}" style="background: ${isAutoConnect ? 'var(--accent)' : 'var(--bg-tertiary)'}; color: white; border: 1px solid ${isAutoConnect ? 'var(--accent)' : 'var(--border)'}; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.75em; margin-right: 8px;">Auto</button>
                ${!host.isLocal ? `<button class="host-remove-btn" data-index="${idx}" style="background: var(--bg-tertiary); color: white; border: 1px solid var(--border); padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.75em;">Remove</button>` : ''}
            </div>
        `;
    }).join('');

    // Add click handlers for hosts
    listEl.querySelectorAll('.host-item-dialog').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('host-auto-btn') || e.target.classList.contains('host-remove-btn')) {
                return;
            }
            const url = item.dataset.url;
            connectToHost(url);
        });
    });

    // Add click handlers for auto buttons
    listEl.querySelectorAll('.host-auto-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index);
            const isLocal = btn.dataset.isLocal === 'true';

            if (isLocal) {
                toggleLocalAutoConnect();
            } else {
                toggleHostAutoConnectByIndex(idx);
            }
        });
    });

    // Add click handlers for remove buttons
    listEl.querySelectorAll('.host-remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index);
            removeHostByIndex(idx);
        });
    });

    const selectedItem = listEl.querySelector(`[data-index="${selectedHostIndex}"]`);
    if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function performHostSearch(query) {
    hostSearchQuery = query;
    const queryDisplay = document.getElementById('host-search-query');
    if (queryDisplay) {
        queryDisplay.textContent = query ? `"${query}"` : '';
    }

    if (!query) {
        selectedHostIndex = 0;
        renderHosts(hostsCache);
        return;
    }

    const results = hostsCache.map((host, idx) => {
        const nameMatch = fuzzyMatchHost(query, host.name);
        const urlMatch = fuzzyMatchHost(query, host.url);
        const bestScore = Math.max(nameMatch.score, urlMatch.score);

        return {
            host,
            match: nameMatch.match || urlMatch.match,
            score: bestScore
        };
    }).filter(r => r.match)
      .sort((a, b) => b.score - a.score)
      .map(r => r.host);

    selectedHostIndex = 0;
    renderHosts(results);
}

async function loadHostsDialog() {
    const currentServer = `${window.location.protocol}//${window.location.host}`;
    const savedHosts = JSON.parse(localStorage.getItem('wmux_hosts') || '[]');
    const autoConnectHost = localStorage.getItem('wmux_auto_connect_host');

    // Check if current server has backend
    let hasBackend = false;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000);
        const response = await fetch('/api/config', {
            method: 'HEAD',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        hasBackend = response.ok;
    } catch (err) {
        hasBackend = false;
    }

    // Sync autoConnect property on saved hosts
    const syncedSavedHosts = savedHosts.map(h => ({
        ...h,
        isLocal: false,
        autoConnect: autoConnectHost === h.url
    }));

    // Only include "This Server" if backend exists
    hostsCache = hasBackend ? [
        {
            name: 'This Server',
            url: currentServer,
            isLocal: true,
            autoConnect: autoConnectHost === currentServer
        },
        ...syncedSavedHosts
    ] : syncedSavedHosts;

    hostSearchQuery = '';
    selectedHostIndex = 0;
    renderHosts(hostsCache);
}

function toggleHostAutoConnectByIndex(idx) {
    const realIdx = idx - 1; // Subtract 1 because "This Server" is first
    const savedHosts = JSON.parse(localStorage.getItem('wmux_hosts') || '[]');

    if (realIdx >= 0 && realIdx < savedHosts.length) {
        // Clear all auto-connect flags
        savedHosts.forEach(h => h.autoConnect = false);
        // Set this one
        savedHosts[realIdx].autoConnect = true;
        localStorage.setItem('wmux_hosts', JSON.stringify(savedHosts));
        localStorage.setItem('wmux_auto_connect_host', savedHosts[realIdx].url);
    }

    loadHostsDialog();
}

function toggleHostAutoConnect(idx) {
    // For saved hosts in host selector (not dialog)
    const savedHosts = JSON.parse(localStorage.getItem('wmux_hosts') || '[]');

    if (idx >= 0 && idx < savedHosts.length) {
        const isCurrentlyAuto = savedHosts[idx].autoConnect || false;

        if (isCurrentlyAuto) {
            // Turn off auto-connect
            savedHosts[idx].autoConnect = false;
            localStorage.removeItem('wmux_auto_connect_host');
        } else {
            // Turn on auto-connect for this host
            savedHosts.forEach(h => h.autoConnect = false);
            savedHosts[idx].autoConnect = true;
            localStorage.setItem('wmux_auto_connect_host', savedHosts[idx].url);
        }
        localStorage.setItem('wmux_hosts', JSON.stringify(savedHosts));
    }

    loadSavedHosts();
}

function toggleAutoConnect(serverUrl) {
    // For "This Server" in host selector
    const currentServer = `${window.location.protocol}//${window.location.host}`;
    const autoConnectHost = localStorage.getItem('wmux_auto_connect_host');

    if (autoConnectHost === serverUrl) {
        // Remove auto-connect
        localStorage.removeItem('wmux_auto_connect_host');
    } else {
        // Set auto-connect to this server
        const savedHosts = JSON.parse(localStorage.getItem('wmux_hosts') || '[]');
        savedHosts.forEach(h => h.autoConnect = false);
        localStorage.setItem('wmux_hosts', JSON.stringify(savedHosts));
        localStorage.setItem('wmux_auto_connect_host', serverUrl);
    }

    loadSavedHosts();
}

function toggleLocalAutoConnect() {
    const currentServer = `${window.location.protocol}//${window.location.host}`;
    const autoConnectHost = localStorage.getItem('wmux_auto_connect_host');

    if (autoConnectHost === currentServer) {
        // Remove auto-connect
        localStorage.removeItem('wmux_auto_connect_host');
    } else {
        // Set auto-connect to local
        const savedHosts = JSON.parse(localStorage.getItem('wmux_hosts') || '[]');
        savedHosts.forEach(h => h.autoConnect = false);
        localStorage.setItem('wmux_hosts', JSON.stringify(savedHosts));
        localStorage.setItem('wmux_auto_connect_host', currentServer);
    }

    loadHostsDialog();
}

function removeHostByIndex(idx) {
    const realIdx = idx - 1;
    const savedHosts = JSON.parse(localStorage.getItem('wmux_hosts') || '[]');

    if (realIdx >= 0 && realIdx < savedHosts.length) {
        savedHosts.splice(realIdx, 1);
        localStorage.setItem('wmux_hosts', JSON.stringify(savedHosts));
    }

    loadHostsDialog();
}

function removeHost(idx) {
    // For saved hosts in host selector (not dialog)
    const savedHosts = JSON.parse(localStorage.getItem('wmux_hosts') || '[]');

    if (idx >= 0 && idx < savedHosts.length) {
        const removedHost = savedHosts[idx];
        savedHosts.splice(idx, 1);
        localStorage.setItem('wmux_hosts', JSON.stringify(savedHosts));

        // If this was the auto-connect host, remove auto-connect
        const autoConnectHost = localStorage.getItem('wmux_auto_connect_host');
        if (autoConnectHost === removedHost.url) {
            localStorage.removeItem('wmux_auto_connect_host');
        }
    }

    loadSavedHosts();
}

function connectToHost(url) {
    const currentServer = `${window.location.protocol}//${window.location.host}`;

    // Close hosts dialog
    const hostsDialog = document.getElementById('hosts-dialog');
    const hostsOverlay = document.getElementById('hosts-overlay');
    if (hostsDialog && hostsOverlay) {
        hostsDialog.classList.remove('active');
        hostsOverlay.classList.remove('active');
        hostSearchQuery = '';
        selectedHostIndex = 0;
    }

    // app.js is loaded before spa-router.js, so window.connectToBackend should exist
    if (typeof window.connectToBackend === 'function') {
        if (url === currentServer) {
            // Connect to current server (no host parameter)
            window.connectToBackend();
        } else {
            // Connect to remote host
            window.connectToBackend(url);
        }
    } else {
        console.error('connectToBackend not available!');
    }
}

// Make functions globally available
window.loadHostsDialog = loadHostsDialog;
window.connectToHost = connectToHost;
window.toggleLocalAutoConnect = toggleLocalAutoConnect;
window.toggleHostAutoConnectByIndex = toggleHostAutoConnectByIndex;
window.toggleHostAutoConnect = toggleHostAutoConnect;
window.toggleAutoConnect = toggleAutoConnect;
window.removeHostByIndex = removeHostByIndex;
window.removeHost = removeHost;

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
