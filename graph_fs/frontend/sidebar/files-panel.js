// sidebar/files-panel.js - Selected files panel (with relative display paths)

export class FilesPanel {
    constructor() {
        this.filesContentEl = null;
        this.countBadge = null;
        this.selectedFiles = new Set();
    }

    initialize() {
        this.filesContentEl = document.getElementById('files-content');
        this.countBadge = document.getElementById('selected-count');

        // Hook into nodes.js selection changes (if available)
        // For now, just monitor window.selectedFiles if it exists
        this.startMonitoring();
    }

    startMonitoring() {
        // Poll for changes to window.selectedFiles (from nodes.js)
        setInterval(() => {
            if (window.selectedFiles) {
                const currentSize = window.selectedFiles.size;
                if (currentSize !== this.selectedFiles.size) {
                    this.selectedFiles = new Set(window.selectedFiles);
                    this.render();
                }
            }
        }, 500);
    }

    render() {
        if (!this.filesContentEl) return;

        // Update count badge
        if (this.countBadge) {
            this.countBadge.textContent = this.selectedFiles.size;
        }

        if (this.selectedFiles.size === 0) {
            this.filesContentEl.innerHTML = '<p class="placeholder">Select files in the graph to preview them here.</p>';
            return;
        }

        // List selected files (relative display path; absolute kept in tooltip)
        const filesList = Array.from(this.selectedFiles).map(path => {
            const name = path.split(/[/\\]/).pop();
            const displayPath = (typeof window.toDisplayPath === 'function') ? window.toDisplayPath(path) : path;
            return `
                <div class="file-item">
                    <div class="file-icon">📄</div>
                    <div class="file-info">
                        <div class="file-name">${name}</div>
                        <div class="file-path" title="${path}">${displayPath}</div>
                    </div>
                </div>
            `;
        }).join('');

        this.filesContentEl.innerHTML = `
            <div class="files-list">
                ${filesList}
            </div>
            <div class="files-actions">
                <button id="copy-paths-btn" class="action-btn">📋 Copy Paths</button>
                <button id="preview-files-btn" class="action-btn" disabled title="Coming soon">👁 Preview Files</button>
            </div>
        `;

        // Attach handlers
        const copyBtn = document.getElementById('copy-paths-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => this.copyPaths());
        }
    }

    copyPaths() {
        const paths = Array.from(this.selectedFiles).join('\n');
        navigator.clipboard.writeText(paths).then(() => {
            if (window.logEvent) {
                window.logEvent(`[files] copied ${this.selectedFiles.size} file paths to clipboard`);
            }
            alert(`Copied ${this.selectedFiles.size} file paths to clipboard!`);
        }).catch(err => {
            console.error('Failed to copy:', err);
            alert('Failed to copy to clipboard');
        });
    }

    onActivate() {
        // Refresh when panel becomes visible
        this.render();
    }
}
