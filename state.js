'use strict';

// Л5: єдиний Map станів діалогу. Ключ — ctx.from.id.
const userStates = new Map();

function setState(id, state) {
  userStates.set(Number(id), state);
}

function getState(id) {
  return userStates.get(Number(id)) || null;
}

function deleteState(id) {
  return userStates.delete(Number(id));
}

function hasState(id) {
  return userStates.has(Number(id));
}

function clearStates() {
  userStates.clear();
}

module.exports = { userStates, setState, getState, deleteState, hasState, clearStates };
