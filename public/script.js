let peer;
let connections = new Map();
let editor;
let currentRoom = null;
let localStream = null;
let isVoiceActive = false;
let isVideoActive = false;

// Initialize the application
async function init() {
    setupEditor();
    await initializePeer();
    setupErrorHandling();
}

// Set up CodeMirror editor
function setupEditor() {
    editor = CodeMirror.fromTextArea(document.getElementById('codeEditor'), {
        mode: 'javascript',
        theme: 'monokai',
        lineNumbers: true,
        autoCloseBrackets: true,
        matchBrackets: true,
        lineWrapping: true,
        tabSize: 2,
        indentWithTabs: false,
        autofocus: true
    });

    editor.on('change', (cm, change) => {
        if (change.origin !== 'remote') {
            broadcastChange(change);
        }
    });
}

// Initialize PeerJS and set up all peer-related event handlers
async function initializePeer() {
    return new Promise((resolve, reject) => {
        peer = new Peer(undefined, {
            host: window.location.hostname,
            port: window.location.port || 3000,
            path: '/peerjs', // Make sure this matches the server path
            debug: 2,
            config: { // Add STUN/TURN servers for better connectivity
                'iceServers': [
                    { url: 'stun:stun.l.google.com:19302' },
                    { url: 'stun:stun1.l.google.com:19302' }
                ]
            }
        });

        peer.on('open', (id) => {
            console.log('Connected with peer ID:', id);
            updateConnectionStatus('Connected', true);
            resolve(id);
        });

        peer.on('connection', handleConnection);

        peer.on('call', handleIncomingCall);

        peer.on('error', (error) => {
            console.error('PeerJS error:', error);
            updateConnectionStatus('Connection Error', false);
            reject(error);
        });

        peer.on('disconnected', () => {
            console.log('Peer disconnected');
            updateConnectionStatus('Disconnected', false);
            // Only try to reconnect if peer hasn't been destroyed
            if (peer && !peer.destroyed) {
                setTimeout(() => {
                    peer.reconnect();
                }, 3000);
            }
        });
    });
}

// Set up error handling
function setupErrorHandling() {
    window.onerror = function(msg, url, lineNo, columnNo, error) {
        console.error('Window Error:', error);
        updateConnectionStatus('Error: ' + msg, false);
        return false;
    };

    window.onunhandledrejection = function(event) {
        console.error('Unhandled Promise Rejection:', event.reason);
        updateConnectionStatus('Promise Error', false);
    };
}

// Update connection status in UI
function updateConnectionStatus(status, isConnected) {
    const statusElement = document.getElementById('status');
    const connectionStatus = document.getElementById('connectionStatus');
    
    statusElement.textContent = status;
    connectionStatus.textContent = status;
    
    statusElement.className = 'status ' + (isConnected ? 'connected' : 'disconnected');
    connectionStatus.style.backgroundColor = isConnected ? '#27ae60' : '#c0392b';
}

// Create a new room
function createRoom() {
    const roomName = document.getElementById('roomInput').value.trim();
    if (!roomName) {
        alert('Please enter a room name');
        return;
    }
    
    currentRoom = roomName;
    document.getElementById('roomId').textContent = `Room: ${roomName}`;
    updateConnectionStatus(`Created room: ${roomName}`, true);
}

// Join an existing room
function joinRoom() {
    const roomName = document.getElementById('roomInput').value.trim();
    if (!roomName) {
        alert('Please enter a room name');
        return;
    }

    currentRoom = roomName;
    document.getElementById('roomId').textContent = `Room: ${roomName}`;
    
    peer.listAllPeers(peers => {
        peers.forEach(peerId => {
            if (peerId !== peer.id) {
                connectToPeer(peerId);
            }
        });
    });
    
    updateConnectionStatus(`Joined room: ${roomName}`, true);
}

// Handle new peer connections
function handleConnection(conn) {
    connections.set(conn.peer, conn);
    updatePeerList();

    conn.on('data', data => {
        if (data.type === 'code-change') {
            applyCodeChange(data.change);
        }
    });

    conn.on('close', () => {
        connections.delete(conn.peer);
        updatePeerList();
        updateConnectionStatus('Peer disconnected', true);
    });

    conn.on('error', (error) => {
        console.error('Connection error:', error);
        connections.delete(conn.peer);
        updatePeerList();
        updateConnectionStatus('Connection error', false);
    });
}

// Connect to a specific peer
function connectToPeer(peerId) {
    if (!connections.has(peerId)) {
        try {
            const conn = peer.connect(peerId);
            handleConnection(conn);
        } catch (error) {
            console.error('Error connecting to peer:', error);
            updateConnectionStatus('Connection failed', false);
        }
    }
}

// Broadcast code changes to all connected peers
// Broadcast code changes to all connected peers
function broadcastChange(change) {
    const simplifiedChange = {
        from: { line: change.from.line, ch: change.from.ch },
        to: { line: change.to.line, ch: change.to.ch },
        text: change.text,
        origin: change.origin
    };
    connections.forEach(conn => {
        try {
            conn.send({
                type: 'code-change',
                change: simplifiedChange
            });
        } catch (error) {
            console.error('Error broadcasting change:', error);
            connections.delete(conn.peer);
            updatePeerList();
        }
    });
}

// Apply received code changes
function applyCodeChange(change) {
    editor.operation(() => {
        try {
            editor.replaceRange(change.text, change.from, change.to, 'remote');
        } catch (error) {
            console.error('Error applying code change:', error);
        }
    });
}

// Update the peer list in the UI
function updatePeerList() {
    const peerList = document.getElementById('peerList');
    peerList.innerHTML = '';
    connections.forEach((_, peerId) => {
        const li = document.createElement('li');
        li.className = 'peer-item';
        li.textContent = `Peer: ${peerId.slice(0, 6)}...`;
        peerList.appendChild(li);
    });
}

// Handle incoming voice calls
function handleIncomingCall(call) {
    if (localStream) {
        call.answer(localStream);
        setupVideoCall(call);
    } else {
        navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            .then(stream => {
                localStream = stream;
                call.answer(localStream);
                setupVideoCall(call);
                isVideoActive = true;
                document.getElementById('videoButton').textContent = 'Stop Video';
            })
            .catch(error => {
                console.error('Error accessing camera/microphone:', error);
                updateConnectionStatus('Camera access denied', false);
            });
    }
}
// Handle video chat toggling
async function toggleVideo() {
    const videoButton = document.getElementById('videoButton');
    
    if (!isVideoActive) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            connections.forEach((_, peerId) => {
                const call = peer.call(peerId, localStream);
                setupVideoCall(call);
            });
            videoButton.textContent = 'Stop Video';
            isVideoActive = true;
            updateConnectionStatus('Video chat active', true);
        } catch (err) {
            console.error('Error accessing camera/microphone:', err);
            updateConnectionStatus('Camera access denied', false);
        }
    } else {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        videoButton.textContent = 'Start Video';
        isVideoActive = false;
        updateConnectionStatus('Video chat stopped', true);
    }
}

// Handle voice chat toggling
async function toggleVoice() {
    const voiceButton = document.getElementById('voiceButton');
    
    if (!isVoiceActive) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            connections.forEach((_, peerId) => {
                const call = peer.call(peerId, localStream);
                setupVoiceCall(call);
            });
            voiceButton.textContent = 'Stop Voice';
            isVoiceActive = true;
            updateConnectionStatus('Voice chat active', true);
        } catch (err) {
            console.error('Error accessing microphone:', err);
            updateConnectionStatus('Microphone access denied', false);
        }
    } else {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        voiceButton.textContent = 'Start Voice';
        isVoiceActive = false;
        updateConnectionStatus('Voice chat stopped', true);
    }
}

// Set up voice call handling
function setupVoiceCall(call) {
    call.on('stream', remoteStream => {
        const audio = new Audio();
        audio.srcObject = remoteStream;
        audio.play().catch(error => {
            console.error('Error playing audio:', error);
        });
    });

    call.on('error', error => {
        console.error('Voice call error:', error);
        updateConnectionStatus('Voice call error', false);
    });

    call.on('close', () => {
        console.log('Voice call ended');
    });
}

// Set up video call handling

function setupVideoCall(call) {
    call.on('stream', remoteStream => {
        const videoElement = document.getElementById('remoteVideo');
        videoElement.srcObject = remoteStream;
        videoElement.play().catch(error => {
            console.error('Error playing video:', error);
        });
    });

    call.on('error', error => {
        console.error('Video call error:', error);
        updateConnectionStatus('Video call error', false);
    });

    call.on('close', () => {
        console.log('Video call ended');
    });
}

// Initialize the application
init().catch(error => {
    console.error('Initialization error:', error);
    updateConnectionStatus('Initialization failed', false);
});