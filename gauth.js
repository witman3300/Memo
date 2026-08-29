/* =========================================================================
 * gauth.js — Electron 메인 프로세스용 Google OAuth (설치형 앱 / PKCE + 루프백)
 *
 *   자격증명·토큰은 저장소(git)가 아니라 사용자 데이터 폴더에 보관한다:
 *     %APPDATA%\desktop-memo\google.json
 *
 *   Google Cloud Console에서 "데스크톱 앱" 유형 OAuth 클라이언트를 만들면
 *   루프백(127.0.0.1) 리디렉션이 포트에 관계없이 허용되므로 별도 등록이 필요 없다.
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createAuth(userDataDir) {
  const credFile = path.join(userDataDir, 'google.json');
  let state = { clientId: '', clientSecret: '', refreshToken: '' };
  let accessToken = '';
  let accessExpiry = 0;
  let pendingServer = null;

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(credFile, 'utf8'));
      state = Object.assign(state, raw);
    } catch (e) { /* 아직 설정 전 */ }
    return state;
  }
  function save() {
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.writeFileSync(credFile, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {}
  }

  load();

  function isConfigured() { return !!(state.clientId && state.clientSecret); }
  function isLinked() { return isConfigured() && !!state.refreshToken; }

  function configure(clientId, clientSecret) {
    state.clientId = (clientId || '').trim();
    state.clientSecret = (clientSecret || '').trim();
    save();
    return isConfigured();
  }

  async function tokenRequest(params) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString()
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error_description || json.error || ('token ' + res.status));
    }
    return json;
  }

  /* ---- 브라우저를 열어 계정 연결. resolve 시 연결 완료 ---- */
  function login() {
    if (!isConfigured()) return Promise.reject(new Error('클라이언트 ID/시크릿이 설정되지 않았습니다.'));
    if (pendingServer) { try { pendingServer.close(); } catch (e) {} pendingServer = null; }

    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const csrf = b64url(crypto.randomBytes(16));

    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, arg) => {
        if (settled) return;
        settled = true;
        try { server.close(); } catch (e) {}
        pendingServer = null;
        fn(arg);
      };

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/') { res.writeHead(404).end(); return; }
        const reply = (msg) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;'
            + 'display:flex;align-items:center;justify-content:center;height:100vh;margin:0;'
            + 'background:#faf7e8;color:#3a2c07"><div style="text-align:center">'
            + '<div style="font-size:42px">📌</div><h2>' + msg + '</h2>'
            + '<p>이 창은 닫아도 됩니다.</p></div>');
        };
        if (url.searchParams.get('state') !== csrf) { reply('요청이 올바르지 않습니다.'); return; }
        const err = url.searchParams.get('error');
        if (err) { reply('연결 취소됨'); done(reject, new Error(err)); return; }
        const code = url.searchParams.get('code');
        if (!code) { reply('코드를 받지 못했습니다.'); return; }
        try {
          const tok = await tokenRequest({
            code,
            client_id: state.clientId,
            client_secret: state.clientSecret,
            code_verifier: verifier,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
          });
          state.refreshToken = tok.refresh_token || state.refreshToken;
          accessToken = tok.access_token;
          accessExpiry = Date.now() + (tok.expires_in || 3600) * 1000 - 60000;
          save();
          reply('메모위젯이 구글 드라이브에 연결됐습니다 ✅');
          done(resolve, true);
        } catch (e) {
          reply('연결 실패: ' + e.message);
          done(reject, e);
        }
      });

      let redirectUri = '';
      server.listen(0, '127.0.0.1', () => {
        pendingServer = server;
        redirectUri = 'http://127.0.0.1:' + server.address().port;
        const q = new URLSearchParams({
          client_id: state.clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: SCOPE,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          access_type: 'offline',
          prompt: 'consent',
          state: csrf
        });
        shell.openExternal(AUTH_URL + '?' + q.toString());
      });
      server.on('error', (e) => done(reject, e));
      setTimeout(() => done(reject, new Error('로그인 시간이 초과됐습니다.')), 5 * 60 * 1000);
    });
  }

  async function getAccessToken() {
    if (accessToken && Date.now() < accessExpiry) return accessToken;
    if (!isLinked()) throw new Error('구글 계정이 연결되지 않았습니다.');
    const tok = await tokenRequest({
      client_id: state.clientId,
      client_secret: state.clientSecret,
      refresh_token: state.refreshToken,
      grant_type: 'refresh_token'
    });
    accessToken = tok.access_token;
    accessExpiry = Date.now() + (tok.expires_in || 3600) * 1000 - 60000;
    return accessToken;
  }

  async function logout() {
    const rt = state.refreshToken;
    state.refreshToken = '';
    accessToken = '';
    accessExpiry = 0;
    save();
    if (rt) {
      try {
        await fetch(REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: rt }).toString()
        });
      } catch (e) {}
    }
    return true;
  }

  return {
    isConfigured, isLinked, configure, login, logout, getAccessToken,
    get clientId() { return state.clientId; }
  };
}

module.exports = { createAuth };
