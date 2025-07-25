// Use Firebase database from window global
const database = window.firebaseDatabase;
if (!database) {
  console.error('Firebase database not initialized');
  document.getElementById('connectionStatus').textContent = 'Error: Firebase database not initialized';
}

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

async function init() {
  if (!database) {
    connectionStatusDiv.textContent = 'Error: Firebase database not available';
    return;
  }

  // Initialize PeerJS
  peer.on('open', async (id) => {
    isInitialized = true;
    myPeerId = id;
    console.log('My peer ID:', id);
    peerInfoDiv.textContent = `My peer ID: ${id} (connected to lobby ${namespace})`;

    // Join Firebase lobby
    await joinLobby(namespace, id);
    // Periodically connect to new peers
    setInterval(connectToLobbyPeers, 15000);
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

  // Clean up on window close
  window.addEventListener('beforeunload', async () => {
    await deregisterPeer(myPeerId);
  });
}

async function joinLobby(lobbyId, peerId) {
  try {
    // Add peer ID to Firebase
    await database.ref(`lobbies/${lobbyId}/peers/${peerId}`).set({
      peerId: peerId,
      timestamp: Date.now()
    });
    console.log(`Joined lobby ${lobbyId} with peer ID: ${peerId}`);

    // Listen for peer list updates
    database.ref(`lobbies/${lobbyId}/peers`).on('value', (snapshot) => {
      const peerData = snapshot.val();
      if (peerData) {
        const peerIds = Object.keys(peerData).filter(id => id !== myPeerId && !peers.has(id));
        console.log('Fetched peer IDs from Firebase:', peerIds);
        connectToLobbyPeers(peerIds);
      }
    });
  } catch (err) {
    connectionStatusDiv.textContent = 'Error joining lobby: ' + err.message;
    console.error('Error joining lobby:', err);
  }
}

async function deregisterPeer(peerId) {
  if (!peerId || !database) return;
  try {
    await database.ref(`lobbies/${namespace}/peers/${peerId}`).remove();
    console.log(`Deregistered peer ${peerId} from lobby ${namespace}`);
  } catch (err) {
    console.error('Error deregistering peer:', err);
  }
}

async function connectToLobbyPeers(peerIds) {
  try {
    if (!peerIds) {
      const snapshot = await database.ref(`lobbies/${namespace}/peers`).once('value');
      peerIds = snapshot.val() ? Object.keys(snapshot.val()).filter(id => id !== myPeerId && !peers.has(id)) : [];
    }
    console.log('Connecting to peer IDs:', peerIds);

    const maxConnections = 10;
    for (const peerId of peerIds.slice(0, maxConnections)) {
      console.log('Initiating connection to:', peerId);
      const conn = peer.connect(peerId);
      setupConnection(conn);
    }
  } catch (err) {
    connectionStatusDiv.textContent = 'Error fetching peers: ' + err.message;
    console.error('Error fetching peers:', err);
  }
}

function setupConnection(conn) {
  conn.on('open', () => {
    peers.add(conn.peer);
    connections.set(conn.peer, conn);
    console.log('Connection open with:', conn.peer);
    conn.send({ type: 'sync', messages: messagesArray });

    conn.on('data', (data) => {
      console.log('Received data from:', conn.peer, data);
      if (data.type === 'sync' || data.type === 'message') {
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