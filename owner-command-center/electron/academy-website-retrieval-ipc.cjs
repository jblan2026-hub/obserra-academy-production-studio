"use strict";

const { createAcademyWebsiteRetrieval } = require("./academy-website-retrieval.cjs");

function registerAcademyWebsiteRetrievalIpc({ ipcMain, store, safeStorage } = {}) {
  if (!ipcMain || !store || !safeStorage) throw new Error("Academy website retrieval IPC dependencies are required.");
  const retrieval = createAcademyWebsiteRetrieval({ store, safeStorage });
  ipcMain.handle("academy:retrieveWebsiteCourse", async (_event, courseId) => retrieval.retrieveCourse(courseId));
  ipcMain.handle("academy:retrieveWebsiteCertificate", async (_event, certificateId) => retrieval.retrieveCertificate(certificateId));
  return retrieval;
}

module.exports = { registerAcademyWebsiteRetrievalIpc };
