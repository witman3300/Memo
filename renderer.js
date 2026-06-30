'use strict';

const MK_DONE = '✅';
const MK_TODO = '🔲';
const MK_NOTE = '→';

const view = document.getElementById('view');
const edit = document.getElementById('edit');

let content = '';
const undoStack = [];

/* ===== 저장/불러오기 ===== */
function saveMemo(text) { try { window.memoAPI.save(text); } catch (e) {} }

/* ===== 유틸 ===== */
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function isSep(line) { return /^[\s=\-_]{4,}$/.test(line); }

/* ===== 자동 번호 (구간별 1,2,3 오름차순) ===== */
function renumberArr(lines) {
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (isSep(lines[i])) { n = 0; continue; }
    const m = lines[i].match(/^(\s*)(\d+)\.(.*)$/);
    if (m) { n++; lines[i] = m[1] + n + '.' + m[3]; }
  }
  return lines;
}
function renumber(text) { return renumberArr(text.split('\n')).join('\n'); }

/* ===== 새로고침 전용: 번호 없는 줄→번호 부여, 내용 없는 번호줄→제거 ===== */
function normalizeNumbering(text) {
  const lines = text.split('\n');
  let firstSep = -1;
  for (let i = 0; i < lines.length; i++) { if (isSep(lines[i])) { firstSep = i; break; } }
  if (firstSep < 0) return text;
  const out = [];
  let n = 0;
  for (let j = 0; j < lines.length; j++) {
    if (j < firstSep) { out.push(lines[j]); continue; }
    const line = lines[j];
    if (isSep(line)) { n = 0; out.push(line); continue; }
    if (line.replace(/^\s+/, '').startsWith(MK_NOTE)) { out.push(line); continue; }
    const m = line.match(/^(\s*)(\d+)\.(.*)$/);
    if (m) {
      if (/^\s*$/.test(m[3])) { continue; }
      n++; out.push(n + '.' + m[3]);
    } else {
      if (/^\s*$/.test(line)) { out.push(line); continue; }
      n++; out.push(n + '.' + line.replace(/^\s+/, ''));
    }
  }
  return out.join('\n');
}

/* ===== 상단 구획: 시간(HH:MM)으로 시작하는 줄에 미완료 체크박스 ===== */
function autoFormatTop(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (isSep(lines[i])) break;
    const line = lines[i];
    if (line.startsWith(MK_DONE) || line.startsWith(MK_TODO) || line.startsWith(MK_NOTE)) continue;
    if (/^\s*\d{1,2}:\d{2}/.test(line)) {
      lines[i] = MK_TODO + ' ' + line.replace(/^\s+/, '');
    }
  }
  return lines.join('\n');
}

/* ===== 보기 렌더링 ===== */
function renderView() {
  const lines = content.split('\n');
  let firstSep = lines.length;
  for (let s = 0; s < lines.length; s++) { if (isSep(lines[s])) { firstSep = s; break; } }
  let html = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const top = (i < firstSep);
    const isDone = line.startsWith(MK_DONE);
    const isTodo = line.startsWith(MK_TODO);
    if (top && (isDone || isTodo)) {
      const shown = line.slice((isDone ? MK_DONE : MK_TODO).length).replace(/^\s+/, '');
      html += '<div class="ln item' + (isDone ? ' done' : '') + '">'
            + '<span class="cb' + (isDone ? ' on' : '') + '" data-idx="' + i + '"></span>'
            + '<span class="tx">' + escapeHtml(shown) + '</span></div>';
    } else if (top && line.startsWith(MK_NOTE)) {
      html += '<div class="ln note">' + escapeHtml(line) + '</div>';
    } else if (line === '') {
      html += '<div class="ln">&nbsp;</div>';
    } else {
      html += '<div class="ln">' + escapeHtml(line) + '</div>';
    }
  }
  view.innerHTML = html;
}

/* ===== 체크박스 토글 ===== */
function toggleDone(idx) {
  const lines = content.split('\n');
  if (idx < 0 || idx >= lines.length) return;
  const line = lines[idx];
  if (!line.startsWith(MK_DONE) && !line.startsWith(MK_TODO)) return;
  pushUndo(content);
  if (line.startsWith(MK_DONE)) lines[idx] = MK_TODO + line.slice(MK_DONE.length);
  else lines[idx] = MK_DONE + line.slice(MK_TODO.length);
  content = lines.join('\n');
  saveMemo(content);
  edit.value = content;
  renderView();
}

/* ===== 새로고침 전용: "빈출" 표시된 줄 제거 ===== */
function removeBinchulLines(text) {
  return text.split('\n').filter(line => !line.includes('빈출')).join('\n');
}

/* ===== 새로고침 전용: 빈 줄 제거 (구분선/글자 있는 줄은 보존) ===== */
function removeBlankLines(text) {
  return text.split('\n').filter(line => line.trim() !== '').join('\n');
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
  content = normalizeNumbering(removeBlankLines(removeBinchulLines(autoFormatTop(loaded))));
  saveMemo(content);
  edit.value = content;
  renderView();
}

/* ===== Alt+↑ / Alt+↓ : 줄 이동 ===== */
function moveLines(dir) {
  const val = edit.value;
  const s = edit.selectionStart, en = edit.selectionEnd;
  const lines = val.split('\n');
  const startLine = val.substring(0, s).split('\n').length - 1;
  const endLine = val.substring(0, en).split('\n').length - 1;
  if (dir < 0 && startLine === 0) return;
  if (dir > 0 && endLine === lines.length - 1) return;
  const block = lines.slice(startLine, endLine + 1);
  lines.splice(startLine, block.length);
  const insertAt = startLine + dir;
  for (let i = 0; i < block.length; i++) lines.splice(insertAt + i, 0, block[i]);
  renumberArr(lines);
  edit.value = lines.join('\n');
  let newStart = 0;
  for (let j = 0; j < insertAt; j++) newStart += lines[j].length + 1;
  let newEnd = newStart;
  for (let k = 0; k < block.length; k++) newEnd += lines[insertAt + k].length + 1;
  if (newEnd > newStart) newEnd -= 1;
  edit.setSelectionRange(newStart, newEnd);
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
  content = renumber(autoFormatTop(edit.value));
  edit.value = content;
  saveMemo(content);
  renderView();
  edit.style.display = 'none';
  view.style.display = 'block';
});

document.getElementById('undoBtn').addEventListener('click', doUndo);
document.getElementById('refreshBtn').addEventListener('click', doRefresh);
document.getElementById('close').addEventListener('click', () => window.memoAPI.close());

/* ===== 카톡 전송 (복사 + 카톡 열기) ===== */
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
document.getElementById('kakaoBtn').addEventListener('click', async () => {
  const ok = await window.memoAPI.kakaoSend(content);
  showToast(ok ? '복사됨 — 카톡에서 Ctrl+V로 붙여넣기' : '복사됨 — 카톡을 직접 열어 Ctrl+V');
});

/* ===== 시작 ===== */
(async function init() {
  const loaded = await window.memoAPI.load();
  content = renumber(autoFormatTop(loaded));
  saveMemo(content);
  edit.value = content;
  renderView();
})();
