'use strict';
// Electron 앱에서만 노출: 네이티브 폴더 선택 (절대경로 반환)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeHub', {
  isApp: true,
  pickFolder: (initial) => ipcRenderer.invoke('pick-folder', initial),
  pickFile: () => ipcRenderer.invoke('pick-file'),
});
