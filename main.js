const { app, BrowserWindow, ipcMain, screen, clipboard, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const { createAuth } = require('./gauth');
const { createStore } = require('./store');
const { createDrive } = require('./drive-api');

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

function readLocal() { try { return readTextSmart(dataFile); } catch (e) { return ''; } }
function writeLocal(text) { try { fs.writeFileSync(dataFile, text, 'utf8'); } catch (e) {} }

/* ===================== 구글 드라이브 동기화 ===================== */
const auth = createAuth(dataDir);
const store = createStore(dataDir);
const drive = createDrive(() => auth.getAccessToken(), {
  get: (k) => store.get(k),
  set: (k, v) => store.set(k, v)
});

const AUTO_SYNC_MS = 60 * 1000;
let syncTimer = null;
let syncing = false;
let lastSync = { status: 'idle', at: 0, message: '' };

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function statusPayload() {
  return {
    configured: auth.isConfigured(),
    linked: auth.isLinked(),
    syncing,
    lastStatus: lastSync.status,
    lastAt: lastSync.at,
    message: lastSync.message
  };
}

async function runSync(reason) {
  if (!auth.isLinked() || syncing) return statusPayload();
  syncing = true;
  send('drive:status', statusPayload());
  try {
    const local = readLocal();
    const r = await drive.sync(local);
    if (r.status === 'pulled') {
      writeLocal(r.content);
      send('drive:pulled', r.content);
    }
    lastSync = {
      status: r.status,
      at: Date.now(),
      message: r.status === 'conflict'
        ? ('충돌 — 드라이브 사본을 ' + (r.backupName || '별도 파일') + ' 로 백업했습니다')
        : ''
    };
  } catch (e) {
    lastSync = { status: 'error', at: Date.now(), message: e.message || String(e) };
  }
  syncing = false;
  const s = statusPayload();
  send('drive:status', s);
  return s;
}

function startAutoSync() {
  if (syncTimer) clearInterval(syncTimer);
  if (!auth.isLinked()) return;
  syncTimer = setInterval(() => runSync('timer'), AUTO_SYNC_MS);
  runSync('start');
}

/* ===================== 창 ===================== */
let win;
let setupWin = null;

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

function openSetup() {
  if (setupWin && !setupWin.isDestroyed()) { setupWin.focus(); return; }
  setupWin = new BrowserWindow({
    width: 520,
    height: 560,
    title: '구글 드라이브 연결',
    icon: path.join(__dirname, 'icon.ico'),
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  setupWin.setMenu(null);
  setupWin.loadFile('setup.html');
  setupWin.on('closed', () => { setupWin = null; });
}

/* ===================== IPC ===================== */
ipcMain.handle('memo:load', () => readLocal());
ipcMain.handle('memo:save', (e, text) => {
  writeLocal(text);
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

ipcMain.handle('app:openUrl', (e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
  return true;
});

ipcMain.handle('drive:status', () => statusPayload());
ipcMain.handle('drive:openSetup', () => { openSetup(); return true; });
ipcMain.handle('drive:configure', (e, clientId, clientSecret) => {
  auth.configure(clientId, clientSecret);
  send('drive:status', statusPayload());
  return statusPayload();
});
ipcMain.handle('drive:login', async () => {
  try {
    await auth.login();
    lastSync = { status: 'idle', at: 0, message: '' };
    startAutoSync();
    if (setupWin && !setupWin.isDestroyed()) setupWin.close();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});
ipcMain.handle('drive:logout', async () => {
  await auth.logout();
  store.clear();
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  send('drive:status', statusPayload());
  return statusPayload();
});
ipcMain.handle('drive:sync', () => runSync('manual'));
ipcMain.handle('drive:openFolder', async () => {
  try {
    const m = await drive.ensureFile(readLocal());
    await shell.openExternal('https://drive.google.com/file/d/' + m.id + '/view');
    return true;
  } catch (e) { return false; }
});

/* ===================== 시작 ===================== */
app.whenReady().then(() => {
  ensureData();
  createWindow();
  startAutoSync();
});
app.on('window-all-closed', () => { app.quit(); });
