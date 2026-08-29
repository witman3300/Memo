/* =========================================================================
 * drive-api.js — Google Drive 파일 동기화 (데스크톱 · 모바일 공용)
 *   토큰 발급 방식만 플랫폼별로 다르고, 파일 입출력 로직은 동일하다.
 *   createDrive(getAccessToken, store) → { sync, pull, push, getMeta, ... }
 *
 *   store: { get(key), set(key, value) } — fileId·마지막 동기화 상태 보관
 * =======================================================================*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DriveAPI = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER_NAME = 'MemoWidget';
  const FILE_NAME = 'content.txt';
  const FIELDS = 'id,name,modifiedTime,size';

  function createDrive(getAccessToken, store) {
    async function req(url, opts) {
      opts = opts || {};
      const token = await getAccessToken();
      const headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {});
      const res = await fetch(url, Object.assign({}, opts, { headers: headers }));
      if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch (e) {}
        const err = new Error('Drive ' + res.status + ': ' + body.slice(0, 300));
        err.status = res.status;
        throw err;
      }
      return res;
    }

    /* ---- 폴더 확보 (drive.file 범위: 앱이 만든 항목만 보인다) ---- */
    async function ensureFolder() {
      let id = await store.get('folderId');
      if (id) {
        try {
          const m = await (await req(API + '/files/' + id + '?fields=id,trashed')).json();
          if (!m.trashed) return id;
        } catch (e) { /* 없어졌으면 다시 만든다 */ }
      }
      const q = encodeURIComponent(
        "name='" + FOLDER_NAME + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
      const found = await (await req(API + '/files?q=' + q + '&fields=files(id)&pageSize=1')).json();
      if (found.files && found.files.length) {
        await store.set('folderId', found.files[0].id);
        return found.files[0].id;
      }
      const created = await (await req(API + '/files?fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
      })).json();
      await store.set('folderId', created.id);
      return created.id;
    }

    /* ---- 메모 파일 확보 ---- */
    async function ensureFile(seedContent) {
      const id = await store.get('fileId');
      if (id) {
        try {
          const m = await (await req(API + '/files/' + id + '?fields=' + FIELDS + ',trashed')).json();
          if (!m.trashed) return m;
        } catch (e) { /* 삭제됐거나 접근 불가 → 다시 찾는다 */ }
      }
      const q = encodeURIComponent("name='" + FILE_NAME + "' and trashed=false");
      const found = await (await req(API + '/files?q=' + q + '&fields=files(' + FIELDS + ')&pageSize=1')).json();
      if (found.files && found.files.length) {
        await store.set('fileId', found.files[0].id);
        return found.files[0];
      }
      const folderId = await ensureFolder();
      const meta = await createFile(FILE_NAME, seedContent || '', folderId);
      await store.set('fileId', meta.id);
      return meta;
    }

    async function createFile(name, content, folderId) {
      const boundary = 'memoboundary' + Date.now();
      const meta = { name: name, mimeType: 'text/plain' };
      if (folderId) meta.parents = [folderId];
      const body =
        '--' + boundary + '\r\n' +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(meta) + '\r\n' +
        '--' + boundary + '\r\n' +
        'Content-Type: text/plain; charset=UTF-8\r\n\r\n' +
        content + '\r\n' +
        '--' + boundary + '--';
      const res = await req(UPLOAD + '/files?uploadType=multipart&fields=' + FIELDS, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
        body: body
      });
      return res.json();
    }

    async function getMeta() {
      const m = await ensureFile();
      return (await req(API + '/files/' + m.id + '?fields=' + FIELDS)).json();
    }

    async function download(id) {
      return (await req(API + '/files/' + id + '?alt=media')).text();
    }

    async function upload(id, content) {
      const res = await req(UPLOAD + '/files/' + id + '?uploadType=media&fields=' + FIELDS, {
        method: 'PATCH',
        headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
        body: content
      });
      return res.json();
    }

    function stamp() {
      const d = new Date(), p = (n) => String(n).padStart(2, '0');
      return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
             '-' + p(d.getHours()) + p(d.getMinutes());
    }

    /* ---- 원격만 읽어오기 ---- */
    async function pull() {
      const m = await ensureFile();
      const text = await download(m.id);
      await store.set('lastModified', m.modifiedTime);
      await store.set('lastContent', text);
      return { content: text, modifiedTime: m.modifiedTime };
    }

    /* ---- 로컬을 원격에 덮어쓰기 (강제) ---- */
    async function push(content) {
      const m = await ensureFile(content);
      const up = await upload(m.id, content);
      await store.set('lastModified', up.modifiedTime);
      await store.set('lastContent', content);
      return { modifiedTime: up.modifiedTime };
    }

    /* -----------------------------------------------------------------
     * 양방향 동기화. 결과 status:
     *   'idle'      변화 없음
     *   'pushed'    로컬 → 드라이브 업로드
     *   'pulled'    드라이브 → 로컬 반영 (content 반환)
     *   'conflict'  양쪽 다 변경 → 원격본을 별도 파일로 백업하고 로컬 우선
     * ----------------------------------------------------------------*/
    async function sync(localContent) {
      const m = await ensureFile(localContent);
      const baseModified = await store.get('lastModified');
      const baseContent = await store.get('lastContent');
      const localChanged = (baseContent === undefined || baseContent === null)
        ? true
        : localContent !== baseContent;

      /* 원격이 그대로인 경우 */
      if (baseModified && m.modifiedTime === baseModified) {
        if (!localChanged) return { status: 'idle' };
        const up = await upload(m.id, localContent);
        await store.set('lastModified', up.modifiedTime);
        await store.set('lastContent', localContent);
        return { status: 'pushed' };
      }

      /* 원격이 바뀐(또는 첫 동기화인) 경우 */
      const remote = await download(m.id);
      if (remote === localContent) {
        await store.set('lastModified', m.modifiedTime);
        await store.set('lastContent', remote);
        return { status: 'idle' };
      }
      if (!localChanged) {
        await store.set('lastModified', m.modifiedTime);
        await store.set('lastContent', remote);
        return { status: 'pulled', content: remote };
      }
      /* 첫 동기화인데 원격이 비어 있으면 그냥 로컬을 올린다 */
      if (!baseModified && remote.trim() === '') {
        const up = await upload(m.id, localContent);
        await store.set('lastModified', up.modifiedTime);
        await store.set('lastContent', localContent);
        return { status: 'pushed' };
      }

      /* 양쪽 다 변경 → 원격본 백업 후 로컬 우선 */
      let backupName = null;
      try {
        const folderId = await ensureFolder();
        backupName = 'content-conflict-' + stamp() + '.txt';
        await createFile(backupName, remote, folderId);
      } catch (e) { backupName = null; }
      const up = await upload(m.id, localContent);
      await store.set('lastModified', up.modifiedTime);
      await store.set('lastContent', localContent);
      return { status: 'conflict', backupName: backupName, remote: remote };
    }

    return {
      sync: sync, pull: pull, push: push, getMeta: getMeta, ensureFile: ensureFile,
      FOLDER_NAME: FOLDER_NAME, FILE_NAME: FILE_NAME
    };
  }

  return { createDrive: createDrive, FOLDER_NAME: FOLDER_NAME, FILE_NAME: FILE_NAME };
});
