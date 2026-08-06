const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("obserraOwner", {
  getSystemSnapshot: () => ipcRenderer.invoke("system:getSnapshot"),
  listConnectors: () => ipcRenderer.invoke("connectors:list"),
  probeConnector: (id) => ipcRenderer.invoke("connectors:probe", id),
  probeAllConnectors: () => ipcRenderer.invoke("connectors:probeAll"),
  configureConnector: (payload) => ipcRenderer.invoke("connectors:configure", payload),
  exportRecoveryBundle: (passphrase) => ipcRenderer.invoke("recovery:export", passphrase),
  importRecoveryBundle: (passphrase) => ipcRenderer.invoke("recovery:import", passphrase)
});
