/* =========================================================================
 * memo-core.js — 메모 공통 로직 (데스크톱 위젯 · 모바일 웹앱 공용)
 *   브라우저:  <script src="memo-core.js">  →  window.MemoCore
 *   Node:      require('./memo-core.js')    →  module.exports
 * =======================================================================*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MemoCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MK_DONE = '✅';
  const MK_TODO = '🔲';
  const MK_NOTE = '→';

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function isSep(line) { return /^[\s=\-_]{4,}$/.test(line); }

  /* ===== 자동 번호 (구분선 구획별 1,2,3 오름차순) ===== */
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

  /* ===== 새로고침 전용: 번호 없는 줄→번호 부여, 내용 없는 번호줄→제거 =====
   * "→" 로 시작하는 줄은 번호를 붙이지 않고 그대로 둔다. */
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

  function removeBinchulLines(text) {
    return text.split('\n').filter(line => !line.includes('빈출')).join('\n');
  }
  function removeBlankLines(text) {
    return text.split('\n').filter(line => line.trim() !== '').join('\n');
  }

  /* 편집 후 정규화 (blur / 저장 시) */
  function normalizeOnSave(text) { return renumber(autoFormatTop(text)); }
  /* 새로고침 버튼 정규화 */
  function normalizeFull(text) {
    return normalizeNumbering(removeBlankLines(removeBinchulLines(autoFormatTop(text))));
  }

  /* ===== 보기 렌더링 → HTML 문자열 ===== */
  function renderHtml(content) {
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
    return html;
  }

  /* ===== 체크박스 토글 → 새 본문 (변화 없으면 null) ===== */
  function toggleDone(content, idx) {
    const lines = content.split('\n');
    if (idx < 0 || idx >= lines.length) return null;
    const line = lines[idx];
    if (!line.startsWith(MK_DONE) && !line.startsWith(MK_TODO)) return null;
    lines[idx] = line.startsWith(MK_DONE)
      ? MK_TODO + line.slice(MK_DONE.length)
      : MK_DONE + line.slice(MK_TODO.length);
    return lines.join('\n');
  }

  /* ===== 줄 이동 (텍스트 + 선택영역 → 새 텍스트 + 새 선택영역) ===== */
  function moveLines(val, selStart, selEnd, dir) {
    const lines = val.split('\n');
    const startLine = val.substring(0, selStart).split('\n').length - 1;
    const endLine = val.substring(0, selEnd).split('\n').length - 1;
    if (dir < 0 && startLine === 0) return null;
    if (dir > 0 && endLine === lines.length - 1) return null;
    const block = lines.slice(startLine, endLine + 1);
    lines.splice(startLine, block.length);
    const insertAt = startLine + dir;
    for (let i = 0; i < block.length; i++) lines.splice(insertAt + i, 0, block[i]);
    renumberArr(lines);
    let newStart = 0;
    for (let j = 0; j < insertAt; j++) newStart += lines[j].length + 1;
    let newEnd = newStart;
    for (let k = 0; k < block.length; k++) newEnd += lines[insertAt + k].length + 1;
    if (newEnd > newStart) newEnd -= 1;
    return { text: lines.join('\n'), start: newStart, end: newEnd };
  }

  return {
    MK_DONE, MK_TODO, MK_NOTE,
    escapeHtml, isSep,
    renumberArr, renumber, normalizeNumbering, autoFormatTop,
    removeBinchulLines, removeBlankLines,
    normalizeOnSave, normalizeFull,
    renderHtml, toggleDone, moveLines
  };
});
