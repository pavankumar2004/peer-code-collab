const express = require('express');
const { ExpressPeerServer } = require('peer');
const app = express();

// Create HTTP server
const server = require('http').createServer(app);

// Serve static files
app.use(express.static('public'));

// Set up PeerJS server with correct configuration
const peerServer = ExpressPeerServer(server, {
    debug: true,
    path: '/', // Changed from '/peerjs'
    allow_discovery: true
});

// Use peerServer
app.use('/peerjs', peerServer); // This sets up /peerjs as the path

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`PeerJS server running on /peerjs`);
});

// Handle PeerJS events
peerServer.on('connection', (client) => {
    console.log('Client connected:', client.getId());
});

peerServer.on('disconnect', (client) => {
    console.log('Client disconnected:', client.getId());
});