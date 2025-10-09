// socket-manager.js - Multi-root socket communication
export class SocketManager {
    constructor() {
        this.socket = null;
        this.isConnected = false;

        this.onServerInfo = null;
        this.onRootAdded = null;
        this.onRootRemoved = null;
        this.onRootsList = null;
        this.onListing = null;
        this.onFsEvent = null;
        this.onWatchAck = null;
        this.onError = null;
        
        // Legacy callback for backward compatibility
        this.onRootSet = null;
    }

    connect() {
        this.socket = io();
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.socket.on('connect', () => { this.isConnected = true; });
        this.socket.on('disconnect', () => { this.isConnected = false; });

        this.socket.on('server_info', (d) => { this.onServerInfo?.(d); });
        
        // Multi-root events
        this.socket.on('root_added', (d) => { 
            this.onRootAdded?.(d);
            // Legacy support
            if (this.onRootSet) this.onRootSet(d);
        });
        this.socket.on('root_removed', (d) => { this.onRootRemoved?.(d); });
        this.socket.on('roots_list', (d) => { this.onRootsList?.(d); });
        
        this.socket.on('listing',    (d) => { this.onListing?.(d); });
        this.socket.on('fs_event',   (d) => { this.onFsEvent?.(d); });
        this.socket.on('watch_ack',  (d) => { this.onWatchAck?.(d); });
        this.socket.on('error',      (d) => { this.onError?.(d); });
    }

    // Multi-root API
    addRoot(path, excludes = []) { 
        if (this.isConnected) this.socket.emit('add_root', { path, excludes }); 
    }
    
    removeRoot(path) {
        if (this.isConnected) this.socket.emit('remove_root', { path });
    }
    
    listRoots() {
        if (this.isConnected) this.socket.emit('list_roots', {});
    }

    // Legacy support (maps to addRoot)
    setRoot(path, excludes = []) { 
        this.addRoot(path, excludes);
    }

    listDir(path, excludes = []) { 
        if (this.isConnected) this.socket.emit('list_dir', { path, excludes }); 
    }

    watchEnable(path, recursive = true) {
        if (this.isConnected) this.socket.emit('watch_enable', { path, recursive });
    }
    
    watchDisable(path = null) {
        if (this.isConnected) this.socket.emit('watch_disable', { path });
    }

    disconnect() { 
        if (this.socket) { 
            this.socket.disconnect(); 
            this.socket = null; 
            this.isConnected = false; 
        } 
    }
}