"use strict";

//Including the required packeges

var express = require("express")
var mongoose = require("mongoose")
var bodyParser = require("body-parser")
var app = express()
var http = require("http").Server(app)
var io = require("socket.io")(http)
var CRDT = require('./lib/crdt.js')
var port = 3020
var crdt = new CRDT(0)

//connectinon string to the database setup in mLabs
var conString = "mongodb://admin:admin@ds038319.mlab.com:38319/mylearning"


app.use(express.static('lib'))
app.use(express.static(__dirname))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))
app.use(express.static('node_modules/ace-builds/src-noconflict'))

mongoose.Promise = Promise

//Schema for the chats
var Chats = mongoose.model("Chats", {
    name: String,
    chat: String
})

//connect to the database using the connection string
mongoose.connect(conString, { useMongoClient: true }, (err) => {
    console.log("Database connection", err)
})

//Redirect to the index.html file 
app.get('/', function (req, res) {
  res.sendFile(__dirname + "/index.html");
})

let nextUserId = 1

io.on('connection', function (socket) {
  //Assinging the user Id's for every new connection
  var userId = nextUserId++;

  socket.userId = userId;
  
  console.log("connection - assigning id " + userId);
  socket.emit("init", {id: userId, history: crdt.history()})

  socket.downstream = socket.emit.bind(socket, "change")
  //subscribing to a particular socket
  crdt.subscribe(socket)

  socket.on('change', op => { 
   console.log("TextEdit : user " + socket.userId + " : " + "Prev Node Id: " + op.prev + " : " + "Node Id: " + op.t + " : " + op.type + " : " + op.chr);
    crdt.downstream(op, socket) })
})

//updating the chat data on to the database
app.post("/chats", async (req, res) => {
    try {
      console.log("Chat : user " + req.body.userId + " : " + req.body.chat);
        var chat = new Chats(req.body)
        await chat.save()
        res.sendStatus(200)
        io.emit("chat", req.body)
    } catch (error) {
        res.sendStatus(500)
        console.error(error)
    }
})

//selecting all the chats and sendinga response to the frontend
app.get("/chats", (req, res) => {
    Chats.find({}, (error, chats) => {
        res.send(chats)
    })
})

//Connecting to the socket
io.on("connection", (socket) => {
    console.log("Socket is connected...")
})

//server listening to the code
var server = http.listen(3020, () => {
    console.log("Well done, now I am listening on ", server.address().port)
})