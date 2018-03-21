"use strict";

const express = require('express')
  , app = express()
  , server = require('http').Server(app)
  , io = require('socket.io')(server)
  , CRDT = require('./lib/crdt.js')
  , port = 3021 //Number(process.env.PORT) || 5000
  , crdt = new CRDT(0)




app.use(express.static('lib'))
//app.use(express.static('node_modules/ace-builds/src-noconflict'))

app.get('/', function (req, res) {
  res.sendFile(__dirname + "/index.html");
})




let nextUserId = 1

io.on('connection', function (socket) {
  var userId = nextUserId++;

  console.log("connection - assigning id " + userId);
  socket.emit("init", {id: userId, history: rga.history()})

  socket.downstream = socket.emit.bind(socket, "change")
  rga.subscribe(socket)

  socket.on('change', op => { rga.downstream(op, socket) })
})



server.listen(port, function () {
  console.log('listening on *:' + port);
})
