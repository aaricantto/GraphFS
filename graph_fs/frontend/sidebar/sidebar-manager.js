// sidebar/sidebar-manager.js - Orchestrates sidebar tabs and panels
import { EventsPanel } from './events-panel.js';
import { RootsPanel } from './roots-panel.js';
import { FilesPanel } from './files-panel.js';

class SidebarManager {
    constructor() {
        this.panels = new Map();
        this.activePanel = 'events';
        this.tabs = null;
        this.content = null;
    }

    initialize() {
        this.tabs = document.querySelectorAll('.sidebar-tab');
        this.content = document.getElementById('sidebar-content');

        // Initialize all panels
        this.panels.set('events', new EventsPanel());
        this.panels.set('roots', new RootsPanel());
        this.panels.set('files', new FilesPanel());

        this.panels.forEach((panel) => panel.initialize());

        // Setup tab switching
        this.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const panelName = tab.dataset.panel;
                this.switchPanel(panelName);
            });
        });

        // Show initial panel
        this.switchPanel('events');
    }

    switchPanel(panelName) {
        if (this.activePanel === panelName) return;

        // Update tabs
        this.tabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.panel === panelName);
        });

        // Update panels
        document.querySelectorAll('.sidebar-panel').forEach(panel => {
            panel.classList.remove('active');
        });

        const targetPanel = document.getElementById(`${panelName}-panel`);
        if (targetPanel) {
            targetPanel.classList.add('active');
        }

        this.activePanel = panelName;

        // Notify panel it became active (for any refresh logic)
        const panel = this.panels.get(panelName);
        if (panel && panel.onActivate) {
            panel.onActivate();
        }
    }

    getPanel(name) {
        return this.panels.get(name);
    }
}

// Global instance
const sidebarManager = new SidebarManager();

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    sidebarManager.initialize();
});

// Export for other modules
window.sidebarManager = sidebarManager;
export { sidebarManager };