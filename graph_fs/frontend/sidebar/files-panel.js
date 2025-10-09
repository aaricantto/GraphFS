// sidebar/files-panel.js - Enhanced with ordering and script copying

export class FilesPanel {
    constructor() {
        this.filesContentEl = null;
        this.countBadge = null;
        this.selectedFiles = []; // Now an ordered array instead of Set
        this.draggedIndex = null;
        
        // File extensions we can copy as text
        this.textExtensions = new Set([
            '.js', '.py', '.txt', '.md', '.json', '.html', '.css', '.jsx', '.ts', '.tsx',
            '.yaml', '.yml', '.xml', '.sh', '.bash', '.sql', '.java', '.c', '.cpp', '.h',
            '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.cs', '.r', '.scala', '.lua'
        ]);
    }

    initialize() {
        this.filesContentEl = document.getElementById('files-content');
        this.countBadge = document.getElementById('selected-count');

        // Monitor selection changes from nodes.js
        this.startMonitoring();
        
        // Expose API for nodes.js to update selections
        window.updateFilesPanel = (filesSet) => {
            this.syncFromGraph(filesSet);
        };
    }

    startMonitoring() {
        // Poll for changes to window.selectedFiles (from nodes.js)
        setInterval(() => {
            if (window.selectedFiles) {
                const graphFiles = Array.from(window.selectedFiles);
                
                // Add new files to end of ordered list
                graphFiles.forEach(path => {
                    if (!this.selectedFiles.includes(path)) {
                        this.selectedFiles.push(path);
                    }
                });
                
                // Remove files that were deselected in graph
                this.selectedFiles = this.selectedFiles.filter(path => 
                    window.selectedFiles.has(path)
                );
                
                this.render();
            }
        }, 300);
    }

    syncFromGraph(filesSet) {
        const graphFiles = Array.from(filesSet);
        
        // Preserve order for existing files, add new ones to end
        const newFiles = graphFiles.filter(f => !this.selectedFiles.includes(f));
        this.selectedFiles = [
            ...this.selectedFiles.filter(f => filesSet.has(f)),
            ...newFiles
        ];
        
        this.render();
    }

    removeFile(path) {
        this.selectedFiles = this.selectedFiles.filter(p => p !== path);
        
        // Emit custom event to deselect the node in the graph
        document.dispatchEvent(new CustomEvent('graphfs:deselect_file', { 
            detail: { path } 
        }));
        
        this.render();
        
        if (window.logEvent) {
            window.logEvent(`[files] removed "${this.basename(path)}" from selection`);
        }
    }

    moveFile(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;
        
        const [movedFile] = this.selectedFiles.splice(fromIndex, 1);
        this.selectedFiles.splice(toIndex, 0, movedFile);
        
        this.render();
    }

    isTextFile(path) {
        const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
        return this.textExtensions.has(ext);
    }

    async copyScripts() {
        const textFiles = this.selectedFiles.filter(path => this.isTextFile(path));
        
        if (textFiles.length === 0) {
            alert('No text files selected. Select .py, .js, .txt, etc.');
            return;
        }

        try {
            // Request file contents from server
            const response = await fetch('/api/read_files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: textFiles })
            });

            if (!response.ok) {
                throw new Error('Failed to read files from server');
            }

            const data = await response.json();
            
            // Format as numbered scripts
            let output = '';
            data.files.forEach((fileData, idx) => {
                const relativePath = window.toDisplayPath 
                    ? window.toDisplayPath(fileData.path) 
                    : this.basename(fileData.path);
                
                output += `SCRIPT ${idx + 1}: ${relativePath}\n\n`;
                output += fileData.content;
                output += '\n\n\n\n';
            });

            await navigator.clipboard.writeText(output);
            
            this.showSuccessMessage(`Copied ${textFiles.length} script${textFiles.length > 1 ? 's' : ''}!`);
            
            if (window.logEvent) {
                window.logEvent(`[files] copied ${textFiles.length} scripts to clipboard`);
            }
        } catch (err) {
            console.error('Copy scripts error:', err);
            alert(`Failed to copy scripts: ${err.message}`);
        }
    }

    showSuccessMessage(message) {
        // Create floating success notification
        const notification = document.createElement('div');
        notification.className = 'copy-success-notification';
        notification.textContent = `✓ ${message}`;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, 2000);
    }

    render() {
        if (!this.filesContentEl) return;

        // Update count badge
        if (this.countBadge) {
            this.countBadge.textContent = this.selectedFiles.length;
        }

        if (this.selectedFiles.length === 0) {
            this.filesContentEl.innerHTML = '<p class="placeholder">Select files in the graph to preview them here.</p>';
            return;
        }

        const textFileCount = this.selectedFiles.filter(p => this.isTextFile(p)).length;

        // Render ordered file list with drag handles
        const filesList = this.selectedFiles.map((path, idx) => {
            const name = this.basename(path);
            const displayPath = window.toDisplayPath ? window.toDisplayPath(path) : path;
            const isText = this.isTextFile(path);
            
            return `
                <div class="file-item orderable" data-index="${idx}" draggable="true">
                    <div class="file-number">${idx + 1}</div>
                    <div class="drag-handle">⋮⋮</div>
                    <div class="file-icon">${isText ? '📄' : '📦'}</div>
                    <div class="file-info">
                        <div class="file-name">${name}</div>
                        <div class="file-path" title="${path}">${displayPath}</div>
                    </div>
                    <button class="icon-btn remove-file" data-path="${path}" title="Remove from selection">×</button>
                </div>
            `;
        }).join('');

        this.filesContentEl.innerHTML = `
            <div class="files-list">
                ${filesList}
            </div>
            <div class="files-actions">
                <button id="copy-paths-btn" class="action-btn">📋 Copy Paths</button>
                <button id="copy-scripts-btn" class="action-btn ${textFileCount === 0 ? 'disabled' : ''}" 
                        ${textFileCount === 0 ? 'disabled' : ''}>
                    📝 Copy Scripts (${textFileCount})
                </button>
            </div>
        `;

        // Attach event handlers
        this.attachHandlers();
    }

    attachHandlers() {
        // Copy paths button
        const copyPathsBtn = document.getElementById('copy-paths-btn');
        if (copyPathsBtn) {
            copyPathsBtn.addEventListener('click', () => this.copyPaths());
        }

        // Copy scripts button
        const copyScriptsBtn = document.getElementById('copy-scripts-btn');
        if (copyScriptsBtn) {
            copyScriptsBtn.addEventListener('click', () => this.copyScripts());
        }

        // Remove file buttons
        this.filesContentEl.querySelectorAll('.remove-file').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const path = e.currentTarget.dataset.path;
                this.removeFile(path);
            });
        });

        // Drag and drop handlers
        const items = this.filesContentEl.querySelectorAll('.file-item.orderable');
        items.forEach(item => {
            item.addEventListener('dragstart', (e) => this.handleDragStart(e));
            item.addEventListener('dragover', (e) => this.handleDragOver(e));
            item.addEventListener('drop', (e) => this.handleDrop(e));
            item.addEventListener('dragend', (e) => this.handleDragEnd(e));
        });
    }

    handleDragStart(e) {
        this.draggedIndex = parseInt(e.currentTarget.dataset.index);
        e.currentTarget.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    }

    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        const item = e.currentTarget;
        if (!item.classList.contains('dragging')) {
            item.classList.add('drag-over');
        }
    }

    handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const targetIndex = parseInt(e.currentTarget.dataset.index);
        
        if (this.draggedIndex !== null && this.draggedIndex !== targetIndex) {
            this.moveFile(this.draggedIndex, targetIndex);
        }
        
        e.currentTarget.classList.remove('drag-over');
    }

    handleDragEnd(e) {
        e.currentTarget.classList.remove('dragging');
        
        // Remove all drag-over classes
        this.filesContentEl.querySelectorAll('.file-item').forEach(item => {
            item.classList.remove('drag-over');
        });
        
        this.draggedIndex = null;
    }

    copyPaths() {
        const paths = this.selectedFiles.join('\n');
        navigator.clipboard.writeText(paths).then(() => {
            this.showSuccessMessage(`Copied ${this.selectedFiles.length} path${this.selectedFiles.length > 1 ? 's' : ''}!`);
            
            if (window.logEvent) {
                window.logEvent(`[files] copied ${this.selectedFiles.length} file paths`);
            }
        }).catch(err => {
            console.error('Failed to copy:', err);
            alert('Failed to copy to clipboard');
        });
    }

    basename(path) {
        const parts = (path || '').split(/[/\\]/).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : path;
    }

    onActivate() {
        this.render();
    }
}