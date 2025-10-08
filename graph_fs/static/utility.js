// utility.js - Header controls, theme, and utility functions

let eventLogEl = null;

document.addEventListener('DOMContentLoaded', () => {
    const rootInput = document.getElementById('root-input');
    const setRootBtn = document.getElementById('set-root-btn');
    const rootStatus = document.getElementById('root-status');
    const excludesInput = document.getElementById('excludes-input');
    const saveExcludesBtn = document.getElementById('save-excludes-btn');
    const themeBtn = document.getElementById('toggle-theme-btn');
    
    eventLogEl = document.getElementById('events');
    
    // Load saved excludes
    loadExcludes();
    
    // Initialize theme
    initializeTheme();
    
    // Event listeners
    setRootBtn.addEventListener('click', () => {
        const path = rootInput.value.trim();
        if (path) {
            const excludes = getExcludes();
            window.setRoot(path, excludes);
        }
    });
    
    saveExcludesBtn.addEventListener('click', () => {
        saveExcludes();
        logEvent('Excludes saved: ' + excludesInput.value);
    });
    
    if (themeBtn) {
        themeBtn.addEventListener('click', toggleTheme);
    }
    
    // Listen for root updates
    const originalOnRootSet = window.onRootSet;
    window.onRootSet = (root) => {
        rootStatus.textContent = root;
        if (originalOnRootSet) originalOnRootSet(root);
    };
});

function loadExcludes() {
    const excludesInput = document.getElementById('excludes-input');
    const raw = localStorage.getItem('graphfs.excludes') || 
                'venv,__pycache__,*.pyc,.git,node_modules';
    excludesInput.value = raw;
}

function getExcludes() {
    const excludesInput = document.getElementById('excludes-input');
    return excludesInput.value.split(',').map(s => s.trim()).filter(Boolean);
}

function saveExcludes() {
    const excludesInput = document.getElementById('excludes-input');
    localStorage.setItem('graphfs.excludes', excludesInput.value);
    window.setExcludes(getExcludes());
}

function initializeTheme() {
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const userTheme = localStorage.getItem('theme');
    applyTheme(userTheme || systemTheme);
    
    window.matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', (e) => {
            if (!localStorage.getItem('theme')) {
                applyTheme(e.matches ? 'dark' : 'light');
            }
        });
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (window.updateColorVariables) {
        window.updateColorVariables(theme);
    }
}

function logEvent(msg) {
    if (eventLogEl) {
        const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
        eventLogEl.textContent = line + eventLogEl.textContent;
    }
}

// Export for use by nodes.js
window.logEvent = logEvent;