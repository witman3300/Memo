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

/* BOM을 보고 인코딩을 판별해 텍스트로 디코딩 (UTF-16LE/BE, UTF-8) */
function readTextSmart(p) {
  const buf = fs.readFileSync(p);
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return buf.toString('utf16le', 2);
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    const swapped = Buffer.from(buf.slice(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return buf.toString('utf8', 3);
  }
  return buf.toString('utf8');
}

function ensureData() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(dataFile)) {
      let seed = '';
      try { if (fs.existsSync(seedFile)) seed = readTextSmart(seedFile); } catch (e) {}
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
    icon: path.join(__dirname, 'icon.ico'),
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
  try { return readTextSmart(dataFile); } catch (e) { return ''; }
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
