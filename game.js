const namespace = 'chatapp_1';
const peer = new Peer({
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
});
const peerCount = document.getElementById('peerCount');
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const peerIdInput = document.getElementById('peerIdInput');
const peerInfoDiv = document.getElementById('peerInfo');
const connectionStatusDiv = document.getElementById('connectionStatus');
let peers = new Set();
let messagesArray = [];
let connections = new Map();
let isInitialized = false;
let myPeerId = null;
let lobbyPeers = new Map(); // Track peers in the lobby by namespace

function init() {
  peer.on('open', (id) => {
    isInitialized = true;
    myPeerId = id;
    console.log('My peer ID:', id);
    peerInfoDiv.textContent = `My peer ID: ${id} (join lobby ${namespace} to connect)`;
    joinLobby(namespace, id); // Join the lobby with my peer ID
    updateUI();
  });

  peer.on('connection', (conn) => {
    console.log('Incoming connection from:', conn.peer);
    setupConnection(conn);
  });

  peer.on('error', (err) => {
    connectionStatusDiv.textContent = 'PeerJS error: ' + err.message;
    console.error('PeerJS error:', err);
  });
}

function joinLobby(lobbyId, peerId) {
  if (!lobbyPeers.has(lobbyId)) {
    lobbyPeers.set(lobbyId, new Set());
  }
  lobbyPeers.get(lobbyId).add(peerId);
  console.log(`Joined lobby ${lobbyId} with peer ID: ${peerId}`);
  // Share lobby membership with connected peers
  broadcastMessage({ type: 'lobby_update', lobbyId: lobbyId, peerId: peerId });
}

function setupConnection(conn) {
  conn.on('open', () => {
    peers.add(conn.peer);
    connections.set(conn.peer, conn);
    console.log('Connection open with:', conn.peer);
    // Send current message history and lobby info to the new peer
    conn.send({ type: 'sync', messages: messagesArray });
    conn.send({ type: 'lobby_update', lobbyId: namespace, peerId: myPeerId });

    conn.on('data', (data) => {
      console.log('Received data from:', conn.peer, data);
      if (data.type === 'lobby_update' && data.lobbyId && data.peerId) {
        if (data.lobbyId === namespace && !peers.has(data.peerId)) {
          console.log('Discovered peer in lobby:', data.peerId);
          joinLobby(data.lobbyId, data.peerId); // Update local lobby tracking
          if (data.peerId !== myPeerId && !connections.has(data.peerId)) {
            console.log('Initiating back-connection to lobby peer:', data.peerId);
            const backConn = peer.connect(data.peerId);
            backConn.on('open', () => {
              console.log('Back-connection open to:', data.peerId);
              connections.set(data.peerId, backConn);
              backConn.send({ type: 'sync', messages: messagesArray });
              updateUI();
            });
            backConn.on('error', (err) => {
              connectionStatusDiv.textContent = 'Back-connection error: ' + err.message;
              console.error('Back-connection error:', err);
            });
          }
        }
      } else if (data.type === 'sync' || data.type === 'message') {
        console.log('Received messages:', data.messages.length);
        data.messages.forEach((m) => {
          if (!messagesArray.some((existing) => existing.id === m.id)) {
            messagesArray.push(m);
          }
        });
        messagesArray.sort((a, b) => a.timestamp - b.timestamp);
        updateUI();
      }
    });

    conn.on('close', () => {
      console.log('Connection closed with:', conn.peer);
      peers.delete(conn.peer);
      connections.delete(conn.peer);
      // Remove from lobby if tracked
      lobbyPeers.forEach((peerSet, lobbyId) => {
        if (peerSet.has(conn.peer)) {
          peerSet.delete(conn.peer);
          console.log(`Removed ${conn.peer} from lobby ${lobbyId}`);
        }
      });
      updateUI();
    });

    conn.on('error', (err) => {
      connectionStatusDiv.textContent = 'Connection error: ' + err.message;
      console.error('Connection error:', err);
    });

    updateUI();
  });
}

function connectToPeer() {
  if (!isInitialized) {
    connectionStatusDiv.textContent = 'Error: Peer not initialized. Wait a moment and try again.';
    return;
  }
  const peerId = peerIdInput.value.trim();
  if (!peerId || peerId === myPeerId) {
    connectionStatusDiv.textContent = 'Error: Invalid peer ID.';
    return;
  }
  if (peers.has(peerId)) {
    connectionStatusDiv.textContent = 'Error: Already connected to this peer.';
    return;
  }
  const conn = peer.connect(peerId);
  console.log('Attempting to connect to:', peerId);
  setupConnection(conn);
  peerIdInput.value = '';
}

function sendMessage() {
  if (!isInitialized) {
    connectionStatusDiv.textContent = 'Error: Peer not initialized. Wait a moment and try again.';
    return;
  }
  const text = messageInput.value.trim();
  if (!text) {
    connectionStatusDiv.textContent = 'Error: Message cannot be empty.';
    return;
  }
  const message = {
    id: `${myPeerId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    peerId: myPeerId,
    text: text,
    timestamp: Date.now(),
  };
  messagesArray.push(message);
  messagesArray.sort((a, b) => a.timestamp - b.timestamp);
  broadcastMessage({ type: 'message', messages: [message] });
  messageInput.value = '';
  updateUI();
}

function broadcastMessage(data) {
  console.log('Broadcasting message to connections:', connections.size);
  connections.forEach((conn, peerId) => {
    if (conn.open) {
      console.log('Sending to:', peerId);
      conn.send(data);
    } else {
      console.log('Connection to', peerId, 'is closed, removing');
      peers.delete(peerId);
      connections.delete(peerId);
    }
  });
  updateUI();
}

function updateUI() {
  peerCount.textContent = peers.size + (myPeerId ? 1 : 0);
  chatMessages.innerHTML = messagesArray
    .map((m) => {
      const isMyMessage = m.peerId === myPeerId;
      return `<li${isMyMessage ? ' class="my-message"' : ''}>${m.peerId}: ${m.text}</li>`;
    })
    .join('');
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

window.sendMessage = sendMessage;
window.connectToPeer = connectToPeer;
init();