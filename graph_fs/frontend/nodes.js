// nodes.js - File tree business logic and data management
import { GraphRenderer } from './graph-renderer.js';
import { SocketManager } from './socket-manager.js';

class Node {
    constructor(nodeName, fullPath, type, children = [], isOpen = false, depth = 0) {
        this.nodeName = nodeName;
        this.fullPath = fullPath;
        this.type = type;
        this.children = children;
        this.id = fullPath;
        this.isOpen = isOpen;
        this.depth = depth;
        this.selected = false;
        this.parentId = null; // optional pointer
    }
}

// Data structures
let nodesData = [];
let linksData = [];
let nodesMap = new Map();
let selectedFiles = new Set();
let openFolders = new Set();

// Managers
let renderer = null;
let socketManager = null;

// Current root
let currentRoot = null;

// Exclusions
let excludes = [];

// Public API for utility.js
window.nodesData = nodesData;
window.selectedFiles = selectedFiles;
window.setRoot = setRoot;
window.updateGraph = updateGraph;
window.updateColorVariables = updateColorVariables;
window.getExcludes = () => excludes;
window.setExcludes = (newExcludes) => { excludes = newExcludes; };

// -------------------- helpers --------------------

const norm = (p) => (p || '').replace(/\\/g, '/').replace(/\/+$/,''); // unify slashes; drop trailing /
const isAncestorPath = (ancestor, child) => {
    const a = norm(ancestor), c = norm(child);
    return a && c && a !== c && c.startsWith(a + '/');
};
const topLevelFoldersOnly = (folders) => {
    // drop any folder that has another selected folder as an ancestor
    const ids = folders.map(f => f.id);
    return folders.filter(f => !ids.some(id => id !== f.id && isAncestorPath(id, f.id)));
};

function updateColorVariables(theme) {
    if (renderer) {
        renderer.updateColorVariables(theme);
        updateGraph();
    }
}

// tiny logger passthrough so you can see flow in the UI
const log = (msg) => { if (window.logEvent) window.logEvent(msg); };

// -------------------- expose watch controls to the UI --------------------
window.enableWatch = (path) => {
    const p = path || currentRoot;
    if (!p) return;
    log(`[ui] watch_enable → ${p}`);
    socketManager?.watchEnable(p, true);
};
window.disableWatch = (pathOrNull) => {
    const p = pathOrNull ?? null;
    log(`[ui] watch_disable → ${p ?? '(all for this session)'}`);
    socketManager?.watchDisable(p);
};

// Rename helper: in-place rename of an open folder when parent directory is unchanged
function renameOpenFolder(oldPath, newPath) {
    const node = nodesMap.get(oldPath);
    if (!node) return false;

    // Snapshot subtree (node + all descendants)
    const stack = [node];
    const affected = [];
    while (stack.length) {
        const cur = stack.pop();
        affected.push(cur);
        if (cur.children && cur.children.length) stack.push(...cur.children);
    }

    const rebase = (oldId) =>
        oldId.startsWith(oldPath) ? (newPath + oldId.slice(oldPath.length)) : oldId;

    affected.forEach(n => {
        const oldId = n.id;

        // Maintain sets
        if (n.type === 'folder' && n.isOpen) {
            openFolders.delete(oldId);
            openFolders.add(rebase(oldId));
        }
        updateSetRename(selectedFiles, oldId, rebase(oldId));

        // Re-key in nodesMap
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
    if (setObj.has(oldId)) {
        setObj.delete(oldId);
        setObj.add(newId);
    }
}

// Smart, minimal mutations for files/folders inside already-open parents
function addChildIfVisible(parentPath, childPath, childName, type) {
    if (!openFolders.has(parentPath) || !nodesMap.has(parentPath)) return false;
    if (nodesMap.has(childPath)) return false; // already present
    const parentNode = nodesMap.get(parentPath);
    const childNode = new Node(childName, childPath, type, [], false, parentNode.depth + 1);
    childNode.parentId = parentNode.id;

    nodesMap.set(childNode.id, childNode);
    nodesData.push(childNode);
    parentNode.children = parentNode.children || [];
    parentNode.children.push(childNode);
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

// -------------------- init --------------------

function initializeGraph() {
    console.log('initializeGraph');
    const graphContainerEl = document.getElementById('graph');

    // Initialize renderer
    renderer = new GraphRenderer();
    renderer.initialize(
        graphContainerEl,
        handleNodeClick,
        handleLassoSelect
    );

    // Initialize socket manager
    socketManager = new SocketManager();
    setupSocketHandlers();
    socketManager.connect();
}

function setupSocketHandlers() {
    socketManager.onServerInfo = (data) => {
        console.log('Server info:', data.message);
        if (data.root && !currentRoot) currentRoot = data.root;
    };

    socketManager.onRootSet = (data) => {
        log(`[srv] root_set ← ${data.root}`);
        handleRootSet(data.root);
        if (window.onRootSet) window.onRootSet(data.root);
    };

    socketManager.onListing = (data) => {
        log(`[srv] listing ← ${data.path} (${data.children?.length ?? 0} children)`);
        handleListing(data.path, data.children);
    };

    socketManager.onWatchAck = (d) => {
        log(`[srv] watch_ack ← enabled=${!!d.enabled} path=${d.path || '(session all)'}`);
    };

    socketManager.onFsEvent = (evt) => {
        // High-signal line you’ll see in DevTools immediately
        log(`[fs_event#${evt.seq ?? '?'}][${evt.watch_path ?? '??'}] ${evt.event} ${evt.path}${evt.dest_path ? (' → ' + evt.dest_path) : ''} (dir=${!!evt.is_dir})`);
        handleFsEvent(evt);
    };

    socketManager.onError = (data) => {
        log(`[srv] ERROR ← ${data?.message || 'unknown'}`);
        alert('Server error: ' + (data?.message || 'unknown'));
    };
}

function setRoot(path, newExcludes) {
    excludes = newExcludes;
    socketManager.setRoot(path, excludes);
}

function handleRootSet(root) {
    currentRoot = root;
    clearData();

    const rootName = root.split(/[/\\]/).filter(Boolean).pop() || root;
    const rootNode = new Node(rootName, root, 'folder', [], false, 0);

    nodesData = [rootNode];
    linksData = [];
    nodesMap.set(rootNode.id, rootNode);

    updateGraph();
}

function clearData() {
    nodesMap.clear();
    selectedFiles.clear();
    openFolders.clear();
    nodesData = [];
    linksData = [];
}

function updateGraph() {
    if (renderer) {
        renderer.updateGraph(nodesData, linksData);
    }
}

// -------------------- interactions --------------------

function handleNodeClick(d) {
    if (d.type === 'folder') {
        toggleFolder(d);
    } else if (d.type === 'file') {
        d.selected = !d.selected;
        if (d.selected) selectedFiles.add(d.id);
        else selectedFiles.delete(d.id);

        requestAnimationFrame(() => {
            if (renderer) {
                renderer.updateNodeColors();
                renderer.updateLinkColors();
            }
        });
    }
}

function handleLassoSelect(selectedNodesInRect) {
    // Toggle selection state for files immediately (UX parity)
    const folderCandidates = [];
    selectedNodesInRect.forEach(d => {
        d.selected = !d.selected;
        if (d.type === 'file') {
            if (d.selected) selectedFiles.add(d.id);
            else selectedFiles.delete(d.id);
        } else if (d.type === 'folder') {
            folderCandidates.push(d);
        }
    });

    if (folderCandidates.length) {
        // 1) reduce to top-level only to avoid parent/child conflicts
        const topLevel = topLevelFoldersOnly(folderCandidates);

        // 2) deterministic ordering: CLOSE (deepest→shallowest), then OPEN (shallowest→deepest)
        const toClose = topLevel.filter(n => n.isOpen).sort((a,b) => b.depth - a.depth);
        const toOpen  = topLevel.filter(n => !n.isOpen).sort((a,b) => a.depth - b.depth);

        toClose.forEach(collapseFolder);
        toOpen.forEach(expandFolder);
    }

    requestAnimationFrame(() => {
        if (renderer) {
            renderer.updateNodeColors();
            renderer.updateLinkColors();
            renderer.simulation.restart();
        }
    });
}

function toggleFolder(node) {
    if (node.type !== 'folder') return;
    if (node.isOpen) collapseFolder(node);
    else expandFolder(node);
}

function expandFolder(node) {
    if (node.isOpen) return;

    node.isOpen = true;
    openFolders.add(node.id);

    // Immediate visual feedback
    requestAnimationFrame(() => {
        if (renderer) {
            renderer.updateNodeColors();
            renderer.updateLinkColors();
        }
    });

    // Request children from server
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
}

// -------------------- listings & fs events --------------------

function handleListing(dirPath, children) {
    // Ignore stale/late listings or listings for collapsed/removed folders
    if (!openFolders.has(dirPath) || !nodesMap.has(dirPath)) {
        return;
    }

    const parentNode = nodesMap.get(dirPath);
    parentNode.isOpen = true;
    openFolders.add(dirPath);

    // Track child IDs from server
    const childIds = new Set(children.map(c => c.path));

    // Remove vanished children (and their descendants)
    const currentChildren = nodesData.filter(n => {
        return linksData.some(l =>
            (l.source.id || l.source) === dirPath &&
            (l.target.id || l.target) === n.id
        );
    });
    currentChildren.forEach(child => {
        if (!childIds.has(child.id)) {
            removeNodeAndDescendants(child);
        }
    });

    // Add/update children
    const newNodes = [];
    const newLinks = [];

    children.forEach(child => {
        let childNode = nodesMap.get(child.path);
        if (!childNode) {
            childNode = new Node(
                child.name,
                child.path,
                child.type,
                [],
                false,
                parentNode.depth + 1
            );
            childNode.parentId = parentNode.id;
            newNodes.push(childNode);
            nodesMap.set(childNode.id, childNode);
            parentNode.children.push(childNode);
        }

        // Ensure link exists
        const linkExists = linksData.some(l =>
            (l.source.id || l.source) === parentNode.id &&
            (l.target.id || l.target) === childNode.id
        );
        if (!linkExists) {
            newLinks.push({ source: parentNode, target: childNode });
        }
    });

    nodesData.push(...newNodes);
    linksData.push(...newLinks);

    updateGraph();

    // Refresh any subfolders that were previously open
    children.forEach(child => {
        if (child.type === 'folder' && openFolders.has(child.path)) {
            socketManager.listDir(child.path, excludes);
        }
    });
}

// Improved: also detach from parent.children and only remove folders from openFolders
function removeNodeAndDescendants(node) {
    // Detach from parent.children to avoid stale pointers
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

// ----- handleFsEvent: log + surgical mutations (created/deleted/moved) -----
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
            if (renameFileInPlace(path, dest)) {
                refreshIfOpen(oldParent); // to reconcile sorted order
                return;
            }
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

    if (kind === 'modified' && isDir) return; // ignore noisy folder touches
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
