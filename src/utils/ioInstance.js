// Shared io instance — set once from server.js, used by controllers for broadcasting
let _io = null;

module.exports = {
  setIo: (io) => { _io = io; },
  getIo: () => _io,
};
