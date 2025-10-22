// sidebar/files-panel.js — Event-driven selection UI for Files panel
// Adds: robust clipboard, Save to Folder, Download ZIP, and **Copy as Files (native OS clipboard)**

export class FilesPanel {
    constructor() {
        this.filesContentEl = null;
        this.countBadge = null;
        this.selectedFiles = []; // Ordered absolute paths
        this.draggedIndex = null;

        // Text-like extensions we can safely read/concat as text
        this.textExtensions = new Set([
            '.js', '.py', '.txt', '.md', '.json', '.html', '.css', '.jsx', '.ts', '.tsx',
            '.yaml', '.yml', '.xml', '.sh', '.bash', '.sql', '.java', '.c', '.cpp', '.h',
            '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.cs', '.r', '.scala', '.lua'
        ]);
    }

    initialize() {
        this.filesContentEl = document.getElementById('files-content');
        this.countBadge = document.getElementById('selected-count');

        // Event-driven: listen for graph selection changes
        document.addEventListener('graphfs:selected_files', (e) => {
            const files = new Set(e.detail?.files || []);
            this.syncFromGraph(files);
        });

        // Back-compat: allow nodes.js to call directly
        window.updateFilesPanel = (filesSet) => this.syncFromGraph(filesSet);

        // First paint
        this.render();
    }

    // ---------------- Clipboard / download helpers ----------------

    async copyTextBestEffort(text) {
        if (window.isSecureContext && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.pointerEvents = 'none';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } finally { document.body.removeChild(ta); }
        if (ok) return true;
        throw new Error('Clipboard not available in this context');
    }

    downloadTextFile(filename, text) {
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    // ---------------- Selection sync / mutations -------------------

    syncFromGraph(filesSet) {
        const graphFiles = Array.from(filesSet);
        const newFiles = graphFiles.filter(f => !this.selectedFiles.includes(f));
        const next = [
            ...this.selectedFiles.filter(f => filesSet.has(f)),
            ...newFiles
        ];
        const same =
            next.length === this.selectedFiles.length &&
            next.every((v, i) => v === this.selectedFiles[i]);
        if (!same) {
            this.selectedFiles = next;
            this.render();
        }
    }

    removeFile(path) {
        this.selectedFiles = this.selectedFiles.filter(p => p !== path);
        document.dispatchEvent(new CustomEvent('graphfs:deselect_file', { detail: { path } }));
        this.render();
        window.logEvent?.(`[files] removed "${this.basename(path)}" from selection`);
    }

    moveFile(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;
        const [movedFile] = this.selectedFiles.splice(fromIndex, 1);
        this.selectedFiles.splice(toIndex, 0, movedFile);
        this.render();
    }

    // ---------------- Type helpers -------------------

    isTextFile(path) {
        const dot = path.lastIndexOf('.');
        const ext = dot >= 0 ? path.substring(dot).toLowerCase() : '';
        return this.textExtensions.has(ext);
    }

    basename(path) {
        const parts = (path || '').split(/[/\\]/).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : path;
    }

    // ---------------- Actions -------------------

    async copyScripts() {
        const textFiles = this.selectedFiles.filter(p => this.isTextFile(p));
        if (textFiles.length === 0) {
            alert('No text files selected. Select .py, .js, .txt, etc.');
            return;
        }

        try {
            const response = await fetch('/api/read_files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: textFiles })
            });
            if (!response.ok) throw new Error('Failed to read files from server');
            const data = await response.json();

            let output = '';
            data.files.forEach((fileData, idx) => {
                const relativePath = window.toDisplayPath
                    ? window.toDisplayPath(fileData.path)
                    : this.basename(fileData.path);
                output += `SCRIPT ${idx + 1}: ${relativePath}\n\n`;
                output += fileData.content ?? '';
                output += '\n\n\n\n';
            });

            try {
                await this.copyTextBestEffort(output);
                this.showSuccessMessage(`Copied ${textFiles.length} script${textFiles.length > 1 ? 's' : ''}!`);
                window.logEvent?.(`[files] copied ${textFiles.length} scripts to clipboard`);
            } catch {
                this.downloadTextFile(`scripts-${Date.now()}.txt`, output);
                this.showSuccessMessage('Saved scripts as a file (clipboard not available)');
            }
        } catch (err) {
            console.error('Copy scripts error:', err);
            alert(`Failed to copy scripts: ${err.message}`);
        }
    }

    async copyPaths() {
        const paths = this.selectedFiles.join('\n');
        try {
            await this.copyTextBestEffort(paths);
            this.showSuccessMessage(`Copied ${this.selectedFiles.length} path${this.selectedFiles.length > 1 ? 's' : ''}!`);
            window.logEvent?.(`[files] copied ${this.selectedFiles.length} file paths`);
        } catch {
            this.downloadTextFile(`paths-${Date.now()}.txt`, paths);
            this.showSuccessMessage('Saved paths as a file (clipboard not available)');
        }
    }

    // NEW: Copy selected files to the OS clipboard as real files (Windows / GNOME)
    async copyAsFilesToClipboard() {
        if (this.selectedFiles.length === 0) {
            alert('No files selected.');
            return;
        }
        try {
            const resp = await fetch('/api/copy_files_to_clipboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: this.selectedFiles })
            });
            const j = await resp.json().catch(() => ({}));
            if (!resp.ok || !j.ok) throw new Error(j.error || 'Clipboard helper failed');
            this.showSuccessMessage(`Copied ${j.count} file${j.count > 1 ? 's' : ''} to OS clipboard`);
            window.logEvent?.(`[files] copied ${j.count} files to OS clipboard`);
        } catch (err) {
            console.error('Copy as files error:', err);
            alert(`Failed to copy files to clipboard: ${err.message}`);
        }
    }

    // Save selected text files to a user-chosen folder (Chromium)
    async saveToFolder() {
        const textFiles = this.selectedFiles.filter(p => this.isTextFile(p));
        if (textFiles.length === 0) {
            alert('No text files selected. Select .py, .js, .txt, etc.');
            return;
        }
        if (!window.showDirectoryPicker) {
            alert('Your browser does not support saving to folders. Try Chrome or Edge.');
            return;
        }

        let dirHandle;
        try { dirHandle = await window.showDirectoryPicker(); } catch { return; }

        const resp = await fetch('/api/read_files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: textFiles })
        });
        if (!resp.ok) {
            const j = await resp.json().catch(() => ({}));
            throw new Error(j.error || 'Failed to read files');
        }
        const data = await resp.json();

        for (const f of data.files) {
            const name = this.basename(f.path);
            const handle = await dirHandle.getFileHandle(name, { create: true });
            const writable = await handle.createWritable();
            await writable.write(f.content ?? '');
            await writable.close();
        }

        this.showSuccessMessage(`Saved ${data.files.length} file${data.files.length > 1 ? 's' : ''} to folder`);
        window.logEvent?.(`[files] saved ${data.files.length} files via File System Access API`);
    }

    // Download selected text files as a ZIP
    async downloadZip() {
        const textFiles = this.selectedFiles.filter(p => this.isTextFile(p));
        if (textFiles.length === 0) {
            alert('No text files selected.');
            return;
        }

        const resp = await fetch('/api/zip_files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: textFiles })
        });
        if (!resp.ok) {
            const j = await resp.json().catch(() => ({}));
            throw new Error(j.error || 'Failed to zip files');
        }

        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `scripts-${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        this.showSuccessMessage('Downloaded ZIP');
        window.logEvent?.('[files] downloaded ZIP of selected files');
    }

    // ---------------- UI rendering -------------------

    showSuccessMessage(message) {
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

        if (this.countBadge) {
            this.countBadge.textContent = this.selectedFiles.length;
        }

        if (this.selectedFiles.length === 0) {
            this.filesContentEl.innerHTML = '<p class="placeholder">Select files in the graph to preview them here.</p>';
            return;
        }

        const textFileCount = this.selectedFiles.filter(p => this.isTextFile(p)).length;

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

        const disabledIfNone = this.selectedFiles.length === 0 ? 'disabled' : '';
        const disabledClassIfNone = this.selectedFiles.length === 0 ? 'disabled' : '';
        const disabledIfNoText = textFileCount === 0 ? 'disabled' : '';
        const disabledClassIfNoText = textFileCount === 0 ? 'disabled' : '';

        this.filesContentEl.innerHTML = `
            <div class="files-list">
                ${filesList}
            </div>
            <div class="files-actions">
                <button id="copy-paths-btn" class="action-btn ${disabledClassIfNone}" ${disabledIfNone}>📋 Copy Paths</button>
                <button id="copy-files-btn" class="action-btn ${disabledClassIfNone}" ${disabledIfNone}>📁 Copy as Files</button>
                <button id="copy-scripts-btn" class="action-btn ${disabledClassIfNoText}" ${disabledIfNoText}>📝 Copy Scripts (${textFileCount})</button>
                <button id="save-to-folder-btn" class="action-btn ${disabledClassIfNoText}" ${disabledIfNoText}>📂 Save to Folder</button>
                <button id="download-zip-btn" class="action-btn ${disabledClassIfNoText}" ${disabledIfNoText}>📦 Download ZIP</button>
            </div>
        `;

        this.attachHandlers();
    }

    attachHandlers() {
        document.getElementById('copy-paths-btn')?.addEventListener('click', () => this.copyPaths());
        document.getElementById('copy-files-btn')?.addEventListener('click', () => this.copyAsFilesToClipboard());
        document.getElementById('copy-scripts-btn')?.addEventListener('click', () => this.copyScripts());
        document.getElementById('save-to-folder-btn')?.addEventListener('click', () => this.saveToFolder());
        document.getElementById('download-zip-btn')?.addEventListener('click', () => this.downloadZip());

        this.filesContentEl.querySelectorAll('.remove-file').forEach(btn => {
            btn.addEventListener('click', (e) => this.removeFile(e.currentTarget.dataset.path));
        });

        const items = this.filesContentEl.querySelectorAll('.file-item.orderable');
        items.forEach(item => {
            item.addEventListener('dragstart', (e) => this.handleDragStart(e));
            item.addEventListener('dragover',  (e) => this.handleDragOver(e));
            item.addEventListener('drop',      (e) => this.handleDrop(e));
            item.addEventListener('dragend',   (e) => this.handleDragEnd(e));
        });
    }

    handleDragStart(e) {
        this.draggedIndex = parseInt(e.currentTarget.dataset.index, 10);
        e.currentTarget.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    }

    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const item = e.currentTarget;
        if (!item.classList.contains('dragging')) item.classList.add('drag-over');
    }

    handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        const targetIndex = parseInt(e.currentTarget.dataset.index, 10);
        if (this.draggedIndex !== null && this.draggedIndex !== targetIndex) {
            this.moveFile(this.draggedIndex, targetIndex);
        }
        e.currentTarget.classList.remove('drag-over');
    }

    handleDragEnd(e) {
        e.currentTarget.classList.remove('dragging');
        this.filesContentEl.querySelectorAll('.file-item').forEach(i => i.classList.remove('drag-over'));
        this.draggedIndex = null;
    }

    onActivate() { this.render(); }
}
