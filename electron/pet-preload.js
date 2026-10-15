'use strict';
// 펫 창 전용 브리지. 허브 창과는 main 프로세스를 거쳐서만 이야기한다.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  filePath: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  // { project:{id,name,cwd,hue}, questions:[...], done:[...] }
  onState: (cb) => ipcRenderer.on('pet:state', (_e, data) => cb(data)),
  onResult: (cb) => ipcRenderer.on('pet:result', (_e, r) => cb(r)),
  // 창 안에서 펫·카드를 어디 그릴지 ({ pet:{x,y}, card:{x,y}|null })
  onLayout: (cb) => ipcRenderer.on('pet:layout', (_e, l) => cb(l)),
  answer: (payload) => ipcRenderer.send('pet:answer', payload),
  // 카드 크기(접혀 있으면 0) — main 이 자리를 골라 창을 맞춘다
  resize: (w, h) => ipcRenderer.send('pet:resize', { w, h }),
  hide: () => ipcRenderer.send('pet:hide'),
  // 펫 팩 폴더 고르기 (네이티브 폴더 선택기, 절대경로)
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  drag: () => ipcRenderer.send('pet:drag'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
});
