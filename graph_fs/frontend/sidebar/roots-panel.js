// sidebar/roots-panel.js - Manage multiple roots (visual only for now)

export class RootsPanel {
    constructor() {
        this.rootsListEl = null;
        this.clearBtn = null;
        this.roots = new Map(); // path -> { path, active, addedAt }
    }

    initialize() {
        this.rootsListEl = document.getElementById('roots-list');
        this.clearBtn = document.getElementById('clear-all-roots');

        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', () => this.clearAll());
        }

        // Listen for root_set events from nodes.js
        const originalOnRootSet = window.onRootSet;
        window.onRootSet = (root) => {
            this.addRoot(root);
            if (originalOnRootSet) originalOnRootSet(root);
        };

        this.render();
    }

    addRoot(path) {
        if (!path) return;
        
        // Mark all existing roots as inactive
        this.roots.forEach(root => {
            root.active = false;
        });

        // Add or update this root
        this.roots.set(path, {
            path,
            active: true,
            addedAt: new Date()
        });

        this.render();
        
        if (window.logEvent) {
            window.logEvent(`[roots] added → ${path}`);
        }
    }

    removeRoot(path) {
        this.roots.delete(path);
        this.render();
        
        if (window.logEvent) {
            window.logEvent(`[roots] removed → ${path}`);
        }
    }

    clearAll() {
        if (this.roots.size === 0) return;
        
        const count = this.roots.size;
        this.roots.clear();
        this.render();
        
        if (window.logEvent) {
            window.logEvent(`[roots] cleared all (${count} roots)`);
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
                    <span class="root-path" title="${root.path}">${this.truncatePath(root.path)}</span>
                    ${root.active ? '<span class="active-badge">ACTIVE</span>' : ''}
                </div>
                <div class="root-actions">
                    <button class="icon-btn remove-root" data-path="${root.path}" title="Remove this root">×</button>
                </div>
            </div>
        `).join('');

        // Attach remove handlers
        this.rootsListEl.querySelectorAll('.remove-root').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const path = e.target.dataset.path;
                this.removeRoot(path);
            });
        });
    }

    truncatePath(path, maxLen = 40) {
        if (path.length <= maxLen) return path;
        const parts = path.split(/[/\\]/);
        if (parts.length <= 2) return path;
        
        // Show first part and last 2 parts
        const first = parts[0] || '/';
        const last = parts.slice(-2).join('/');
        return `${first}/.../${last}`;
    }

    onActivate() {
        // Refresh in case roots changed while panel was hidden
        this.render();
    }
}