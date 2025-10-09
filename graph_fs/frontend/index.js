// graph_fs/frontend/index.js
// One entry to load vendor libs, then your modules, in the right order.

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// Buffer logs that arrive before EventsPanel is ready.
window.__logQueue = [];
window.logEvent = (msg) => window.__logQueue.push(msg);

(async function boot() {
  // 1) vendor libs
  await loadScript('https://cdn.socket.io/4.8.1/socket.io.min.js');
  await loadScript('https://d3js.org/d3.v7.min.js');

  // 2) app modules (order matters)
  await import('/sidebar/sidebar-manager.js'); // sets up tabs + panels
  await import('/nodes/nodes.js');                   // graph + sockets
  await import('/utility.js');                 // header buttons, theme

  // When EventsPanel finishes initialization it will replace window.logEvent
  // and flush window.__logQueue automatically.
})();
