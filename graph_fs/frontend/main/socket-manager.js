// socket-manager.js - Multi-root socket communication + app state/favourites
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
        // App state / favourites
        this.onAppState = null;
        this.onFavoriteToggled = null;
        // Legacy callback for backward compatibility
        this.onRootSet = null;
    }

    connect() {
        this.socket = io();
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.socket.on('connect', () => {
            this.isConnected = true;
            // Request app state immediately after connection to ensure roots are loaded
            setTimeout(() => {
                if (this.isConnected) {
                    this.getAppState();
                }
            }, 100);
        });
        
        this.socket.on('disconnect', () => { this.isConnected = false; });

        this.socket.on('server_info', (d) => { this.onServerInfo?.(d); });

        // Multi-root events
        this.socket.on('root_added', (d) => {
            this.onRootAdded?.(d);
            if (this.onRootSet) this.onRootSet(d);
        });
        this.socket.on('root_removed', (d) => { this.onRootRemoved?.(d); });
        this.socket.on('roots_list', (d) => { this.onRootsList?.(d); });
        this.socket.on('listing',   (d) => { this.onListing?.(d); });
        this.socket.on('fs_event',  (d) => { this.onFsEvent?.(d); });
        this.socket.on('watch_ack', (d) => { this.onWatchAck?.(d); });
        this.socket.on('error',     (d) => { this.onError?.(d); });

        // App state / favourites
        this.socket.on('app_state',         (d) => { this.onAppState?.(d); });
        this.socket.on('favorite_toggled',  (d) => { this.onFavoriteToggled?.(d); });
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
    listDir(path, excludes = []) {
        if (this.isConnected) this.socket.emit('list_dir', { path, excludes });
    }
    watchEnable(path, recursive = true) {
        if (this.isConnected) this.socket.emit('watch_enable', { path, recursive });
    }
    watchDisable(path = null) {
        if (this.isConnected) this.socket.emit('watch_disable', { path });
    }

    // App state / favourites API
    getAppState() {
        if (this.isConnected) this.socket.emit('get_app_state', {});
    }
    toggleFavoriteRoot(path) {
        if (this.isConnected) this.socket.emit('toggle_favorite_root', { path });
    }

    // Cleanup
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
        }
    }
}