'use strict';
// 바탕화면 HUD 창 전용 브리지. 허브 창과는 main 프로세스를 거쳐서만 이야기한다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hudApi', {
  // [{ key, title, project, projectKey, hue, character, profile, state, since, tool, target }]
  onState: (cb) => ipcRenderer.on('hud:state', (_e, list) => cb(list)),
  // { scale, locked } — 기억해 둔 비율·이동 잠금
  onSettings: (cb) => ipcRenderer.on('hud:settings', (_e, s) => cb(s)),
  focus: (key) => ipcRenderer.send('hud:focus', key),
  resize: (w, h) => ipcRenderer.send('hud:resize', { w, h }),
  dragStart: () => ipcRenderer.send('hud:drag-start'),
  drag: () => ipcRenderer.send('hud:drag'),
  dragEnd: () => ipcRenderer.send('hud:drag-end'),
  setLock: (v) => ipcRenderer.send('hud:set-lock', !!v),
  setScale: (k) => ipcRenderer.send('hud:set-scale', k),
  hide: () => ipcRenderer.send('hud:hide'),
});
