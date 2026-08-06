const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("obserraOwner", {
  getSystemSnapshot: () => ipcRenderer.invoke("system:getSnapshot"),
  listConnectors: () => ipcRenderer.invoke("connectors:list"),
  probeConnector: (id) => ipcRenderer.invoke("connectors:probe", id),
  probeAllConnectors: () => ipcRenderer.invoke("connectors:probeAll"),
  configureConnector: (payload) => ipcRenderer.invoke("connectors:configure", payload),
  getAcademySnapshot: () => ipcRenderer.invoke("academy:getSnapshot"),
  updateAcademyCourse: (payload) => ipcRenderer.invoke("academy:updateCourse", payload),
  runAcademyAction: (payload) => ipcRenderer.invoke("academy:runAction", payload),
  previewAcademyCourse: (courseId) => ipcRenderer.invoke("academy:previewCourse", courseId),
  previewAcademyMaterials: (courseId) => ipcRenderer.invoke("academy:previewMaterials", courseId),
  previewAcademyCertificate: (courseId) => ipcRenderer.invoke("academy:previewCertificate", courseId),
  getOwnerAISnapshot: () => ipcRenderer.invoke("ownerAI:getSnapshot"),
  analyzeOwnerAINow: () => ipcRenderer.invoke("ownerAI:analyzeNow"),
  rememberOwnerAI: (payload) => ipcRenderer.invoke("ownerAI:remember", payload),
  decideOwnerAIApproval: (payload) => ipcRenderer.invoke("ownerAI:decideApproval", payload),
  acknowledgeOwnerAIRecommendation: (id) => ipcRenderer.invoke("ownerAI:acknowledgeRecommendation", id),
  exportRecoveryBundle: (passphrase) => ipcRenderer.invoke("recovery:export", passphrase),
  importRecoveryBundle: (passphrase) => ipcRenderer.invoke("recovery:import", passphrase)
});
