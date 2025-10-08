// socket-manager.js - WebSocket connection and event handling

export class SocketManager {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        
        // Event callbacks
        this.onServerInfo = null;
        this.onRootSet = null;
        this.onListing = null;
        this.onFsEvent = null;
        this.onError = null;
    }
    
    connect() {
        console.log('SocketManager: Connecting...');
        this.socket = io();
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        this.socket.on('connect', () => {
            console.log('✓ WebSocket connected');
            this.isConnected = true;
        });
        
        this.socket.on('disconnect', () => {
            console.log('✗ WebSocket disconnected');
            this.isConnected = false;
        });
        
        this.socket.on('server_info', (data) => {
            if (this.onServerInfo) this.onServerInfo(data);
        });
        
        this.socket.on('root_set', (data) => {
            if (this.onRootSet) this.onRootSet(data);
        });
        
        this.socket.on('listing', (data) => {
            if (this.onListing) this.onListing(data);
        });
        
        this.socket.on('fs_event', (data) => {
            if (this.onFsEvent) this.onFsEvent(data);
        });
        
        this.socket.on('error', (data) => {
            if (this.onError) this.onError(data);
        });
    }
    
    setRoot(path, excludes = []) {
        if (this.isConnected) {
            this.socket.emit('set_root', { path, excludes });
        }
    }
    
    listDir(path, excludes = []) {
        if (this.isConnected) {
            this.socket.emit('list_dir', { path, excludes });
        }
    }
    
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
        }
    }
}