// mounts a traditional folder view overlay that mirrors graph state
const OVERLAY_ID = 'tree-overlay';

function init() {
  ensureHost();
  render();

  // stay in sync with nodes.js; support both legacy and new selection events
  [
    'graphfs:root_added',
    'graphfs:root_removed',
    'graphfs:listing_applied',
    'graphfs:open_state_changed',
    'graphfs:selection_changed',   // legacy
    'graphfs:selected_files',      // current
    'graphfs:app_state'
  ].forEach(ev => document.addEventListener(ev, render));
}

// run whether or not DOMContentLoaded already fired
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

function ensureHost() {
  if (!document.getElementById(OVERLAY_ID)) {
    const host = document.createElement('div');
    host.id = OVERLAY_ID;
    const pane = document.getElementById('graph-pane');
    if (!pane) return; // hard guard
    pane.appendChild(host);
  }
}

function render() {
  const host = document.getElementById(OVERLAY_ID);
  if (!host) return;

  const getRoots = window.__graphfs_getRoots?.() || [];
  const state = window.__graphfs_export?.();
  if (!state) { host.innerHTML = ''; return; }

  const { nodesMap, openFolders } = state;
  host.innerHTML = '';

  getRoots.forEach(r => {
    const sec = el('div','overlay-root');
    const header = el('div','overlay-root-header', r.name || r.path);
    sec.appendChild(header);

    const rootNode = nodesMap.get(r.path);
    if (!rootNode) return;

    sec.appendChild(makeRow(rootNode, state));

    if (openFolders.has(r.path)) {
      const ul = el('ul','overlay-list');
      fillChildren(ul, r.path, 1, state);
      sec.appendChild(ul);
    }

    host.appendChild(sec);
  });
}

function fillChildren(ul, parentPath, depth, s) {
  const parent = s.nodesMap.get(parentPath);
  if (!parent || !parent.children) return;

  parent.children
    .sort((a,b)=> (a.type===b.type ? a.nodeName.localeCompare(b.nodeName) : a.type==='folder' ? -1 : 1))
    .forEach(ch => {
      const li = el('li','overlay-item');
      li.style.setProperty('--depth', depth);
      li.appendChild(makeRow(ch, s));
      if (ch.type==='folder' && s.openFolders.has(ch.id)) {
        const ul2 = el('ul','overlay-list');
        fillChildren(ul2, ch.id, depth+1, s);
        li.appendChild(ul2);
      }
      ul.appendChild(li);
    });
}

function makeRow(node, s = window.__graphfs_export?.()) {
  // Only apply "selected" class for FILES; folders never get selection styling
  const isSelectedRow = node.type === 'file' && node.selected;
  const row = el(
    'div',
    `overlay-row ${node.type} ${node.isOpen ? 'open' : ''} ${isSelectedRow ? 'selected' : ''}`.trim()
  );
  row.dataset.path = node.id;

  const caret = el('span', `caret ${node.type==='folder' ? (node.isOpen?'open':'closed') : 'empty'}`);
  const name = el('span', 'name', node.nodeName);
  row.append(caret, name);

  row.addEventListener('click', (e) => {
    e.stopPropagation();
    if (node.type === 'folder') {
      window.expandCollapsePath?.(node.isOpen ? 'collapse' : 'expand', node.id);
    } else {
      window.toggleSelectFileByPath?.(node.id);
    }
  });

  return row;
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
