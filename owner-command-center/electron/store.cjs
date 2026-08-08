const Store = require("electron-store");

let ownerCommandCenterStore = null;

function getOwnerCommandCenterStore() {
  if (!ownerCommandCenterStore) {
    ownerCommandCenterStore = new Store({ name: "owner-command-center" });
  }
  return ownerCommandCenterStore;
}

module.exports = { getOwnerCommandCenterStore };
