const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memoAPI', {
  load: () => ipcRenderer.invoke('memo:load'),
  save: (t) => ipcRenderer.invoke('memo:save', t),
  close: () => ipcRenderer.invoke('win:close'),
  kakaoSend: (t) => ipcRenderer.invoke('kakao:send', t)
});
