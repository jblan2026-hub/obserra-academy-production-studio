const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("obserraOwner", {
  getSystemSnapshot: () => ipcRenderer.invoke("system:getSnapshot"),
  storeSecret: (key, value) => ipcRenderer.invoke("secrets:set", key, value),
  hasSecret: (key) => ipcRenderer.invoke("secrets:has", key),
  probeConnector: (connector) => ipcRenderer.invoke("connectors:probe", connector)
});
