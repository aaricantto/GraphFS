// sidebar/roots-panel.js - Active + Favourite roots management (no hide/show)
export class RootsPanel {
    constructor() {
        this.rootsListEl = null;
        this.clearBtn = null;

        // Active roots (from runtime fs model)
        this.actives = new Map(); // path -> { path, name }

        // Favourites (persisted; may or may not be active)
        this.favourites = new Map(); // path -> { path, name, favorite:true }
    }

    initialize() {
        this.rootsListEl = document.getElementById('roots-list');
        this.clearBtn = document.getElementById('clear-all-roots');

        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', () => this.clearAll());
        }

        // From nodes.js when a root is added/removed at runtime
        document.addEventListener('graphfs:root_added', (e) => {
            const { root, name } = e.detail || {};
            this.actives.set(root, { path: root, name: name || this.basename(root) });
            this.render();
        });
        document.addEventListener('graphfs:root_removed', (e) => {
            const { root } = e.detail || {};
            this.actives.delete(root);
            this.render();
        });

        // Full app state snapshot (on connect and whenever it changes)
        document.addEventListener('graphfs:app_state', (e) => {
            const st = e.detail || {};
            // Replace favourites map
            this.favourites.clear();
            (st.favorites || []).forEach(r => {
                this.favourites.set(r.path, { path: r.path, name: r.name || this.basename(r.path), favorite: true });
            });

            // Replace actives from state (server restores at boot)
            this.actives.clear();
            (st.actives || []).forEach(r => {
                this.actives.set(r.path, { path: r.path, name: r.name || this.basename(r.path) });
            });

            this.render();
        });

        // Favourite toggled event (single item)
        document.addEventListener('graphfs:favorite_toggled', (e) => {
            const { path, favorite } = e.detail || {};
            if (!path) return;
            if (favorite) {
                const name = this.basename(path);
                this.favourites.set(path, { path, name, favorite: true });
            } else {
                this.favourites.delete(path);
            }
            this.render();
        });

        // Ask server for initial snapshot in case connect arrived before panel
        if (window.requestAppState) window.requestAppState();

        this.render();
    }

    // --- UI actions ---
    addRoot(path) {
        if (window.addRoot) window.addRoot(path, window.getExcludes?.() || []);
    }

    removeRoot(path) {
        if (window.removeRoot) window.removeRoot(path);
    }

    toggleFavourite(path) {
        if (window.toggleFavoriteRoot) window.toggleFavoriteRoot(path);
    }

    clearAll() {
        // Deactivate all currently active roots
        const rootPaths = Array.from(this.actives.keys());
        if (!rootPaths.length) return;
        rootPaths.forEach(p => this.removeRoot(p));
        // Favourites are not touched by Clear All.
    }

    // --- render ---
    render() {
        if (!this.rootsListEl) return;

        const activeArray = Array.from(this.actives.values())
            .sort((a,b) => a.name.localeCompare(b.name));

        const favArray = Array.from(this.favourites.values())
            .sort((a,b) => a.name.localeCompare(b.name));

        const favSection = `
            <div class="roots-header">
                <h3>Favourite Roots</h3>
            </div>
            <div class="fav-list">
                ${favArray.length ? favArray.map(f => this.favItemHtml(f)).join("") :
                `<p class="placeholder">Star a root to keep it here for quick access.</p>`}
            </div>
            <hr/>
        `;

        const activeSection = `
            <div class="roots-header">
                <h3>Active Roots</h3>
                <button id="clear-all-roots" class="small-btn" title="Deactivate all">Clear All</button>
            </div>
            <div class="active-list">
                ${activeArray.length ? activeArray.map(r => this.activeItemHtml(r)).join("") :
                `<p class="placeholder">No active roots. Use "Add Root" above or click ➕ on a favourite.</p>`}
            </div>
        `;

        this.rootsListEl.innerHTML = favSection + activeSection;

        // wire buttons
        this.rootsListEl.querySelectorAll('.fav-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const path = e.currentTarget.dataset.path;
                this.toggleFavourite(path);
            });
        });
        this.rootsListEl.querySelectorAll('.fav-activate').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const path = e.currentTarget.dataset.path;
                this.addRoot(path);
            });
        });
        this.rootsListEl.querySelectorAll('.active-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const path = e.currentTarget.dataset.path;
                this.removeRoot(path);
            });
        });
        this.rootsListEl.querySelectorAll('.active-fav-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const path = e.currentTarget.dataset.path;
                this.toggleFavourite(path);
            });
        });

        // re-bind clear all
        const clearBtn = document.getElementById('clear-all-roots');
        if (clearBtn) clearBtn.addEventListener('click', () => this.clearAll());
    }

    favItemHtml(f) {
        const isActive = this.actives.has(f.path);
        return `
            <div class="root-item ${isActive ? 'active' : ''}">
                <div class="root-info">
                    <div class="root-name">${f.name}</div>
                    <div class="root-path" title="${f.path}">${this.truncatePath(f.path)}</div>
                </div>
                <div class="root-actions">
                    <button class="icon-btn fav-toggle" data-path="${f.path}" title="Unfavourite">★</button>
                    <button class="icon-btn fav-activate" data-path="${f.path}" title="${isActive ? 'Already active' : 'Activate'}" ${isActive ? 'disabled' : ''}>➕</button>
                </div>
            </div>
        `;
    }

    activeItemHtml(r) {
        const fav = this.favourites.has(r.path);
        return `
            <div class="root-item">
                <div class="root-info">
                    <div class="root-name">${r.name}</div>
                    <div class="root-path" title="${r.path}">${this.truncatePath(r.path)}</div>
                </div>
                <div class="root-actions">
                    <button class="icon-btn active-fav-toggle" data-path="${r.path}" title="${fav ? 'Unfavourite' : 'Mark as favourite'}">${fav ? '★' : '☆'}</button>
                    <button class="icon-btn active-remove" data-path="${r.path}" title="Deactivate">×</button>
                </div>
            </div>
        `;
    }

    basename(p) {
        const parts = (p || "").split(/[/\\]/).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : p;
    }

    truncatePath(path, maxLen = 60) {
        if (path.length <= maxLen) return path;
        const parts = path.split(/[/\\]/);
        if (parts.length <= 3) return path;
        const first = parts[0] || '/';
        const last = parts.slice(-2).join('/');
        return `${first}/.../${last}`;
    }

    onActivate() {
        this.render();
    }
}
