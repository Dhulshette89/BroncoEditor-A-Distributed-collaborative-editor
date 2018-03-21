"use strict";

//Coverting the DOM element with id being "editor" to an editor
var editor = ace.edit('editor')
var socket = io()

let crdt

socket.downstream = socket.emit.bind(socket, "change")

socket.on('init', ({ id, history }) => {
  if (!crdt) {
    editor.setWrapBehavioursEnabled(false)
    crdt = new CRDT.AceEditorCRDT(id, editor)

    //subscribe to a common socket
    crdt.subscribe(socket)
    //applying all the changes made and binding it to the currrent instance
    socket.on('change', crdt.applyOperation.bind(crdt))
  }

  crdt.applyHistory(history)
  //setting the cursor focus back
  editor.focus()
});

