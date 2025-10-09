// sidebar/roots-panel.js - Multi-root management panel with actual backend integration

export class RootsPanel {
    constructor() {
        this.rootsListEl = null;
        this.clearBtn = null;
        this.roots = new Map(); // path -> { path, name, active, addedAt }
    }

    initialize() {
        this.rootsListEl = document.getElementById('roots-list');
        this.clearBtn = document.getElementById('clear-all-roots');

        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', () => this.clearAll());
        }

        // Listen for root_added events from nodes.js
        document.addEventListener('graphfs:root_added', (e) => {
            this.addRoot(e.detail.root, e.detail.name);
        });

        // Listen for root_removed events
        document.addEventListener('graphfs:root_removed', (e) => {
            this.removeRootFromUI(e.detail.root);
        });

        // Legacy support
        const originalOnRootSet = window.onRootSet;
        window.onRootSet = (root) => {
            // This will be triggered by the custom event above
            if (originalOnRootSet) originalOnRootSet(root);
        };

        this.render();
    }

    addRoot(path, name) {
        if (!path) return;
        
        // Mark all existing roots as inactive
        this.roots.forEach(root => {
            root.active = false;
        });

        // Add or update this root
        const rootName = name || path.split(/[/\\]/).filter(Boolean).pop();
        this.roots.set(path, {
            path,
            name: rootName,
            active: true,
            addedAt: new Date()
        });

        this.render();
        
        if (window.logEvent) {
            window.logEvent(`[roots] added → ${path}`);
        }
    }

    removeRoot(path) {
        if (!path) return;

        // Call backend to remove root
        if (window.removeRoot) {
            window.removeRoot(path);
        }
    }

    removeRootFromUI(path) {
        this.roots.delete(path);
        this.render();
        
        if (window.logEvent) {
            window.logEvent(`[roots] removed → ${path}`);
        }
    }

    clearAll() {
        if (this.roots.size === 0) return;
        
        const count = this.roots.size;
        
        // Remove all roots from backend
        const rootPaths = Array.from(this.roots.keys());
        rootPaths.forEach(path => {
            if (window.removeRoot) {
                window.removeRoot(path);
            }
        });

        // UI will update via events
        if (window.logEvent) {
            window.logEvent(`[roots] clearing all (${count} roots)`);
        }
    }

    render() {
        if (!this.rootsListEl) return;

        if (this.roots.size === 0) {
            this.rootsListEl.innerHTML = '<p class="placeholder">No roots set. Use "Set Root" above to add one.</p>';
            return;
        }

        const rootsArray = Array.from(this.roots.values()).reverse(); // newest first
        
        this.rootsListEl.innerHTML = rootsArray.map(root => `
            <div class="root-item ${root.active ? 'active' : ''}">
                <div class="root-info">
                    <div class="root-name">${root.name}</div>
                    <div class="root-path" title="${root.path}">${this.truncatePath(root.path)}</div>
                    ${root.active ? '<span class="active-badge">ACTIVE</span>' : ''}
                </div>
                <div class="root-actions">
                    <button class="icon-btn watch-btn" data-path="${root.path}" title="Enable watch on this root">👁</button>
                    <button class="icon-btn remove-root" data-path="${root.path}" title="Remove this root">×</button>
                </div>
            </div>
        `).join('');

        // Attach handlers
        this.rootsListEl.querySelectorAll('.remove-root').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const path = e.target.dataset.path;
                this.removeRoot(path);
            });
        });

        this.rootsListEl.querySelectorAll('.watch-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const path = e.target.dataset.path;
                if (window.enableWatch) {
                    window.enableWatch(path);
                    if (window.logEvent) {
                        window.logEvent(`[roots] watch enabled → ${path}`);
                    }
                }
            });
        });
    }

    truncatePath(path, maxLen = 50) {
        if (path.length <= maxLen) return path;
        const parts = path.split(/[/\\]/);
        if (parts.length <= 2) return path;
        
        // Show first part and last 2 parts
        const first = parts[0] || '/';
        const last = parts.slice(-2).join('/');
        return `${first}/.../${last}`;
    }

    onActivate() {
        // Refresh when panel becomes visible
        this.render();
    }
}