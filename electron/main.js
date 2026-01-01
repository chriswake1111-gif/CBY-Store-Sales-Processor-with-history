
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// Prevent garbage collection
let mainWindow;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: "分店獎金計算系統",
    webPreferences: {
      nodeIntegration: true, // In a real production app with external content, this should be false
      contextIsolation: false, // Simplifying for this specific internal tool use-case
      webSecurity: false // Optional: allows loading local files if needed later
    }
  });

  // Check if we are in development mode
  const isDev = !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools(); // Open DevTools in dev mode
  } else {
    // In production, load the built index.html
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    
    // Remove default menu bar in production for a cleaner look
    Menu.setApplicationMenu(null);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
