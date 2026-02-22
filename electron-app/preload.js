'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('avr', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    getProjects: () => ipcRenderer.invoke('get-projects'),
    addProject: (project) => ipcRenderer.invoke('add-project', project),
    removeProject: (key) => ipcRenderer.invoke('remove-project', key),
    toggleProject: (key) => ipcRenderer.invoke('toggle-project', key),
    startAutomation: () => ipcRenderer.invoke('start-automation'),
    stopAutomation: () => ipcRenderer.invoke('stop-automation'),
    captchaResolved: () => ipcRenderer.invoke('captcha-resolved'),
    getLogs: () => ipcRenderer.invoke('get-logs'),
    clearLogs: () => ipcRenderer.invoke('clear-logs'),
    onLog: (callback) => ipcRenderer.on('automation-log', (_event, data) => callback(data)),
    onStatus: (callback) => ipcRenderer.on('automation-status', (_event, data) => callback(data)),
    onCaptcha: (callback) => ipcRenderer.on('automation-captcha', (_event, data) => callback(data)),
    onVoteResult: (callback) => ipcRenderer.on('automation-vote-result', (_event, data) => callback(data))
});
