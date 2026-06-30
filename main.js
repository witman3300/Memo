const { app, BrowserWindow, ipcMain, screen, clipboard, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const KAKAO_CANDIDATES = [
  'C:\\Program Files\\Kakao\\KakaoTalk\\KakaoTalk.exe',
  'C:\\Program Files (x86)\\Kakao\\KakaoTalk\\KakaoTalk.exe'
];
function kakaoPath() {
  for (const p of KAKAO_CANDIDATES) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  return null;
}

const dataDir = app.getPath('userData');
const dataFile = path.join(dataDir, 'content.txt');
const seedFile = 'C:\\Users\\lsj\\Desktop\\desktop_memo_content.txt';

function ensureData() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(dataFile)) {
      let seed = '';
      try { if (fs.existsSync(seedFile)) seed = fs.readFileSync(seedFile, 'utf8'); } catch (e) {}
      fs.writeFileSync(dataFile, seed, 'utf8');
    }
  } catch (e) {}
}

let win;
function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea; // 작업표시줄 제외 영역
  win = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: 340,
    height: wa.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenu(null);
  win.loadFile('index.html');
}

ipcMain.handle('memo:load', () => {
  try { return fs.readFileSync(dataFile, 'utf8'); } catch (e) { return ''; }
});
ipcMain.handle('memo:save', (e, text) => {
  try { fs.writeFileSync(dataFile, text, 'utf8'); } catch (err) {}
  return true;
});
ipcMain.handle('win:close', () => { if (win) win.close(); });

ipcMain.handle('kakao:send', (e, text) => {
  try { clipboard.writeText(text || ''); } catch (err) {}
  const kp = kakaoPath();
  try {
    if (kp) shell.openPath(kp);
    else shell.openExternal('kakaotalk://');
  } catch (err) {}
  return !!kp;
});

app.whenReady().then(() => { ensureData(); createWindow(); });
app.on('window-all-closed', () => { app.quit(); });
