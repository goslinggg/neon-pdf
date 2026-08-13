const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
let mainWindow;
let pendingPdfPath = process.argv.find((arg) => arg.toLowerCase().endsWith('.pdf'));
if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 620,
    backgroundColor: '#07111f',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#07111f', symbolColor: '#8bbfff', height: 38 },
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
  });
  mainWindow.loadFile('index.html');
  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingPdfPath) mainWindow.webContents.send('open-file', pendingPdfPath);
  });
  return mainWindow;
}

app.whenReady().then(() => {
  ipcMain.handle('open-pdf', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Открыть PDF', properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (canceled || !filePaths[0]) return null;
    const filePath = filePaths[0];
    return { name: path.basename(filePath), path: filePath };
  });
  ipcMain.handle('read-pdf', async (_, filePath) => {
    const data = await fs.readFile(filePath);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  });
  ipcMain.handle('save-pdf', async (_, { sourcePath, annotations }) => {
    const { canceled, filePath } = await dialog.showSaveDialog({ title: 'Сохранить PDF с пометками', defaultPath: `${path.basename(sourcePath, '.pdf')} — пометки.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (canceled || !filePath) return false;
    const pdf = await PDFDocument.load(await fs.readFile(sourcePath));
    const pdfPages = pdf.getPages();
    for (const annotation of annotations) {
      if (!annotation || !pdfPages[annotation.page - 1]) continue;
      const image = await pdf.embedPng(Buffer.from(annotation.png.split(',')[1], 'base64'));
      const target = pdfPages[annotation.page - 1];
      target.drawImage(image, { x: 0, y: 0, width: target.getWidth(), height: target.getHeight() });
    }
    await fs.writeFile(filePath, await pdf.save());
    return filePath;
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Файл', submenu: [{ label: 'Открыть PDF…', accelerator: 'Ctrl+O', click: () => mainWindow.webContents.send('request-open') }, { label: 'Сохранить с пометками…', accelerator: 'Ctrl+S', click: () => mainWindow.webContents.send('request-save') }, { type: 'separator' }, { role: 'quit', label: 'Выход' }] }]));
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length || createWindow());
});
app.on('second-instance', (_, argv) => { const file = argv.find((arg) => arg.toLowerCase().endsWith('.pdf')); if (file) { pendingPdfPath = file; mainWindow?.show(); mainWindow?.webContents.send('open-file', file); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
