const { app, BrowserWindow } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const { startServer } = require('./server/index.js');

let mainWindow;
let serverInstance;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1000,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: "OH BLOG - 네이버 블로그 SEO 분석",
    icon: path.join(__dirname, 'client/public/favicon.ico')
  });

  // Load the web app
  mainWindow.loadURL(
    isDev
      ? 'http://localhost:5173'
      : `file://${path.join(__dirname, 'client/dist/index.html')}`
  );

  if (isDev) {
    // mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => (mainWindow = null));
}

async function initializeApp() {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'ohblog.db');
    
    try {
        // Start the Express server directly in the main process
        serverInstance = await startServer(5001, dbPath);
        console.log('Integrated server started successfully.');
    } catch (err) {
        console.error('Failed to start integrated server:', err);
    }
    
    createWindow();
}

app.on('ready', initializeApp);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
