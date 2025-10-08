// socket-manager.js
export class SocketManager {
    constructor() {
        this.socket = null;
        this.isConnected = false;

        this.onServerInfo = null;
        this.onRootSet = null;
        this.onListing = null;
        this.onFsEvent = null;
        this.onWatchAck = null;
        this.onError = null;
    }

    connect() {
        this.socket = io();
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.socket.on('connect', () => { this.isConnected = true; });
        this.socket.on('disconnect', () => { this.isConnected = false; });

        this.socket.on('server_info', (d) => { this.onServerInfo?.(d); });
        this.socket.on('root_set',   (d) => { this.onRootSet?.(d); });
        this.socket.on('listing',    (d) => { this.onListing?.(d); });
        this.socket.on('fs_event',   (d) => { this.onFsEvent?.(d); });
        this.socket.on('watch_ack',  (d) => { this.onWatchAck?.(d); });
        this.socket.on('error',      (d) => { this.onError?.(d); });
    }

    setRoot(path, excludes = []) { if (this.isConnected) this.socket.emit('set_root', { path, excludes }); }
    listDir(path, excludes = []) { if (this.isConnected) this.socket.emit('list_dir', { path, excludes }); }

    watchEnable(path, recursive = true) {
        if (this.isConnected) this.socket.emit('watch_enable', { path, recursive });
    }
    watchDisable(path = null) {
        if (this.isConnected) this.socket.emit('watch_disable', { path });
    }

    disconnect() { if (this.socket) { this.socket.disconnect(); this.socket = null; this.isConnected = false; } }
}
