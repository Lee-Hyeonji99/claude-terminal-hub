'use strict';
// Electron 앱에서만 노출: 네이티브 폴더 선택 (절대경로 반환)
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('claudeHub', {
  isApp: true,
  // 끌어다 놓은 파일의 절대경로. Electron 32+ 는 File.path 가 없어 이것뿐이다.
  filePath: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  pickFolder: (initial) => ipcRenderer.invoke('pick-folder', initial),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  notify: (payload) => ipcRenderer.send('cth-notify', payload),
  // 기다리는 알림 개수 → 작업표시줄 아이콘 배지 ({ count, dataUrl })
  setBadge: (payload) => ipcRenderer.send('cth-badge', payload),
  // 업데이트: 헤더의 버전 팝오버에서 직접 확인/설치할 수 있게 노출
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdateStatus: (cb) => ipcRenderer.on('cth-update-status', (_e, payload) => cb(payload)),
  // 펫: 패널에서 찾은 질문을 넘기고, 펫이 고른 답을 받는다 (public/pet-bridge.js)
  petState: (list) => ipcRenderer.send('pet:state', list),
  petResult: (r) => ipcRenderer.send('pet:result', r),
  onPetAnswer: (cb) => ipcRenderer.on('pet:answer', (_e, payload) => cb(payload)),
  petToggle: () => ipcRenderer.send('pet:toggle'),
  petVisible: () => ipcRenderer.invoke('pet:visible'),
  onPetVisible: (cb) => ipcRenderer.on('pet:visible', (_e, v) => cb(v)),
  // 바탕화면 작업 현황 HUD (electron/hud.js) — 데이터 보내기 · 켜기/끄기
  hudState: (list) => ipcRenderer.send('hud:state', list),
  hudSetVisible: (v) => ipcRenderer.send('hud:set-visible', !!v),
  hudVisible: () => ipcRenderer.invoke('hud:visible'),
  onHudVisible: (cb) => ipcRenderer.on('hud:visible', (_e, v) => cb(v)),
});
