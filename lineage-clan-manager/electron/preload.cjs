"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Expose fixed operations, never arbitrary channels or filesystem paths.
contextBridge.exposeInMainWorld(
  "clanDesktop",
  Object.freeze({
    load: () => ipcRenderer.invoke("clan:load"),
    save: (data, revision) => ipcRenderer.invoke("clan:save", data, revision),
    exportBackup: () => ipcRenderer.invoke("clan:export-backup"),
    importBackup: (revision) =>
      ipcRenderer.invoke("clan:import-backup", revision),
  }),
);
