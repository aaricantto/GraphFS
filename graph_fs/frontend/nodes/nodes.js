// nodes.js - Multi-root forest with proper app state integration + overlay sync
import { GraphRenderer } from './graph-renderer.js';
import { SocketManager } from './../socket-manager.js';

class Node {
    constructor(nodeName, fullPath, type, children = [], isOpen = false, depth = 0, isRoot = false) {
        this.nodeName = nodeName;
        this.fullPath = fullPath;
        this.type = type;
        this.children = children;
        this.id = fullPath;
        this.isOpen = isOpen;
        this.depth = depth;
        this.selected = false;
        this.parentId = null;
        this.isRoot = !!isRoot;
    }
}

// Data structures
let nodesData = [];
let linksData = [];
let nodesMap = new Map();
let selectedFiles = new Set();
let openFolders = new Set();
let rootsMap = new Map(); // key: normalized abs path -> { name, path (original) }

// Managers
let renderer = null;
let socketManager = null;

// Exclusions
let excludes = [];

// -------------------- small helpers --------------------
const norm = (p) => (p || '').replace(/\\/g, '/').replace(/\/+$/,'');
const isAncestorPath = (ancestor, child) => {
    const a = norm(ancestor), c = norm(child);
    return a && c && a !== c && c.startsWith(a + '/');
};
const basename = (p) => {
    const parts = (p || '').split(/[/\\]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : p;
};
const log = (msg) => { if (window.logEvent) window.logEvent(msg); };
const emit = (name, detail = {}) => document.dispatchEvent(new CustomEvent(name, { detail }));

// -------------------- Public API --------------------
window.nodesData = nodesData;
window.selectedFiles = selectedFiles;
window.addRoot = addRoot;
window.removeRoot = removeRoot;
window.setRoot = addRoot; // legacy alias
window.updateGraph = updateGraph;
window.updateColorVariables = updateColorVariables;
window.getExcludes = () => excludes;
window.setExcludes = (newExcludes) => { excludes = newExcludes; };
window.toDisplayPath = toDisplayPath;
window.toggleFavoriteRoot = toggleFavoriteRoot;
window.requestAppState = requestAppState;

// Overlay-facing readonly snapshot + actions
window.__graphfs_export = () => ({ nodesMap, selectedFiles, openFolders });
window.__graphfs_getRoots = () => Array.from(rootsMap.values()); // [{name, path}]
window.expandCollapsePath = (action, path) => {
    const n = nodesMap.get(path);
    if (!n || n.type !== 'folder') return;
    action === 'expand' ? expandFolder(n) : collapseFolder(n);
};
window.toggleSelectFileByPath = (path) => {
    const n = nodesMap.get(path);
    if (!n || n.type !== 'file') return;
    n.selected = !n.selected;
    if (n.selected) selectedFiles.add(n.id); else selectedFiles.delete(n.id);
    if (renderer) { renderer.updateNodeColors(); renderer.updateLinkColors(); }
    emit('graphfs:selection_changed', { selected: Array.from(selectedFiles) });
};

// -------------------- theming --------------------
function updateColorVariables(theme) {
    if (renderer) {
        renderer.updateColorVariables(theme);
        updateGraph();
    }
}

function toDisplayPath(absPath) {
    const p = norm(absPath);
    let best = null;
    for (const r of rootsMap.keys()) {
        const rn = norm(r);
        if (p === rn || p.startsWith(rn + '/')) {
            if (!best || rn.length > best.length) best = rn;
        }
    }
    if (!best) return absPath;
    const rootName = rootsMap.get(best)?.name || basename(best);
    if (p === best) return rootName;
    const rel = p.slice(best.length + 1);
    return `${rootName}/${rel}`;
}

function isUnderRoot(path, rootPath) {
    const p = norm(path);
    const r = norm(rootPath);
    return p === r || p.startsWith(r + '/');
}

const topLevelFoldersOnly = (folders) => {
    const ids = folders.map(f => f.id);
    return folders.filter(f => !ids.some(id => id !== f.id && isAncestorPath(id, f.id)));
};

// -------------------- watch controls --------------------
window.enableWatch = (path) => {
    if (!path) {
        rootsMap.forEach((v) => {
            log(`[ui] watch_enable → ${v.path}`);
            socketManager?.watchEnable(v.path, true);
        });
    } else {
        log(`[ui] watch_enable → ${path}`);
        socketManager?.watchEnable(path, true);
    }
};

window.disableWatch = (pathOrNull) => {
    const p = pathOrNull ?? null;
    log(`[ui] watch_disable → ${p ?? '(all for this session)'}`);
    socketManager?.watchDisable(p);
};

// -------------------- App State / Favorites --------------------
function requestAppState() {
    if (socketManager) socketManager.getAppState();
}
function toggleFavoriteRoot(path) {
    if (socketManager) socketManager.toggleFavoriteRoot(path);
}

// -------------------- init --------------------
function initializeGraph() {
    const graphContainerEl = document.getElementById('graph');

    renderer = new GraphRenderer();
    renderer.initialize(graphContainerEl, handleNodeClick, handleLassoSelect);

    socketManager = new SocketManager();
    setupSocketHandlers();
    socketManager.connect();

    // EVENT-DRIVEN DESELECTION from Files panel
    document.addEventListener('graphfs:deselect_file', (e) => {
        const { path } = e.detail || {};
        if (!path) return;
        const node = nodesMap.get(path);
        if (node && node.type === 'file' && node.selected) {
            node.selected = false;
            selectedFiles.delete(path);
            if (renderer) { renderer.updateNodeColors(); renderer.updateLinkColors(); }
            emit('graphfs:selection_changed', { selected: Array.from(selectedFiles) });
        }
    });
}

function setupSocketHandlers() {
    socketManager.onServerInfo = (data) => {
        // Load existing roots from server on connect
        if (Array.isArray(data?.roots)) {
            data.roots.forEach(r => { if (r?.path) handleRootAdded(r.path, r.name); });
        }
        if (data?.state) {
            emit('graphfs:app_state', data.state);
        }
    };

    socketManager.onRootAdded = (data) => {
        log(`[srv] root_added ← ${data.root}`);
        handleRootAdded(data.root, data.name);
        if (window.onRootSet) window.onRootSet(data.root);
        emit('graphfs:root_added', { root: data.root, name: data.name });
    };

    socketManager.onRootRemoved = (data) => {
        log(`[srv] root_removed ← ${data.root}`);
        handleRootRemoved(data.root);
        emit('graphfs:root_removed', { root: data.root });
    };

    socketManager.onListing = (data) => {
        log(`[srv] listing ← ${data.path} (${data.children?.length ?? 0} children)`);
        handleListing(data.path, data.children);
    };

    socketManager.onWatchAck = (d) => {
        log(`[srv] watch_ack ← enabled=${!!d.enabled} path=${d.path || '(session all)'}`);
    };

    socketManager.onFsEvent = (evt) => {
        log(`[fs_event#${evt.seq ?? '?'}][${evt.watch_path ?? '??'}] ${evt.event} ${evt.path}${evt.dest_path ? (' → ' + evt.dest_path) : ''} (dir=${!!evt.is_dir})`);
        handleFsEvent(evt);
    };

    socketManager.onError = (data) => {
        log(`[srv] ERROR ← ${data?.message || 'unknown'}`);
        alert('Server error: ' + (data?.message || 'unknown'));
    };

    socketManager.onAppState = (state) => emit('graphfs:app_state', state);
    socketManager.onFavoriteToggled = (d) => emit('graphfs:favorite_toggled', d);
}

// -------------------- Multi-root API --------------------
function addRoot(path, newExcludes) {
    if (newExcludes) excludes = newExcludes;
    socketManager.addRoot(path, excludes);
}
function removeRoot(path) {
    socketManager.removeRoot(path);
}

function handleRootAdded(rootAbsPath, rootName) {
    const name = rootName || basename(rootAbsPath);
    const key = norm(rootAbsPath);
    rootsMap.set(key, { name, path: rootAbsPath });

    if (!nodesMap.has(rootAbsPath)) {
        const rootNode = new Node(name, rootAbsPath, 'folder', [], false, 0, true);
        nodesData.push(rootNode);
        nodesMap.set(rootNode.id, rootNode);
        updateGraph();
    }
}

function handleRootRemoved(rootAbsPath) {
    const key = norm(rootAbsPath);
    rootsMap.delete(key);
    const rootNode = nodesMap.get(rootAbsPath);
    if (rootNode) {
        removeNodeAndDescendants(rootNode);
        updateGraph();
    }
}

function clearData() {
    nodesMap.clear();
    selectedFiles.clear();
    openFolders.clear();
    rootsMap.clear();
    nodesData = [];
    linksData = [];
}

function updateGraph() {
    if (renderer) renderer.updateGraph(nodesData, linksData);
}

// -------------------- interactions --------------------
function handleNodeClick(d) {
    if (d.type === 'folder') {
        toggleFolder(d);
    } else if (d.type === 'file') {
        d.selected = !d.selected;
        if (d.selected) selectedFiles.add(d.id); else selectedFiles.delete(d.id);
        if (renderer) { renderer.updateNodeColors(); renderer.updateLinkColors(); }
        emit('graphfs:selection_changed', { selected: Array.from(selectedFiles) });
    }
}

function handleLassoSelect(selectedNodesInRect) {
    const folderCandidates = [];
    selectedNodesInRect.forEach(d => {
        d.selected = !d.selected;
        if (d.type === 'file') {
            if (d.selected) selectedFiles.add(d.id); else selectedFiles.delete(d.id);
        } else if (d.type === 'folder') {
            folderCandidates.push(d);
        }
    });

    if (folderCandidates.length) {
        const topLevel = topLevelFoldersOnly(folderCandidates);
        const toClose = topLevel.filter(n => n.isOpen).sort((a,b) => b.depth - a.depth);
        const toOpen  = topLevel.filter(n => !n.isOpen).sort((a,b) => a.depth - b.depth);
        toClose.forEach(collapseFolder);
        toOpen.forEach(expandFolder);
    }

    if (renderer) { renderer.updateNodeColors(); renderer.updateLinkColors(); renderer.simulation.restart(); }
    emit('graphfs:selection_changed', { selected: Array.from(selectedFiles) });
}

function toggleFolder(node) {
    if (node.type !== 'folder') return;
    node.isOpen ? collapseFolder(node) : expandFolder(node);
}

function expandFolder(node) {
    if (node.isOpen) return;
    node.isOpen = true;
    openFolders.add(node.id);

    if (renderer) { renderer.updateNodeColors(); renderer.updateLinkColors(); }
    emit('graphfs:open_state_changed', { open: Array.from(openFolders) });

    socketManager.listDir(node.id, excludes);
}

function collapseFolder(node) {
    if (!node.isOpen) return;

    const descendants = getDescendants(node);
    descendants.forEach(descendantId => {
        nodesMap.delete(descendantId);
        selectedFiles.delete(descendantId);
        openFolders.delete(descendantId);
    });

    nodesData = nodesData.filter(n => !descendants.includes(n.id));
    linksData = linksData.filter(l =>
        !descendants.includes(l.source.id || l.source) &&
        !descendants.includes(l.target.id || l.target)
    );

    node.children = [];
    node.isOpen = false;
    openFolders.delete(node.id);

    updateGraph();
    emit('graphfs:open_state_changed', { open: Array.from(openFolders) });
}

// -------------------- listings & fs events --------------------
function handleListing(dirPath, children) {
    if (!openFolders.has(dirPath) || !nodesMap.has(dirPath)) return;

    const parentNode = nodesMap.get(dirPath);
    parentNode.isOpen = true;
    openFolders.add(dirPath);

    const childIds = new Set(children.map(c => c.path));

    const currentChildren = nodesData.filter(n => {
        return linksData.some(l =>
            (l.source.id || l.source) === dirPath &&
            (l.target.id || l.target) === n.id
        );
    });
    currentChildren.forEach(child => {
        if (!childIds.has(child.id)) removeNodeAndDescendants(child);
    });

    const newNodes = [];
    const newLinks = [];

    children.forEach(child => {
        let childNode = nodesMap.get(child.path);
        if (!childNode) {
            childNode = new Node(child.name, child.path, child.type, [], false, parentNode.depth + 1);
            childNode.parentId = parentNode.id;
            newNodes.push(childNode);
            nodesMap.set(childNode.id, childNode);
            parentNode.children.push(childNode);
        }

        const linkExists = linksData.some(l =>
            (l.source.id || l.source) === parentNode.id &&
            (l.target.id || l.target) === childNode.id
        );
        if (!linkExists) newLinks.push({ source: parentNode, target: childNode });
    });

    nodesData.push(...newNodes);
    linksData.push(...newLinks);
    updateGraph();

    children.forEach(child => {
        if (child.type === 'folder' && openFolders.has(child.path)) {
            socketManager.listDir(child.path, excludes);
        }
    });

    emit('graphfs:listing_applied', { dirPath });
}

function removeNodeAndDescendants(node) {
    if (node.parentId && nodesMap.has(node.parentId)) {
        const parent = nodesMap.get(node.parentId);
        parent.children = (parent.children || []).filter(ch => ch.id !== node.id);
    }

    const descendants = getDescendants(node);
    descendants.push(node.id);

    descendants.forEach(id => {
        const n = nodesMap.get(id);
        if (!n) return;
        nodesMap.delete(id);
        selectedFiles.delete(id);
        if (n.type === 'folder') openFolders.delete(id);
    });

    nodesData = nodesData.filter(n => !descendants.includes(n.id));
    linksData = linksData.filter(l =>
        !descendants.includes(l.source.id || l.source) &&
        !descendants.includes(l.target.id || l.target)
    );
}

function getDescendants(node) {
    const descendants = [];
    const stack = [...(node.children || [])];
    while (stack.length > 0) {
        const current = stack.pop();
        descendants.push(current.id);
        if (current.children && current.children.length > 0) {
            stack.push(...current.children);
        }
    }
    return descendants;
}

// ----- Rename/Move helpers -----
function renameOpenFolder(oldPath, newPath) {
    const node = nodesMap.get(oldPath);
    if (!node) return false;

    const stack = [node];
    const affected = [];
    while (stack.length) {
        const cur = stack.pop();
        affected.push(cur);
        if (cur.children && cur.children.length) stack.push(...cur.children);
    }

    const rebase = (oldId) => oldId.startsWith(oldPath) ? (newPath + oldId.slice(oldPath.length)) : oldId;

    affected.forEach(n => {
        const oldId = n.id;

        if (n.type === 'folder' && n.isOpen) {
            openFolders.delete(oldId);
            openFolders.add(rebase(oldId));
        }
        updateSetRename(selectedFiles, oldId, rebase(oldId));

        nodesMap.delete(oldId);
        n.id = rebase(oldId);
        n.fullPath = n.id;

        if (n === node) {
            n.nodeName = newPath.split(/[/\\]/).filter(Boolean).pop() || n.nodeName;
        } else if (n.parentId) {
            n.parentId = rebase(n.parentId);
        }

        nodesMap.set(n.id, n);
    });

    return true;
}

function updateSetRename(setObj, oldId, newId) {
    if (setObj.has(oldId)) { setObj.delete(oldId); setObj.add(newId); }
}

function addChildIfVisible(parentPath, childPath, childName, type) {
    if (!openFolders.has(parentPath) || !nodesMap.has(parentPath)) return false;
    if (nodesMap.has(childPath)) return false;
    const parentNode = nodesMap.get(parentPath);
    const childNode = new Node(childName, childPath, type, [], false, parentNode.depth + 1);
    childNode.parentId = parentNode.id;

    nodesMap.set(childNode.id, childNode);
    parentNode.children = parentNode.children || [];
    parentNode.children.push(childNode);

    nodesData.push(childNode);
    linksData.push({ source: parentNode, target: childNode });
    updateGraph();
    log(`[ui.apply] add → parent=${parentPath} child=${childPath}`);
    return true;
}

function removePathIfPresent(absPath) {
    const node = nodesMap.get(absPath);
    if (!node) return false;
    removeNodeAndDescendants(node);
    updateGraph();
    log(`[ui.apply] remove → ${absPath}`);
    return true;
}

function renameFileInPlace(oldPath, newPath) {
    const node = nodesMap.get(oldPath);
    if (!node || node.type !== 'file') return false;
    nodesMap.delete(oldPath);
    updateSetRename(selectedFiles, oldPath, newPath);
    node.id = newPath;
    node.fullPath = newPath;
    node.nodeName = newPath.split(/[/\\]/).filter(Boolean).pop() || node.nodeName;
    nodesMap.set(node.id, node);
    updateGraph();
    log(`[ui.apply] rename(file) → ${oldPath} → ${newPath}`);
    return true;
}

// ----- handleFsEvent: surgical mutations -----
function handleFsEvent(evt) {
    const kind = evt?.event;
    const path = evt?.path;
    const dest = evt?.dest_path;
    const isDir = !!evt?.is_dir;

    const refreshIfOpen = (p) => {
        if (!p) return;
        if (openFolders.has(p)) {
            log(`[ui.apply] refresh(list_dir) → ${p}`);
            socketManager.listDir(p, excludes);
        }
    };

    if (!path && !dest) return;

    if (kind === 'created' && path) {
        const parent = parentDir(path);
        const name = path.split(/[/\\]/).filter(Boolean).pop();
        const type = isDir ? 'folder' : 'file';
        if (addChildIfVisible(parent, path, name, type)) return;
        if (openFolders.has(parent)) socketManager.listDir(parent, excludes);
        return;
    }

    if (kind === 'deleted' && path) {
        if (removePathIfPresent(path)) return;
        const parent = parentDir(path);
        if (openFolders.has(parent)) socketManager.listDir(parent, excludes);
        return;
    }

    if (kind === 'moved' && isDir && path && dest) {
        const oldParent = parentDir(path);
        const newParent = parentDir(dest);
        if (oldParent === newParent) {
            if (nodesMap.has(path)) {
                const renamed = renameOpenFolder(path, dest);
                if (renamed) {
                    updateGraph();
                    log(`[ui.apply] rename(folder) → ${path} → ${dest}`);
                    refreshIfOpen(oldParent);
                    return;
                }
            }
            refreshIfOpen(oldParent);
            return;
        } else {
            if (nodesMap.has(path)) {
                const node = nodesMap.get(path);
                removeNodeAndDescendants(node);
                updateGraph();
                log(`[ui.apply] move(folder) drop old subtree → ${path}`);
            }
            refreshIfOpen(oldParent);
            refreshIfOpen(newParent);
            return;
        }
    }

    if (kind === 'moved' && !isDir && path && dest) {
        const oldParent = parentDir(path);
        const newParent = parentDir(dest);
        if (oldParent === newParent) {
            if (renameFileInPlace(path, dest)) { refreshIfOpen(oldParent); return; }
            refreshIfOpen(oldParent);
            return;
        } else {
            removePathIfPresent(path);
            const name = dest.split(/[/\\]/).filter(Boolean).pop();
            addChildIfVisible(newParent, dest, name, 'file');
            refreshIfOpen(oldParent);
            refreshIfOpen(newParent);
            return;
        }
    }

    if (kind === 'modified' && isDir) return;
    refreshIfOpen(parentDir(path));
    refreshIfOpen(parentDir(dest));
}

function parentDir(path) {
    const parts = path.split(/[/\\]/).filter(Boolean);
    if (parts.length <= 1) return path;
    parts.pop();
    const sep = path.includes('\\') ? '\\' : '/';
    let parent = parts.join(sep);
    if (path.startsWith(sep)) parent = sep + parent;
    if (/^[A-Za-z]:/.test(path) && parent.endsWith(':')) parent += sep;
    return parent || path;
}

function cleanup() {
    if (renderer) renderer.cleanup();
    if (socketManager) socketManager.disconnect();
    clearData();
}

window.addEventListener('beforeunload', cleanup);
initializeGraph();
