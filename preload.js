const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memoAPI', {
  load: () => ipcRenderer.invoke('memo:load'),
  save: (t) => ipcRenderer.invoke('memo:save', t),
  close: () => ipcRenderer.invoke('win:close'),
  kakaoSend: (t) => ipcRenderer.invoke('kakao:send', t)
});

contextBridge.exposeInMainWorld('driveAPI', {
  status: () => ipcRenderer.invoke('drive:status'),
  openUrl: (u) => ipcRenderer.invoke('app:openUrl', u),
  openSetup: () => ipcRenderer.invoke('drive:openSetup'),
  configure: (id, secret) => ipcRenderer.invoke('drive:configure', id, secret),
  login: () => ipcRenderer.invoke('drive:login'),
  logout: () => ipcRenderer.invoke('drive:logout'),
  sync: () => ipcRenderer.invoke('drive:sync'),
  openFolder: () => ipcRenderer.invoke('drive:openFolder'),
  onStatus: (cb) => ipcRenderer.on('drive:status', (e, s) => cb(s)),
  onPulled: (cb) => ipcRenderer.on('drive:pulled', (e, text) => cb(text))
});
