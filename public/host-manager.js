// Host management
const STORAGE_KEY = 'wmux_hosts';

class HostManager {
    constructor() {
        this.hosts = this.loadHosts();
        this.currentServer = this.getCurrentServer();
        this.render();
        this.setupEventListeners();
        this.checkAutoConnect();
        this.discoverHosts();
    }

    getCurrentServer() {
        // Get the current server URL (the one hosting this interface)
        const protocol = window.location.protocol;
        const host = window.location.host;
        return `${protocol}//${host}`;
    }

    loadHosts() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Failed to load hosts:', e);
            return [];
        }
    }

    saveHosts() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.hosts));
        } catch (e) {
            console.error('Failed to save hosts:', e);
        }
    }

    addHost(name, url, autoConnect = false, autoSession = '') {
        // Clear auto-connect from other hosts if this one is auto-connect
        if (autoConnect) {
            this.hosts.forEach(h => h.autoConnect = false);
        }

        const host = {
            id: Date.now().toString(),
            name,
            url,
            autoConnect,
            autoSession: autoSession || ''
        };

        this.hosts.push(host);
        this.saveHosts();
        this.render();
    }

    removeHost(id) {
        this.hosts = this.hosts.filter(h => h.id !== id);
        this.saveHosts();
        this.render();
    }

    toggleAutoConnect(id) {
        // Clear all auto-connect flags
        this.hosts.forEach(h => h.autoConnect = false);

        // Set the selected one
        const host = this.hosts.find(h => h.id === id);
        if (host) {
            host.autoConnect = true;
            this.saveHosts();
            this.render();
        }
    }

    connectToHost(url, autoSession = '') {
        // Store the target host URL and auto-session preference
        sessionStorage.setItem('wmux_target_host', url);
        if (autoSession) {
            sessionStorage.setItem('wmux_auto_session', autoSession);
        } else {
            sessionStorage.removeItem('wmux_auto_session');
        }
        window.location.href = '/connect.html';
    }

    checkAutoConnect() {
        const autoConnectHost = this.hosts.find(h => h.autoConnect);
        if (autoConnectHost) {
            // Auto-connect after a short delay
            setTimeout(() => {
                this.connectToHost(autoConnectHost.url);
            }, 1000);
        }
    }

    async discoverHosts() {
        try {
            const response = await fetch('/api/discover');
            if (!response.ok) return;

            const discovered = await response.json();
            if (discovered && discovered.length > 0) {
                this.renderDiscovered(discovered);
            }
        } catch (e) {
            // Discovery not available (--expose-hosts not enabled)
            console.log('Host discovery not available');
        }
    }

    renderDiscovered(hosts) {
        const section = document.getElementById('discovered-hosts');
        const list = document.getElementById('discovered-list');

        if (!hosts || hosts.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        list.innerHTML = hosts.map(host => `
            <div class="host-item">
                <div class="host-info">
                    <div class="host-name">${this.escapeHtml(host.name)}</div>
                    <div class="host-url">${this.escapeHtml(host.url)}</div>
                    <div style="font-size: 0.8em; color: #888; margin-top: 5px;">
                        Discovered via ${host.type}
                    </div>
                </div>
                <div class="host-actions">
                    <button class="host-btn primary" onclick="hostManager.connectToHost('${this.escapeHtml(host.url)}')">
                        Connect
                    </button>
                    <button class="host-btn" onclick="hostManager.addDiscoveredHost('${this.escapeHtml(host.name)}', '${this.escapeHtml(host.url)}')">
                        Add to List
                    </button>
                </div>
            </div>
        `).join('');
    }

    addDiscoveredHost(name, url) {
        // Check if already exists
        if (this.hosts.find(h => h.url === url)) {
            alert('This host is already in your list');
            return;
        }

        this.addHost(name, url, false, '');
        alert('Host added to your list');
    }

    render() {
        const container = document.getElementById('manual-hosts');

        let html = '';

        // Add current server as first option
        html += `
            <div class="host-item" style="border-color: var(--accent-blue);">
                <div class="host-info">
                    <div class="host-name">
                        This Server
                        <span style="color: var(--accent-blue); font-size: 0.8em; margin-left: 10px;">[LOCAL]</span>
                    </div>
                    <div class="host-url">${this.escapeHtml(this.currentServer)}</div>
                </div>
                <div class="host-actions">
                    <button class="host-btn primary" onclick="hostManager.connectToHost('${this.escapeHtml(this.currentServer)}')">
                        Connect
                    </button>
                </div>
            </div>
        `;

        if (this.hosts.length === 0) {
            html += `
                <div class="empty-state">
                    <p>No remote hosts configured yet.</p>
                    <p style="font-size: 0.9em; margin-top: 10px;">Click + to add a remote host.</p>
                </div>
            `;
            container.innerHTML = html;
            return;
        }

        html += this.hosts.map(host => `
            <div class="host-item ${host.autoConnect ? 'auto-connect' : ''}">
                <div class="host-info">
                    <div class="host-name">
                        ${this.escapeHtml(host.name)}
                        ${host.autoConnect ? '<span style="color: var(--accent); font-size: 0.8em; margin-left: 10px;">[AUTO-CONNECT]</span>' : ''}
                    </div>
                    <div class="host-url">${this.escapeHtml(host.url)}</div>
                    ${host.autoSession ? `<div style="font-size: 0.8em; color: #888; margin-top: 5px;">→ Session: ${this.escapeHtml(host.autoSession)}</div>` : ''}
                </div>
                <div class="host-actions">
                    <button class="host-btn primary" onclick="hostManager.connectToHost('${this.escapeHtml(host.url)}', '${this.escapeHtml(host.autoSession || '')}')">
                        Connect
                    </button>
                    <button class="host-btn" onclick="hostManager.toggleAutoConnect('${host.id}')">
                        ${host.autoConnect ? 'Disable Auto' : 'Auto-Connect'}
                    </button>
                    <button class="host-btn" onclick="hostManager.removeHost('${host.id}')">
                        Remove
                    </button>
                </div>
            </div>
        `).join('');

        container.innerHTML = html;
    }

    setupEventListeners() {
        // Add host dialog
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

        document.getElementById('add-host-btn').addEventListener('click', () => {
            const name = document.getElementById('host-name').value.trim();
            const url = document.getElementById('host-url').value.trim();
            const autoConnect = document.getElementById('auto-connect').checked;
            const autoSession = document.getElementById('auto-session').value.trim();

            if (!name || !url) {
                alert('Please enter both name and URL');
                return;
            }

            // Basic URL validation
            try {
                new URL(url);
            } catch (e) {
                alert('Please enter a valid URL (e.g., http://100.x.x.x:2022)');
                return;
            }

            this.addHost(name, url, autoConnect, autoSession);

            // Clear form
            document.getElementById('host-name').value = '';
            document.getElementById('host-url').value = '';
            document.getElementById('auto-connect').checked = false;
            document.getElementById('auto-session').value = '';

            // Close dialog
            document.getElementById('add-host-dialog').classList.remove('active');
            document.getElementById('add-host-overlay').classList.remove('active');
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize
const hostManager = new HostManager();
