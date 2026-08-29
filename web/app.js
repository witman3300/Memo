'use strict';

/* =========================================================================
 * app.js — 모바일 메모 웹앱 (PWA)
 *   로컬(localStorage) 저장 + 구글 드라이브 양방향 동기화
 * =======================================================================*/

const C = window.MemoCore;
const CFG = window.MEMO_CONFIG || {};
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const LS_CONTENT = 'memo:content';
const LS_SKIP = 'memo:skipLogin';

const view = document.getElementById('view');
const edit = document.getElementById('edit');
const syncBtn = document.getElementById('syncBtn');
const editBtn = document.getElementById('editBtn');
const doneBtn = document.getElementById('doneBtn');
const gate = document.getElementById('gate');

let content = localStorage.getItem(LS_CONTENT) || '';
const undoStack = [];
let editing = false;
let syncing = false;
let syncTimer = null;
let saveTimer = null;

/* ===================== 토스트 ===================== */
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ===================== 로컬 저장 ===================== */
function saveLocal(text) {
  content = text;
  try { localStorage.setItem(LS_CONTENT, text); } catch (e) {}
}
function renderView() { view.innerHTML = C.renderHtml(content); }
function pushUndo(prev) { undoStack.push(prev); if (undoStack.length > 50) undoStack.shift(); }

/* 편집 후 잠깐 기다렸다가 드라이브로 올린다 */
function scheduleSync() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (auth.linked()) runSync(); }, 2500);
}

/* ===================== 구글 인증 (GIS 토큰 클라이언트) ===================== */
const auth = (function () {
  let tokenClient = null;
  let accessToken = '';
  let expiry = 0;

  function ready() {
    return !!(window.google && google.accounts && google.accounts.oauth2);
  }
  function client() {
    if (tokenClient) return tokenClient;
    if (!ready()) return null;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.CLIENT_ID,
      scope: SCOPE,
      callback: () => {}
    });
    return tokenClient;
  }
  function linked() { return localStorage.getItem('memo:linked') === '1'; }

  /* prompt: 'consent'(최초) 또는 ''(자동 갱신) */
  function request(prompt) {
    return new Promise((resolve, reject) => {
      const tc = client();
      if (!tc) { reject(new Error('구글 로그인 스크립트를 아직 불러오지 못했습니다.')); return; }
      tc.callback = (res) => {
        if (res && res.access_token) {
          accessToken = res.access_token;
          expiry = Date.now() + (res.expires_in || 3600) * 1000 - 60000;
          localStorage.setItem('memo:linked', '1');
          resolve(accessToken);
        } else {
          reject(new Error((res && res.error) || '토큰을 받지 못했습니다.'));
        }
      };
      tc.error_callback = (err) => reject(new Error((err && err.type) || '로그인이 취소됐습니다.'));
      try { tc.requestAccessToken({ prompt: prompt }); }
      catch (e) { reject(e); }
    });
  }

  async function getAccessToken() {
    if (accessToken && Date.now() < expiry) return accessToken;
    /* 조용한 갱신 시도 → 실패하면 호출자가 [연결] 버튼을 안내한다 */
    return request('');
  }

  async function login() {
    await request('consent');
    return true;
  }
  function logout() {
    if (accessToken && ready()) {
      try { google.accounts.oauth2.revoke(accessToken, () => {}); } catch (e) {}
    }
    accessToken = ''; expiry = 0;
    localStorage.removeItem('memo:linked');
    localStorage.removeItem('memo:folderId');
    localStorage.removeItem('memo:fileId');
    localStorage.removeItem('memo:lastModified');
    localStorage.removeItem('memo:lastContent');
  }

  return { linked, login, logout, getAccessToken, ready };
})();

/* ===================== 드라이브 ===================== */
const store = {
  get: (k) => {
    const v = localStorage.getItem('memo:' + k);
    return v === null ? undefined : v;
  },
  set: (k, v) => { try { localStorage.setItem('memo:' + k, v); } catch (e) {} return v; }
};
const drive = window.DriveAPI.createDrive(() => auth.getAccessToken(), store);

function setSyncState(cls, title) {
  syncBtn.classList.remove('off', 'ok', 'busy', 'err');
  syncBtn.classList.add(cls);
  syncBtn.title = title;
}

async function runSync(opts) {
  opts = opts || {};
  if (syncing || !auth.linked()) return;
  if (!navigator.onLine) { setSyncState('off', '오프라인'); return; }
  syncing = true;
  setSyncState('busy', '동기화 중…');
  try {
    const r = await drive.sync(content);
    if (r.status === 'pulled') {
      if (editing) {
        showToast('드라이브에 새 메모가 있습니다 — 편집을 끝내면 반영됩니다');
      } else {
        saveLocal(r.content);
        renderView();
        if (opts.loud) showToast('드라이브에서 메모를 가져왔습니다');
      }
    } else if (r.status === 'conflict') {
      showToast('충돌 — 드라이브 사본을 ' + (r.backupName || '별도 파일') + ' 로 백업했습니다');
    } else if (opts.loud) {
      showToast(r.status === 'pushed' ? '드라이브에 저장했습니다' : '이미 최신입니다');
    }
    setSyncState('ok', '동기화됨');
  } catch (e) {
    setSyncState('err', '동기화 오류: ' + e.message);
    if (opts.loud) showToast('동기화 실패 — ' + e.message);
  }
  syncing = false;
}

/* ===================== 편집 ===================== */
function startEdit() {
  pushUndo(content);
  editing = true;
  edit.value = content;
  view.style.display = 'none';
  edit.style.display = 'block';
  editBtn.style.display = 'none';
  doneBtn.style.display = 'flex';
  edit.focus();
}
function endEdit() {
  editing = false;
  saveLocal(C.normalizeOnSave(edit.value));
  renderView();
  edit.style.display = 'none';
  view.style.display = 'block';
  doneBtn.style.display = 'none';
  editBtn.style.display = 'flex';
  scheduleSync();
}

/* ===================== 이벤트 ===================== */
view.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.classList && t.classList.contains('cb')) {
    const idx = parseInt(t.getAttribute('data-idx'), 10);
    const next = C.toggleDone(content, idx);
    if (next === null) return;
    pushUndo(content);
    saveLocal(next);
    renderView();
    scheduleSync();
  }
});
edit.addEventListener('input', () => { saveLocal(edit.value); });

editBtn.addEventListener('click', startEdit);
doneBtn.addEventListener('click', () => { edit.blur(); endEdit(); });

document.getElementById('undoBtn').addEventListener('click', () => {
  if (!undoStack.length) { showToast('되돌릴 내용이 없습니다'); return; }
  saveLocal(undoStack.pop());
  if (editing) edit.value = content;
  renderView();
  scheduleSync();
});

document.getElementById('refreshBtn').addEventListener('click', () => {
  pushUndo(content);
  saveLocal(C.normalizeFull(content));
  if (editing) edit.value = content;
  renderView();
  showToast('번호를 정리했습니다');
  scheduleSync();
});

syncBtn.addEventListener('click', async () => {
  if (!auth.linked()) {
    gate.classList.add('show');
    return;
  }
  await runSync({ loud: true });
});

document.getElementById('gateLogin').addEventListener('click', async () => {
  if (!CFG.CLIENT_ID || CFG.CLIENT_ID.indexOf('PASTE_YOUR') === 0) {
    showToast('config.js 에 웹 클라이언트 ID를 먼저 넣어주세요');
    return;
  }
  try {
    await auth.login();
    gate.classList.remove('show');
    localStorage.removeItem(LS_SKIP);
    await runSync({ loud: true });
    startAutoSync();
  } catch (e) {
    showToast('연결 실패 — ' + e.message);
  }
});
document.getElementById('gateSkip').addEventListener('click', () => {
  localStorage.setItem(LS_SKIP, '1');
  gate.classList.remove('show');
});

/* 앱으로 돌아올 때 / 온라인 복귀 시 최신 확인 */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && auth.linked()) runSync();
});
window.addEventListener('online', () => { if (auth.linked()) runSync(); });

function startAutoSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => {
    if (!document.hidden && !editing) runSync();
  }, CFG.AUTO_SYNC_MS || 45000);
}

/* ===================== 시작 ===================== */
(function init() {
  content = C.normalizeOnSave(content);
  saveLocal(content);
  renderView();

  if (auth.linked()) {
    setSyncState('busy', '연결 확인 중…');
    /* GIS 스크립트 로드를 기다렸다가 조용히 갱신 */
    const waitGis = setInterval(() => {
      if (!auth.ready()) return;
      clearInterval(waitGis);
      runSync().then(startAutoSync);
    }, 200);
    setTimeout(() => {
      clearInterval(waitGis);
      if (syncBtn.classList.contains('busy')) {
        setSyncState('off', navigator.onLine ? '구글 로그인 스크립트를 불러오지 못했습니다' : '오프라인');
      }
    }, 10000);
  } else {
    setSyncState('off', '드라이브 미연결 — 눌러서 연결');
    if (!localStorage.getItem(LS_SKIP)) gate.classList.add('show');
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
