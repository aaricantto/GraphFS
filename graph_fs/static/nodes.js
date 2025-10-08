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
        // optional parent pointer (helps future scalability; not required elsewhere)
        this.parentId = null;
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

// tiny logger passthrough so you can see fs_event flow in the UI
const log = (msg) => { if (window.logEvent) window.logEvent(msg); };

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
            // parentId unchanged for same-parent rename
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
    return true;
}

function removePathIfPresent(absPath) {
    const node = nodesMap.get(absPath);
    if (!node) return false;
    removeNodeAndDescendants(node);
    updateGraph();
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
        handleRootSet(data.root);
        if (window.onRootSet) window.onRootSet(data.root);
    };

    socketManager.onListing = (data) => {
        handleListing(data.path, data.children);
    };

    socketManager.onFsEvent = (evt) => {
        handleFsEvent(evt);
    };

    socketManager.onError = (data) => {
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

// Real-time FS events:
// - Folder deleted while open -> remove immediately + refresh parent
// - Folder renamed in same parent -> rename in place (preserve open state/children)
// - File created/modified/deleted -> incremental updates for open parents
function handleFsEvent(evt) {
    // Debug surface so you can see them arrive
    log(`fs_event: ${JSON.stringify({
        event: evt?.event, path: evt?.path, dest: evt?.dest_path, is_dir: !!evt?.is_dir
    })}`);

    const kind = evt?.event;
    const path = evt?.path;
    const dest = evt?.dest_path;
    const isDir = !!evt?.is_dir;

    const refreshIfOpen = (p) => {
        if (!p) return;
        if (openFolders.has(p)) socketManager.listDir(p, excludes);
    };

    if (!path && !dest) return;

    // CREATED: add immediately if parent is open
    if (kind === 'created' && path) {
        const parent = parentDir(path);
        const name = path.split(/[/\\]/).filter(Boolean).pop();
        const type = isDir ? 'folder' : 'file';
        if (addChildIfVisible(parent, path, name, type)) return;
        if (openFolders.has(parent)) socketManager.listDir(parent, excludes);
        return;
    }

    // DELETED: remove immediately if present
    if (kind === 'deleted' && path) {
        if (removePathIfPresent(path)) return;
        const parent = parentDir(path);
        if (openFolders.has(parent)) socketManager.listDir(parent, excludes);
        return;
    }

    // Folder rename/move
    if (kind === 'moved' && isDir && path && dest) {
        const oldParent = parentDir(path);
        const newParent = parentDir(dest);

        if (oldParent === newParent) {
            // in-place rename
            if (nodesMap.has(path)) {
                const renamed = renameOpenFolder(path, dest);
                if (renamed) {
                    updateGraph();
                    refreshIfOpen(oldParent);
                    return;
                }
            }
            // if not visible, just refresh the parent if open
            refreshIfOpen(oldParent);
            return;
        } else {
            // moved across parents
            if (nodesMap.has(path)) {
                const node = nodesMap.get(path);
                removeNodeAndDescendants(node);
                updateGraph();
            }
            refreshIfOpen(oldParent);
            refreshIfOpen(newParent);
            return;
        }
    }

    // FILE rename/move handling (same/different parent)
    if (kind === 'moved' && !isDir && path && dest) {
        const oldParent = parentDir(path);
        const newParent = parentDir(dest);
        if (oldParent === newParent) {
            if (renameFileInPlace(path, dest)) {
                refreshIfOpen(oldParent); // reconcile sort order if needed
                return;
            }
            refreshIfOpen(oldParent);
            return;
        } else {
            // Parent changed
            removePathIfPresent(path); // remove from old parent if we had it
            const name = dest.split(/[/\\]/).filter(Boolean).pop();
            addChildIfVisible(newParent, dest, name, 'file'); // add if the new parent is visible
            refreshIfOpen(oldParent);
            refreshIfOpen(newParent);
            return;
        }
    }

    // Ignore directory "modified" noise (created files already handled above).
    if (kind === 'modified' && isDir) return;

    // Other cases → refresh affected parents
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
