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

function removeNodeAndDescendants(node) {
    const descendants = getDescendants(node);
    descendants.push(node.id);

    descendants.forEach(id => {
        nodesMap.delete(id);
        selectedFiles.delete(id);
        openFolders.delete(id);
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

function handleFsEvent(evt) {
    // Determine which parent folders need refresh
    const pathsToRefresh = new Set();

    if (evt.path) {
        const parentPath = parentDir(evt.path);
        if (openFolders.has(parentPath)) pathsToRefresh.add(parentPath);
    }
    if (evt.dest_path) {
        const parentPath = parentDir(evt.dest_path);
        if (openFolders.has(parentPath)) pathsToRefresh.add(parentPath);
    }

    // Refresh affected folders (guards in handleListing will drop stale)
    pathsToRefresh.forEach(path => {
        socketManager.listDir(path, excludes);
    });
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
