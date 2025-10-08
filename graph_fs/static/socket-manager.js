// socket-manager.js - WebSocket connection and event handling
export class SocketManager {
    constructor() {
        this.socket = null;
        this.isConnected = false;

        this.onServerInfo = null;
        this.onRootSet = null;
        this.onListing = null;
        this.onFsEvent = null;
        this.onError = null;
    }

    connect() {
        this.socket = io();
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.socket.on('connect', () => { this.isConnected = true; });
        this.socket.on('disconnect', () => { this.isConnected = false; });

        this.socket.on('server_info', (d) => { if (this.onServerInfo) this.onServerInfo(d); });
        this.socket.on('root_set',   (d) => { if (this.onRootSet) this.onRootSet(d); });
        this.socket.on('listing',    (d) => { if (this.onListing) this.onListing(d); });
        this.socket.on('fs_event',   (d) => { if (this.onFsEvent) this.onFsEvent(d); });
        this.socket.on('error',      (d) => { if (this.onError) this.onError(d); });
    }

    setRoot(path, excludes = []) { if (this.isConnected) this.socket.emit('set_root', { path, excludes }); }
    listDir(path, excludes = []) { if (this.isConnected) this.socket.emit('list_dir', { path, excludes }); }
    disconnect() { if (this.socket) { this.socket.disconnect(); this.socket = null; this.isConnected = false; } }
}
