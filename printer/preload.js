// The one thing the PMS page may ask of the Fidato Printer app: print what it
// has drawn, on 80 mm paper this many mm long. See main.js.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fidatoPrinter", {
  print: (heightMm) => ipcRenderer.invoke("fidato-print", { heightMm }),
});
