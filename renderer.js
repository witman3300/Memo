'use strict';

const C = window.MemoCore;

const view = document.getElementById('view');
const edit = document.getElementById('edit');
const syncBtn = document.getElementById('syncBtn');

let content = '';
const undoStack = [];
let editing = false;

/* ===== 저장/불러오기 ===== */
function saveMemo(text) { try { window.memoAPI.save(text); } catch (e) {} }

/* ===== 보기 렌더링 ===== */
function renderView() { view.innerHTML = C.renderHtml(content); }

/* ===== 체크박스 토글 ===== */
function toggleDone(idx) {
  const next = C.toggleDone(content, idx);
  if (next === null) return;
  pushUndo(content);
  content = next;
  saveMemo(content);
  edit.value = content;
  renderView();
}

/* ===== 되돌리기 / 새로고침 ===== */
function pushUndo(prev) { undoStack.push(prev); if (undoStack.length > 50) undoStack.shift(); }
function doUndo() {
  if (!undoStack.length) return;
  content = undoStack.pop();
  saveMemo(content);
  edit.value = content;
  renderView();
}
async function doRefresh() {
  pushUndo(content);
  const loaded = await window.memoAPI.load();
  content = C.normalizeFull(loaded);
  saveMemo(content);
  edit.value = content;
  renderView();
}

/* ===== Alt+↑ / Alt+↓ : 줄 이동 ===== */
function moveLines(dir) {
  const r = C.moveLines(edit.value, edit.selectionStart, edit.selectionEnd, dir);
  if (!r) return;
  edit.value = r.text;
  edit.setSelectionRange(r.start, r.end);
  content = edit.value;
  saveMemo(content);
}

/* ===== 이벤트 ===== */
view.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.classList && t.classList.contains('cb')) {
    toggleDone(parseInt(t.getAttribute('data-idx'), 10));
    e.stopPropagation();
  }
});
view.addEventListener('dblclick', () => {
  pushUndo(content);
  editing = true;
  edit.value = content;
  view.style.display = 'none';
  edit.style.display = 'block';
  edit.focus();
});
edit.addEventListener('input', () => { content = edit.value; saveMemo(content); });
edit.addEventListener('keydown', (e) => {
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    moveLines(e.key === 'ArrowUp' ? -1 : 1);
    e.preventDefault();
  }
});
edit.addEventListener('blur', () => {
  editing = false;
  content = C.normalizeOnSave(edit.value);
  edit.value = content;
  saveMemo(content);
  renderView();
  edit.style.display = 'none';
  view.style.display = 'block';
});

document.getElementById('undoBtn').addEventListener('click', doUndo);
document.getElementById('refreshBtn').addEventListener('click', doRefresh);
document.getElementById('close').addEventListener('click', () => window.memoAPI.close());

/* ===== 토스트 ===== */
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ===== 카톡 전송 (복사 + 카톡 열기) ===== */
document.getElementById('kakaoBtn').addEventListener('click', async () => {
  const ok = await window.memoAPI.kakaoSend(content);
  showToast(ok ? '복사됨 — 카톡에서 Ctrl+V로 붙여넣기' : '복사됨 — 카톡을 직접 열어 Ctrl+V');
});

/* ===== 구글 드라이브 동기화 ===== */
function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes());
}
function applyStatus(s) {
  if (!s) return;
  syncBtn.classList.remove('off', 'ok', 'busy', 'err');
  if (!s.linked) {
    syncBtn.classList.add('off');
    syncBtn.title = '구글 드라이브 미연결 — 클릭해서 연결';
  } else if (s.syncing) {
    syncBtn.classList.add('busy');
    syncBtn.title = '동기화 중…';
  } else if (s.lastStatus === 'error') {
    syncBtn.classList.add('err');
    syncBtn.title = '동기화 오류: ' + (s.message || '') + ' (클릭해서 재시도)';
  } else {
    syncBtn.classList.add('ok');
    syncBtn.title = '드라이브 동기화됨' + (s.lastAt ? ' · ' + fmtTime(s.lastAt) : '')
      + '\n클릭: 지금 동기화 / 우클릭: 설정';
  }
  if (s.lastStatus === 'conflict' && s.message) showToast(s.message);
}

syncBtn.addEventListener('click', async () => {
  const s = await window.driveAPI.status();
  if (!s.linked) { window.driveAPI.openSetup(); return; }
  showToast('동기화 중…');
  const r = await window.driveAPI.sync();
  if (r.lastStatus === 'error') showToast('동기화 실패: ' + (r.message || ''));
  else if (r.lastStatus === 'pulled') showToast('드라이브에서 최신 메모를 가져왔습니다');
  else if (r.lastStatus === 'pushed') showToast('드라이브에 저장했습니다');
  else if (r.lastStatus !== 'conflict') showToast('이미 최신입니다');
});
syncBtn.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.driveAPI.openSetup();
});

window.driveAPI.onStatus(applyStatus);
window.driveAPI.onPulled((text) => {
  /* 편집 중이면 사용자가 치는 내용을 덮지 않는다 (편집 종료 후 다음 동기화에 반영) */
  if (editing) { showToast('드라이브에 새 메모가 있습니다 — 편집을 끝내면 반영됩니다'); return; }
  content = text;
  edit.value = content;
  renderView();
  showToast('드라이브에서 메모를 가져왔습니다');
});

/* ===== 시작 ===== */
(async function init() {
  const loaded = await window.memoAPI.load();
  content = C.normalizeOnSave(loaded);
  saveMemo(content);
  edit.value = content;
  renderView();
  try { applyStatus(await window.driveAPI.status()); } catch (e) {}
})();
