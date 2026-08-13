const { contextBridge, ipcRenderer } = require('electron');
const pdfjsRoot = process.resourcesPath.endsWith('resources') ? `${process.resourcesPath}/pdfjs` : `${process.cwd()}/node_modules/pdfjs-dist/build`;
const pdfjsUrl = new URL(`file:///${pdfjsRoot.replaceAll('\\', '/')}/pdf.mjs`).href;
contextBridge.exposeInMainWorld('neonPdf', {
  openPdf: () => ipcRenderer.invoke('open-pdf'), readPdf: (filePath) => ipcRenderer.invoke('read-pdf', filePath),
  savePdf: (payload) => ipcRenderer.invoke('save-pdf', payload), pdfjsUrl,
  onOpenFile: (callback) => ipcRenderer.on('open-file', (_, filePath) => callback(filePath)), onRequestOpen: (callback) => ipcRenderer.on('request-open', callback), onRequestSave: (callback) => ipcRenderer.on('request-save', callback)
});
