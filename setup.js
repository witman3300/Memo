'use strict';

const $ = (id) => document.getElementById(id);
const msg = $('msg');
const stateBox = $('state');

function say(text, kind) {
  msg.textContent = text;
  msg.className = kind || '';
}

async function refresh() {
  const s = await window.driveAPI.status();
  if (s.linked) {
    stateBox.textContent = '✅ 연결됨 — 1분마다 자동 동기화됩니다.';
  } else if (s.configured) {
    stateBox.textContent = '⚠️ 클라이언트 정보는 저장됨 — [연결하기]를 눌러 구글 계정을 연결하세요.';
  } else {
    stateBox.textContent = '⛔ 아직 연결되지 않음 — 아래 순서대로 설정하세요.';
  }
  return s;
}

$('lnkConsole').addEventListener('click', () => {
  window.driveAPI.openUrl('https://console.cloud.google.com/apis/credentials');
});

$('btnLogin').addEventListener('click', async () => {
  const id = $('cid').value.trim();
  const secret = $('csec').value.trim();
  if (!id || !secret) { say('클라이언트 ID와 시크릿을 모두 입력하세요.', 'err'); return; }
  $('btnLogin').disabled = true;
  say('브라우저에서 구글 로그인 창을 여는 중…');
  await window.driveAPI.configure(id, secret);
  const r = await window.driveAPI.login();
  $('btnLogin').disabled = false;
  if (r.ok) { say('연결됐습니다. 이 창은 닫아도 됩니다.', 'ok'); }
  else { say('연결 실패: ' + r.error, 'err'); }
  refresh();
});

$('btnOpen').addEventListener('click', async () => {
  const ok = await window.driveAPI.openFolder();
  if (!ok) say('먼저 구글 계정을 연결하세요.', 'err');
});

$('btnLogout').addEventListener('click', async () => {
  await window.driveAPI.logout();
  say('연결이 해제됐습니다.', 'ok');
  refresh();
});

refresh();
