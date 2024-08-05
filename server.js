const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { main } = require('./index'); // Assuming your main script is in index.js

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('generate-report', async () => {
    try {
      const statusReport = await main();
      socket.emit('report-generated', statusReport);
    } catch (error) {
      socket.emit('error', error.message);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

const PORT = process.env.PORT || 3600;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));