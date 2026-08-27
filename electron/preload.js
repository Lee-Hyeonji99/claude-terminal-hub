'use strict';
// Electron 앱에서만 노출: 네이티브 폴더 선택 (절대경로 반환)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeHub', {
  isApp: true,
  pickFolder: (initial) => ipcRenderer.invoke('pick-folder', initial),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  notify: (payload) => ipcRenderer.send('cth-notify', payload),
  // 업데이트: 헤더의 버전 팝오버에서 직접 확인/설치할 수 있게 노출
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdateStatus: (cb) => ipcRenderer.on('cth-update-status', (_e, payload) => cb(payload)),
});
