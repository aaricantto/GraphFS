// header-manager.js - Header controls, theme management, and root/excludes handling

export class HeaderManager {
    constructor() {
        this.rootInput = null;
        this.setRootBtn = null;
        this.excludesInput = null;
        this.saveExcludesBtn = null;
        this.themeBtn = null;
        this.enableWatchBtn = null;
        this.disableWatchBtn = null;
    }

    initialize() {
        console.log('HeaderManager: initialize');
        
        // Get DOM elements
        this.rootInput = document.getElementById('root-input');
        this.setRootBtn = document.getElementById('set-root-btn');
        this.excludesInput = document.getElementById('excludes-input');
        this.saveExcludesBtn = document.getElementById('save-excludes-btn');
        this.themeBtn = document.getElementById('toggle-theme-btn');
        this.enableWatchBtn = document.getElementById('enable-watch-btn');
        this.disableWatchBtn = document.getElementById('disable-watch-btn');

        // Setup event listeners
        this.setupEventListeners();
        
        // Initialize state
        this.loadExcludes();
        this.initializeTheme();
        
        // Make clear function globally available
        window.clearRootInput = () => this.clearRootInput();
    }

    setupEventListeners() {
        // Add Root button
        this.setRootBtn.addEventListener('click', () => this.handleAddRoot());

        // Save Excludes button
        this.saveExcludesBtn.addEventListener('click', () => this.handleSaveExcludes());

        // Theme toggle button
        this.themeBtn.addEventListener('click', () => this.toggleTheme());

        // Watch buttons
        this.enableWatchBtn.addEventListener('click', () => this.handleEnableWatch());
        this.disableWatchBtn.addEventListener('click', () => this.handleDisableWatch());

        // Listen for root_added event to clear input
        document.addEventListener('graphfs:root_added', () => this.clearRootInput());
    }

    // -------------------- Root Management --------------------

    handleAddRoot() {
        const path = this.rootInput.value.trim();
        if (path) {
            const excludes = this.getExcludes();
            if (window.logEvent) {
                window.logEvent(`[ui] add_root → ${path} (excludes=${excludes.join('|')})`);
            }
            window.addRoot(path, excludes);
        }
    }

    clearRootInput() {
        if (this.rootInput) {
            this.rootInput.value = '';
        }
    }

    // -------------------- Excludes Management --------------------

    loadExcludes() {
        const raw = localStorage.getItem('graphfs.excludes') ||
                    'venv,__pycache__,*.pyc,.git,node_modules';
        this.excludesInput.value = raw;
    }

    getExcludes() {
        return this.excludesInput.value
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
    }

    handleSaveExcludes() {
        localStorage.setItem('graphfs.excludes', this.excludesInput.value);
        if (window.setExcludes) {
            window.setExcludes(this.getExcludes());
        }
        if (window.logEvent) {
            window.logEvent('[ui] excludes saved');
        }
    }

    // -------------------- Watch Management --------------------

    handleEnableWatch() {
        const path = this.rootInput.value.trim();
        // If empty, enable watch on all roots
        if (window.enableWatch) {
            window.enableWatch(path || null);
        }
    }

    handleDisableWatch() {
        const path = this.rootInput.value.trim();
        if (window.disableWatch) {
            window.disableWatch(path || null);
        }
    }

    // -------------------- Theme Management --------------------

    initializeTheme() {
        // Determine initial theme
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        const userTheme = localStorage.getItem('theme');
        this.applyTheme(userTheme || systemTheme);

        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)')
            .addEventListener('change', (e) => {
                // Only apply system theme if user hasn't set a preference
                if (!localStorage.getItem('theme')) {
                    this.applyTheme(e.matches ? 'dark' : 'light');
                }
            });
    }

    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', next);
        this.applyTheme(next);
    }

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        
        // Notify other modules about theme change
        if (window.updateColorVariables) {
            window.updateColorVariables(theme);
        }
    }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const headerManager = new HeaderManager();
        headerManager.initialize();
    });
} else {
    const headerManager = new HeaderManager();
    headerManager.initialize();
}