import { app, BrowserWindow } from 'electron';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 920,
    height: 620,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadFile(resolve(fixtureDirectory, 'index.html'));
  window.show();
});

app.on('window-all-closed', () => app.quit());
