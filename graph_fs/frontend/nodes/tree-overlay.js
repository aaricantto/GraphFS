// mounts a traditional folder view overlay that mirrors graph state
const OVERLAY_ID = 'tree-overlay';

let iconResolver = null;
let triedLoad = false;

class MaterialIconResolver {
  constructor(manifest) {
    this.iconsBaseUrl = 'https://unpkg.com/material-icon-theme@5.27.0/icons/';
    this.defs = manifest.iconDefinitions || {};
    this.fileDef = manifest.file || null;
    this.folderDef = manifest.folder || null;
    this.folderOpenDef = manifest.folderExpanded || null;
    this.fileNames = lowerKeyMap(manifest.fileNames || {});
    this.fileExts = lowerKeyMap(manifest.fileExtensions || {});
    this.langIds = lowerKeyMap(manifest.languageIds || {});
    this.folderNames = lowerKeyMap(manifest.folderNames || {});
    this.folderNamesExp = lowerKeyMap(manifest.folderNamesExpanded || {});
  }

  iconPathFromDef(defKey) {
    if (!defKey) return null;
    const def = this.defs[defKey];
    if (!def) return null;
    let iconPath = String(def.iconPath || '');
    let filename = iconPath.replace(/^\.\//, '').replace(/^icons\//, '');
    return `${this.iconsBaseUrl}${filename}`;
  }

  folderIcon(name, isOpen) {
    const key = (name || '').toLowerCase();
    const named = isOpen ? this.folderNamesExp[key] : this.folderNames[key];
    if (named) return this.iconPathFromDef(named);
    return this.iconPathFromDef(isOpen ? (this.folderOpenDef || this.folderDef) : this.folderDef);
  }

  fileIcon(name) {
    const lower = (name || '').toLowerCase();
    
    // 1. Check exact filename
    if (this.fileNames[lower]) {
      return this.iconPathFromDef(this.fileNames[lower]);
    }

    // 2. Check extensions (longest first: "spec.ts" before "ts")
    const parts = lower.split('.');
    if (parts.length > 1) {
      for (let i = 1; i < parts.length; i++) {
        const ext = parts.slice(i).join('.');
        if (this.fileExts[ext]) {
          return this.iconPathFromDef(this.fileExts[ext]);
        }
      }
    }

    // 3. Check language ID
    const lang = guessLanguageId(lower);
    if (lang && this.langIds[lang]) {
      return this.iconPathFromDef(this.langIds[lang]);
    }

    // 4. Default
    return this.iconPathFromDef(this.fileDef);
  }
}

function lowerKeyMap(obj) {
  const out = Object.create(null);
  for (const k in obj) out[k.toLowerCase()] = obj[k];
  return out;
}

function guessLanguageId(filename) {
  if (filename.endsWith('.js') || filename.endsWith('.mjs') || filename.endsWith('.cjs')) return 'javascript';
  if (filename.endsWith('.jsx')) return 'javascriptreact';
  if (filename.endsWith('.ts') || filename.endsWith('.mts') || filename.endsWith('.cts')) return 'typescript';
  if (filename.endsWith('.tsx')) return 'typescriptreact';
  if (filename.endsWith('.html') || filename.endsWith('.htm')) return 'html';
  if (filename.endsWith('.css')) return 'css';
  if (filename.endsWith('.json') || filename.endsWith('.jsonc')) return 'json';
  if (filename.endsWith('.md') || filename.endsWith('.markdown')) return 'markdown';
  if (filename.endsWith('.py')) return 'python';
  if (filename.endsWith('.yml') || filename.endsWith('.yaml')) return 'yaml';
  if (filename.endsWith('.ipynb')) return 'jupyter';
  return null;
}

async function ensureResolver() {
  if (iconResolver || triedLoad) return;
  triedLoad = true;

  try {
    const response = await fetch('https://unpkg.com/material-icon-theme@5.27.0/dist/material-icons.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const manifest = await response.json();
    if (!manifest?.iconDefinitions) throw new Error('Invalid manifest');

    iconResolver = new MaterialIconResolver(manifest);
    console.log('[icons] Loaded', Object.keys(manifest.iconDefinitions).length, 'icons');
  } catch (err) {
    console.warn('[icons] Failed to load icons:', err.message);
  }
}

function init() {
  ensureHost();
  ensureResolver().then(() => render());
  render();

  [
    'graphfs:root_added',
    'graphfs:root_removed',
    'graphfs:listing_applied',
    'graphfs:open_state_changed',
    'graphfs:selection_changed',
    'graphfs:selected_files',
    'graphfs:app_state'
  ].forEach(ev => document.addEventListener(ev, render));
}

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
    if (pane) pane.appendChild(host);
  }
}

function render() {
  const host = document.getElementById(OVERLAY_ID);
  if (!host) return;

  const getRoots = window.__graphfs_getRoots?.() || [];
  const state = window.__graphfs_export?.();
  if (!state) { 
    host.innerHTML = ''; 
    return; 
  }

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
  if (!parent?.children) return;

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
  const isSelectedRow = node.type === 'file' && node.selected;
  const row = el(
    'div',
    `overlay-row ${node.type} ${node.isOpen ? 'open' : ''} ${isSelectedRow ? 'selected' : ''}`.trim()
  );
  row.dataset.path = node.id;

  const caret = el('span', `caret ${node.type==='folder' ? (node.isOpen?'open':'closed') : 'empty'}`);
  const icon = makeIconFor(node);
  const name = el('span', 'name', node.nodeName);
  row.append(caret, icon, name);

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

function makeIconFor(node) {
  if (iconResolver) {
    let url = null;
    if (node.type === 'folder') {
      url = iconResolver.folderIcon(node.nodeName, !!node.isOpen);
    } else {
      url = iconResolver.fileIcon(node.nodeName);
    }
    if (url) {
      const img = document.createElement('img');
      img.className = 'micon-img';
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      img.src = url;
      return img;
    }
  }

  // Fallback: Material Symbols font
  const span = document.createElement('span');
  span.className = 'micon-font material-symbols-outlined';
  if (node.type === 'folder') {
    span.textContent = node.isOpen ? 'folder_open' : 'folder';
  } else {
    const ext = getExt(node.nodeName);
    span.textContent = pickFileIcon(ext);
  }
  return span;
}

function getExt(name = '') {
  const m = name.toLowerCase().match(/\.([a-z0-9.]+)$/);
  return m ? m[1] : '';
}

function pickFileIcon(ext) {
  const codeSet = new Set(['js','jsx','ts','tsx','mjs','cjs','jsonc','py','rb','go','rs','c','h','cpp','hpp','cs','java','kt','swift','php','scala','sh','bash','zsh','ps1','lua','r']);
  const docSet  = new Set(['md','markdown','rst','txt','rtf']);
  const dataSet = new Set(['json','yml','yaml','toml','ini','csv','ndjson']);
  const imgSet  = new Set(['png','jpg','jpeg','gif','webp','svg','bmp','ico','avif']);
  const vidSet  = new Set(['mp4','mov','mkv','webm','avi']);
  const audSet  = new Set(['mp3','wav','ogg','flac','m4a']);
  if (codeSet.has(ext)) return 'code';
  if (docSet.has(ext))  return 'article';
  if (dataSet.has(ext)) return 'data_object';
  if (imgSet.has(ext))  return 'image';
  if (vidSet.has(ext))  return 'movie';
  if (audSet.has(ext))  return 'music_note';
  if (ext === 'pdf')    return 'picture_as_pdf';
  if (['zip','tar','gz','tgz','7z'].includes(ext)) return 'inventory_2';
  return 'description';
}