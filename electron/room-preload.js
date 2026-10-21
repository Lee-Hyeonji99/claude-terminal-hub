'use strict';
// 작업실 창 전용 브리지. 허브 창과는 main 프로세스를 거쳐서만 이야기한다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('roomApi', {
  // HUD 와 같은 항목 [{ key, title, project, state, since, tool, target, subagents, question, doneAt, ... }]
  onState: (cb) => ipcRenderer.on('hud:state', (_e, list) => cb(list)),
  onSettings: (cb) => ipcRenderer.on('room:settings', (_e, s) => cb(s)),   // { onTop }
  focus: (key) => ipcRenderer.send('room:focus', key),
  setTop: (v) => ipcRenderer.send('room:set-top', !!v),
  hide: () => ipcRenderer.send('room:hide'),
  dragStart: () => ipcRenderer.send('room:drag-start'),
  drag: () => ipcRenderer.send('room:drag'),
  dragEnd: () => ipcRenderer.send('room:drag-end'),
});
