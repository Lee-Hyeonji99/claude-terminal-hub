'use strict';
/**
 * 프로젝트(작업 경로) 식별 — 세션을 «계정 › 프로젝트» 로 묶을 때와 프로젝트별 펫을 고를 때 쓴다.
 *
 * - 같은 폴더면 같은 프로젝트다. Windows 경로는 대소문자·구분자(/ \)·끝 슬래시가 달라도 같다.
 * - 워크스페이스 키는 `<프로필>::<프로젝트>` — 옛 레이아웃은 프로필 id 하나만 키로 썼다.
 */
(function (root) {
  const SEP = '::';

  function projectId(cwd) {
    if (!cwd) return '';
    let p = String(cwd).trim();
    const isWin = /^[a-zA-Z]:/.test(p) || /^\\\\/.test(p) || (p.includes('\\') && !p.startsWith('/'));
    if (isWin) p = p.replace(/\//g, '\\').toLowerCase();
    // 루트(`C:\`, `/`)는 슬래시를 남긴다 — 다 지우면 `C:` 가 되어 "현재 폴더" 뜻이 된다.
    const trimmed = p.replace(/[\\/]+$/, '');
    if (!trimmed) return p;
    return /^[a-z]:$/i.test(trimmed) ? trimmed + '\\' : trimmed;
  }

  function projectName(cwd) {
    const parts = String(cwd || '').split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function workspaceKey(profile, project) {
    return `${profile || 'default'}${SEP}${project || ''}`;
  }

  /** 옛 형식(프로필 id 만) 이면 null. */
  function parseWorkspaceKey(key) {
    const s = String(key || '');
    const i = s.indexOf(SEP);
    if (i < 0) return null;
    return { profile: s.slice(0, i), project: s.slice(i + SEP.length) };
  }

  /** 프로젝트마다 고정된 색상각 — 펫·탭 점 색으로 구분한다. */
  function projectHue(id) {
    let h = 2166136261;
    const s = String(id || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h) % 360;
  }

  const api = { projectId, projectName, workspaceKey, parseWorkspaceKey, projectHue };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProjectKey = api;
})(typeof window !== 'undefined' ? window : globalThis);
