const { app, BrowserWindow, desktopCapturer, ipcMain } = require('electron');
// DesktopCapture - used for the screen recording / screen sharing.
// app - process controller
// BrowserWindow - Chrome tab into desktop window. 
// ipcMain - Enable the between main process & renderer ( backend, frontend communication like API )

// Electron = Rnederer(Frontend + UI) + Main Process(brain-Backend)
const path = require('path');

// Main LOgic:  Disable hardware acceleration to bypass DRM(digital Rights Managemnt) "black screens" (if decoding encrypted streams)
app.disableHardwareAcceleration();

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 850,
    webPreferences: {
      nodeIntegration: true, // enable the htm/css to use ther NodeJs
      webviewTag: true // used to embed external sites
    }
  });

  mainWindow.loadFile('index.html'); // loaads the frontend. 
}

app.whenReady().then(createWindow); // the createWindow is run when the App is Ready. 

app.on('window-all-closed', () => { // here .on is like When THIS happens → DO THIS as in default in other Os here by closing all the window the app dosent Quit in MacOS. 
  if (process.platform !== 'darwin') app.quit();  // darwin means MacOS When all windows close: If NOT Mac → quit app, If Mac → keep app running  default it can be left empty. 
});

// IPC Handler securely providing access to local window/desktop sources
ipcMain.handle('get-sources', async () => {
    return await desktopCapturer.getSources({ types: ['window', 'screen'] });
});
//ipcMain → lives in main process, .handle → used for request-response type communication.
// 'get-sources' is like API endpoint name. 
// window for the individual app and Screen for like full screen etc. 
