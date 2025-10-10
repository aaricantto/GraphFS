// sidebar/events-panel.js - Events log panel (extracted from)

export class EventsPanel {
    constructor() {
        this.eventLogEl = null;
        this.maxEvents = 500; // limit to prevent memory issues
    }

    initialize() {
        this.eventLogEl = document.getElementById('events');
        
        // Expose global logEvent function for backward compatibility
        window.logEvent = (msg) => this.logEvent(msg);
    }

    logEvent(msg) {
        if (!this.eventLogEl) return;
        
        const timestamp = new Date().toLocaleTimeString();
        const line = `[${timestamp}] ${msg}\n`;
        
        this.eventLogEl.textContent = line + this.eventLogEl.textContent;
        
        // Trim old events
        const lines = this.eventLogEl.textContent.split('\n');
        if (lines.length > this.maxEvents) {
            this.eventLogEl.textContent = lines.slice(0, this.maxEvents).join('\n');
        }
    }

    clear() {
        if (this.eventLogEl) {
            this.eventLogEl.textContent = '';
        }
    }

    onActivate() {
        // Could add auto-scroll to bottom or other refresh logic
    }
}