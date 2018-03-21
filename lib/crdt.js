"use strict";


const MAX_REPLICA_ID_BITS = 16


//Function to create a replicated string for each edit a user does 
function CRDT(id) {
  this.id = id
  this.left = { 
    timestamp: -1, 
    removed: false, // set to true is other users have deleted the character chr
    chr: "" 
  }

  //Initialize a Map to map the nodes to their timestamp
  this.index = new Map([[this.left.timestamp, this.left]])
  this.nextTimestamp = id
  this.subscribers = []
}

CRDT.toArray = function (crdt) {
  let ary = []
    , curr = crdt.left

  while (curr) {
    ary.push(curr)
    curr = curr.next
  }

  return ary
}

CRDT.prototype = {
  constructor: CRDT

//Specific operation that is performed is broadcasted to other replicated
  , subscribe: function (callback) {
    this.subscribers.push(callback)
  }

//function to genegrate the timestamp for each operation performed
  , genTimestamp: function () {
    const timestamp = this.nextTimestamp
    this.nextTimestamp += (1 << MAX_REPLICA_ID_BITS)
    return timestamp
  }

//create a new node for the operation, generate the timestamp for the operation, 
//add the generated timestamp and the new node to the index( map created)
//return the new node created
  , addRight: function (op) {
    const existingNode = this.index.get(op.t)
    let prev = this.index.get(op.prev)
      , newNode

    if (existingNode) { return }

    while (op.t >= this.nextTimestamp) { this.genTimestamp() }

    while (prev.next && op.t < prev.next.timestamp) { prev = prev.next }

    newNode = {
      next: prev.next,
      timestamp: op.t,
      chr: op.chr,
      removed: false
    }

    prev.next = newNode
    this.index.set(op.t, newNode)

    return newNode
  }

//removes a node from the map for a given operation timestamp 
  , remove: function (op) {
    const node = this.index.get(op.t)

    if (node.removed) { return }

    node.removed = true
    return node
  }

  , apply: function(op) {
    return this[op.type].call(this, op)
  }

  , downstream: function (op, originator) {
    const node = this.apply(op)

    if (node) {
      this.subscribers.forEach(sub => {
        if (sub !== originator) { sub.downstream(op) }
      })
    }

    return node
  }

// Return an array of operations that are performed in the document
  , history: function () {
    let hist = []
      , prev = this.left
      , curr = prev.next

    while (curr) {
      hist.push({
        type: 'addRight',
        prev: prev.timestamp,
        t: curr.timestamp,
        chr: curr.chr
      });

      if (curr.removed) {
        hist.push({type: 'remove', t: curr.timestamp})
      }

      prev = curr
      curr = curr.next
    }

    return hist
  }
}


function RArray(crdt) {
  this.ary = CRDT.toArray(crdt)
  this.compactedAry = this.ary.filter(({removed}) => { return !removed })
}

RArray.prototype = {
  text: function() {
    return this.compactedAry.map(({chr}) => { return chr }).join('')
  }

  , indexOrPrev: function(node) {
    let idx = this.ary.indexOf(node)

    while (idx >= 0 && node.removed) {
      idx = idx - 1
      node = this.ary[idx]
    }

    return this.compactedAry.indexOf(node)
  }

  , get: function(idx) {
    return this.compactedAry[idx]
  }
}


CRDT.AceEditorCRDT = function AceEditorCRDT(id, editor) {
  let crdt = new CRDT(id)
    , emitContentChanged = true
    , bufferOperations = false
    , operationsBuffer = []

  editor.$blockScrolling = Infinity

  const {session, selection} = editor
    , Doc = session.doc.constructor

  const contentInserted = (from, change) => {
    const ary = new RArray(crdt).compactedAry

    let node = ary[from] || crdt.left

    change.forEach(chr => {
      node = crdt.downstream({
        type: 'addRight',
        prev: node.timestamp,
        t: crdt.genTimestamp(),
        chr: chr
      })
    })
  }

  const contentRemoved = (from, change) => {
    const ary = new RArray(crdt).compactedAry

    ary.slice(from, from + change.length).forEach(node => {
      crdt.downstream({ type: 'remove', t: node.timestamp, chr : node.chr  })
    })
  }

  const contentChanged = ({ action, start, end, lines }) => {
    if (!emitContentChanged) { return }

    const from = session.doc.positionToIndex(start)
      , change = lines.join("\n").split('')

    if (action === 'insert') {
      contentInserted(from, change)
    } else if (action === 'remove') {
      contentRemoved(from + 1, change)
    }
  }

  let nodeSelection = { startNode: crdt.left, endNode: crdt.left }
  const cursorChanged = () => {
    if (!emitContentChanged) { return }

    const { start, end } = selection.getRange()
      , crdtAry = new RArray(crdt)
      , doc = new Doc(crdtAry.text())
      , startIndex = doc.positionToIndex(start)
      , startNode = crdtAry.get(startIndex)
      , endIndex = doc.positionToIndex(end)
      , endNode = crdtAry.get(endIndex)

    nodeSelection = { startNode: startNode, endNode: endNode }
  }

  const syncEditor = _ => {
    emitContentChanged = false

    try {
      const crdtAry = new RArray(crdt)
        , text = crdtAry.text()
        , doc = new Doc(text)
        , { startNode, endNode } = nodeSelection
        , startIndex = crdtAry.indexOrPrev(startNode)
        , endIndex  = crdtAry.indexOrPrev(endNode)
        , rangeStart = doc.indexToPosition(startIndex)
        , rangeEnd = doc.indexToPosition(endIndex)
        , range = { start: rangeStart, end: rangeEnd }

      // Setting the document with the changed text  
      session.doc.setValue(text)
      selection.setSelectionRange(range)
    } finally {
      //emit the contents changed
      emitContentChanged = true
    }
  }

//clear buffer
  const flushBuffer = () => {
    this.applyHistory(operationsBuffer)
    bufferOperations = false
    operationsBuffer = []
  }

  const { onCompositionStart, onCompositionEnd } = editor
  editor.onCompositionStart = () => {
    bufferOperations = true
    onCompositionStart.apply(editor, [])
  }

  editor.onCompositionEnd = () => {
    try {
      onCompositionEnd.apply(editor, [])
    } finally {
      setTimeout(flushBuffer, 100)
    }
  }

  // Callbacks
  session.on('change', contentChanged)
  selection.on('changeCursor', cursorChanged)

  // Public interface
  this.applyOperation = (op) => {
    if (bufferOperations) {
      operationsBuffer.push(op)
    } else {
      crdt.apply(op)
      syncEditor()
    }
  }

  this.applyHistory = (history) => {
    history.forEach(op => crdt.apply(op))
    syncEditor()
  }

  this.subscribe = (sub) => { crdt.subscribe(sub) }
}


if (typeof module !== 'undefined') { exports = module.exports = CRDT }
