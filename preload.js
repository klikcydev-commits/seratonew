'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  scan: (folders) => ipcRenderer.invoke('library:scan', folders),
  match: (text) => ipcRenderer.invoke('library:match', text),
  search: (query) => ipcRenderer.invoke('library:search', query),
  writeCrates: (payload) => ipcRenderer.invoke('crates:write', payload),
  exportReport: (payload) => ipcRenderer.invoke('report:export', payload),
  collectFiles: (payload) => ipcRenderer.invoke('files:collect', payload),
  reveal: (target) => ipcRenderer.invoke('shell:reveal', target),
  importFile: () => ipcRenderer.invoke('import:dialog'),
  importDropped: (name, bytes) => ipcRenderer.invoke('import:bytes', name, bytes),
  onLinkStatus: on('links:status'),
  onScanProgress: on('library:progress'),
  onCopyProgress: on('files:progress'),
});
