/* =========================================================================
 * store.js — 동기화 상태를 담는 작은 JSON 저장소 (Electron 메인 프로세스)
 *   %APPDATA%\desktop-memo\sync-state.json
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

function createStore(userDataDir, fileName) {
  const file = path.join(userDataDir, fileName || 'sync-state.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { data = {}; }

  function flush() {
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}
  }

  return {
    get(key) { return data[key]; },
    set(key, value) { data[key] = value; flush(); return value; },
    clear() { data = {}; flush(); }
  };
}

module.exports = { createStore };
