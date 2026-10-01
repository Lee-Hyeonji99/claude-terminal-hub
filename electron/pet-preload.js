'use strict';
// 펫 창 전용 브리지. 허브 창과는 main 프로세스를 거쳐서만 이야기한다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  onState: (cb) => ipcRenderer.on('pet:state', (_e, list) => cb(list)),
  onResult: (cb) => ipcRenderer.on('pet:result', (_e, r) => cb(r)),
  answer: (payload) => ipcRenderer.send('pet:answer', payload),
  resize: (width, height) => ipcRenderer.send('pet:resize', { width, height }),
  hide: () => ipcRenderer.send('pet:hide'),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  drag: () => ipcRenderer.send('pet:drag'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
});
