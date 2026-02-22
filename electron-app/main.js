'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const store = require('./src/store');
const VoteAutomation = require('./src/automation');

let mainWindow = null;
const automation = new VoteAutomation(store);

// Forward automation events to renderer
automation.on('log', entry => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('automation-log', entry);
    }
});

automation.on('status', status => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('automation-status', status);
    }
});

automation.on('captcha', data => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('automation-captcha', data);
    }
});

automation.on('vote-result', data => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('automation-vote-result', data);
    }
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 700,
        resizable: true,
        title: 'Auto Vote Rating',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// IPC handlers
ipcMain.handle('get-settings', () => store.get('settings'));

ipcMain.handle('save-settings', (event, settings) => {
    store.set('settings', settings);
    return true;
});

ipcMain.handle('get-projects', () => store.get('projects', []));

ipcMain.handle('add-project', (event, project) => {
    const projects = store.get('projects', []);
    const newProject = {
        key: Date.now().toString(),
        rating: project.rating,
        id: project.id,
        nick: project.nick || '',
        enabled: true,
        nextVoteTime: null
    };
    projects.push(newProject);
    store.set('projects', projects);
    return newProject;
});

ipcMain.handle('remove-project', (event, key) => {
    const projects = store.get('projects', []);
    store.set('projects', projects.filter(p => p.key !== key));
    return true;
});

ipcMain.handle('toggle-project', (event, key) => {
    const projects = store.get('projects', []);
    const idx = projects.findIndex(p => p.key === key);
    if (idx !== -1) {
        projects[idx].enabled = !projects[idx].enabled;
        store.set('projects', projects);
        return projects[idx].enabled;
    }
    return null;
});

ipcMain.handle('start-automation', async () => {
    await automation.start();
    return true;
});

ipcMain.handle('stop-automation', async () => {
    await automation.stop();
    return true;
});

ipcMain.handle('captcha-resolved', () => {
    automation.resolveCaptcha();
    return true;
});

ipcMain.handle('get-logs', () => store.get('logs', []));

ipcMain.handle('clear-logs', () => {
    store.set('logs', []);
    return true;
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
    if (automation.running) {
        await automation.stop();
    }
});
