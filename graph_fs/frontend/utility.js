// utility.js - Header controls and theme management (cleaned up)

document.addEventListener('DOMContentLoaded', () => {
    const rootInput = document.getElementById('root-input');
    const setRootBtn = document.getElementById('set-root-btn');
    const excludesInput = document.getElementById('excludes-input');
    const saveExcludesBtn = document.getElementById('save-excludes-btn');
    const themeBtn = document.getElementById('toggle-theme-btn');
    const enableWatchBtn = document.getElementById('enable-watch-btn');
    const disableWatchBtn = document.getElementById('disable-watch-btn');

    // Load saved excludes
    loadExcludes();

    // Initialize theme
    initializeTheme();

    // Set Root button
    setRootBtn.addEventListener('click', () => {
        const path = rootInput.value.trim();
        if (path) {
            const excludes = getExcludes();
            if (window.logEvent) {
                window.logEvent(`[ui] set_root → ${path} (excludes=${excludes.join('|')})`);
            }
            window.setRoot(path, excludes);
        }
    });

    // Save Excludes button
    saveExcludesBtn.addEventListener('click', () => {
        saveExcludes();
        if (window.logEvent) {
            window.logEvent('[ui] excludes saved');
        }
    });

    // Theme toggle button
    if (themeBtn) {
        themeBtn.addEventListener('click', toggleTheme);
    }

    // Enable Watch button
    if (enableWatchBtn) {
        enableWatchBtn.addEventListener('click', () => {
            const p = rootInput.value.trim();
            window.enableWatch(p || null);
        });
    }

    // Disable Watch button
    if (disableWatchBtn) {
        disableWatchBtn.addEventListener('click', () => {
            const p = rootInput.value.trim();
            window.disableWatch(p || null);
        });
    }
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