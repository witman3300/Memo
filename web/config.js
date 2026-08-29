/* =========================================================================
 * config.js — 모바일 웹앱 설정
 *
 * Google Cloud Console → 사용자 인증 정보 →
 *   OAuth 클라이언트 ID 만들기 → 유형 "웹 애플리케이션"
 *   · 승인된 자바스크립트 원본:  https://witman3300.github.io
 *   · (로컬 테스트용)           http://localhost:8080
 * 에서 발급받은 클라이언트 ID를 아래에 붙여넣으세요.
 *
 * 웹 클라이언트 ID는 비밀값이 아니라 공개돼도 되는 값입니다
 * (시크릿은 여기에 넣지 마세요 — 웹앱에서는 쓰지 않습니다).
 * =======================================================================*/
window.MEMO_CONFIG = {
  CLIENT_ID: 'PASTE_YOUR_WEB_CLIENT_ID.apps.googleusercontent.com',
  AUTO_SYNC_MS: 45000
};
