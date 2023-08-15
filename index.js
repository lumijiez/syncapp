const express = require('express');
const expressWs = require('express-ws');
const bodyParser = require('body-parser');
const dotenv = require('dotenv').config();
const { v4: uuidv4 } = require('uuid');

// Express Initialization + WS piggyback
const app = express();
expressWs(app);

// Middlewares
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Server startup
const server = app.listen(process.env.SERVER_PORT, () => {
  console.log(`Server on port ${process.env.SERVER_PORT}`);
});

// Client mapping
const clients = new Map();
const rooms = new Map();
const room_hosts = new Map();
const room_links = new Map();

// Websocket handlers
app.ws('/ws', (ws, req) => {
  // Generates an unique ID
  const id = uuidv4();
  const clientData = { id: id, name: 'Guest', client: ws };
  clients.set(id, clientData);
  let clientRoom;

  // Sets the ID for a new connection
  const response = { command: 'set_id', id: id };
  const responseJson = JSON.stringify(response);
  ws.send(responseJson);

  ws.on('message', (message) => {
    const msg = JSON.parse(message);

    // Null command handler
    if (msg.command == null) {
      const response = { error: 'Bad command.' };
      const responseJson = JSON.stringify(response);
      ws.send(responseJson);
    }

    if (msg.command == 'sync') {
      syncClients(msg.room_id, msg.time);
    }

    // Sets the client into a room
    if (msg.command == 'set_room') {
      clientRoom = msg.room_id;
      if (rooms.get(msg.room_id) != null) {
        rooms.get(msg.room_id).push(clients.get(msg.id));
      } else {
        rooms.set(msg.room_id, [clients.get(msg.id)]);
      }
      if (room_hosts.get(msg.room_id) == null) {
        room_hosts.set(msg.room_id, id);
      }
      refreshAllClients(rooms, clientRoom);
    }

    if (msg.command == 'set_link') {
      room_links[clientRoom] = msg.link;
      refreshAllClients(rooms, clientRoom);
    }

    if (msg.command == 'pause') {
      broadcastCommand(msg.room_id, 'pause', msg.client_id);
    }

    if (msg.command == 'play') {
      broadcastCommand(msg.room_id, 'play', msg.client_id);
    }

    // Websocket command to switch hosts
    if (msg.command == 'make_host') {
      if (room_hosts.get(msg.room_id) != msg.id) {
        room_hosts.set(msg.room_id, msg.id);
        refreshAllClients(rooms, clientRoom);
      }
    }

    if (msg.command == 'sync_with_host') {
      if (clients.get(room_hosts.get(msg.room_id)) != null) {
        const response = { command: 'sync_with_me' };
        const responseJson = JSON.stringify(response);
        clients.get(room_hosts.get(msg.room_id)).client.send(responseJson);
      }
    }

    // Websocket command to change a name
    if (msg.command == 'change_name') {
      clients.get(id).name = msg.name;
      refreshAllClients(rooms, clientRoom);
    }

    // Websocket command to send a global message
    if (msg.command == 'global') {
      broadcastRoom(msg.room_id, msg.message, msg.name);
    }

    // Websocket command to send a text to a specific client
    if (msg.command == 'text_id') {
      const id = msg.id;
      const response = {
        command: 'message',
        message: msg.name + ': ' + msg.message,
      };
      const responseJson = JSON.stringify(response);
      clients.get(id).client.send(responseJson);
    }
  });

  // On close, deletes the client data and randomizes a new host, if it exists
  ws.on('close', (data) => {
    clients.delete(id);
    if (rooms.has(clientRoom)) {
      const clients = rooms.get(clientRoom);
      const updatedClients = clients.filter((client) => client.id !== id);
      if (updatedClients.length == 0) {
        rooms.delete(clientRoom);
        randomizeHost(clientRoom);
        return;
      }
      rooms.set(clientRoom, updatedClients);
    }

    randomizeHost(clientRoom);
    refreshAllClients(rooms, clientRoom);
  });
});

// Chooses a random host on call
function randomizeHost(room_id) {
  if (rooms.has(room_id)) {
    const newHost =
      rooms.get(room_id)[Math.floor(Math.random() * rooms.get(room_id).length)];
    room_hosts.set(room_id, newHost.id);
  } else {
    room_hosts.delete(room_id);
  }
}

function refreshAllClients(rooms, room_id) {
  const response = { command: 'refresh' };
  const responseJson = JSON.stringify(response);
  for (const client of rooms.get(room_id)) {
    client.client.send(responseJson);
  }
}

function syncClients(room_id, time) {
  const response = { command: 'sync', time: time };
  const responseJson = JSON.stringify(response);
  for (const client of rooms.get(room_id)) {
    client.client.send(responseJson);
  }
}

function broadcastCommand(room_id, command, client_id) {
  const response = { command: command };
  const responseJson = JSON.stringify(response);
  for (const client of rooms.get(room_id)) {
    if (client.id != client_id) client.client.send(responseJson);
  }
}

// function broadcastLink(room_id, link) {
//   const response = { command: 'set_link', link: link };
//   const responseJson = JSON.stringify(response);
//   for (const client of rooms.get(room_id)) {
//     client.client.send(responseJson);
//   }
// }

function broadcastRoom(room_id, message, name) {
  const response = { command: 'global', message: name + ': ' + message };
  const responseJson = JSON.stringify(response);
  for (const client of rooms.get(room_id)) {
    client.client.send(responseJson);
  }
}

// Collects information about all clients
function getClientsJson(room_id) {
  const clts = [];
  for (const client of rooms.get(room_id)) {
    const js = { id: client.id, name: client.name };
    clts.push(js);
  }
  return JSON.stringify(clts);
}

// Collects and sends back updated data
app.post('/api/refresh', (req, res) => {
  const data = req.body;
  const client = clients.get(data.id);
  const isHost = client.id == room_hosts.get(data.room_id) ? true : false;
  const toSend = {
    host: isHost,
    name: client.name,
    client_data: getClientsJson(data.room_id),
    link: room_links[data.room_id],
  };
  res.json(toSend).status(200);
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/client.html');
});

app.get('/api/file/:folder/:filename', (req, res) => {
  res.sendFile(__dirname + '/' + req.params.folder + '/' + req.params.filename);
});
