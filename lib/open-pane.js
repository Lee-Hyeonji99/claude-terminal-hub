'use strict';
/**
 * 밖에서 온 「패널 열기」 요청.
 *
 * 허브가 떠 있을 때 `Claude Terminal Hub.exe --open-pane=<요청 파일>` 로 한 번 더 실행하면,
 * 두 번째 실행이 요청 파일(JSON)을 읽어 떠 있는 허브에 넘기고 끝난다(electron/main.js).
 * 허브는 「명령 직접 입력」 버튼과 같은 길(addPane)로 그 경로에 패널을 연다.
 *
 * 요청 파일: { "cwd": "<작업 경로>", "command": "claude …", "title": "<패널 제목>", "profile": "<계정 id>" }
 *  - cwd 만 필수(절대 경로). command 를 비우면 claude 새 대화.
 *  - 요청 파일은 허브가 지우지 않는다 — 넘겨받은 경로의 파일을 지우는 일은 만든 쪽이 한다.
 */
const fs = require('fs');
const path = require('path');

const FLAG = '--open-pane=';
const DEFAULT_COMMAND = 'claude';
const MAX = { cwd: 1024, command: 4000, title: 120, profile: 64 };
// 명령은 셸에 그대로 타이핑된다 — 줄바꿈 · 탭 같은 제어 문자가 섞이면 여러 줄로 실행되거나 자동 완성이 튄다.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function field(value, max) {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  return s.length > max || CONTROL_CHARS.test(s) ? null : s;
}

// 받은 값을 패널 설정으로 다듬는다. 쓸 수 없는 요청이면 null.
function normalizeRequest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cwd = field(raw.cwd, MAX.cwd);
  const command = field(raw.command, MAX.command);
  const title = field(raw.title, MAX.title);
  const profile = field(raw.profile, MAX.profile);
  if ([cwd, command, title, profile].includes(null)) return null;
  if (!cwd || !path.isAbsolute(cwd)) return null;
  return { cwd, command: command || DEFAULT_COMMAND, title, profile };
}

// 실행 인자에서 요청 파일 경로를 찾는다. 없으면 null.
function requestPathFrom(argv) {
  const arg = (Array.isArray(argv) ? argv : []).find((a) => typeof a === 'string' && a.startsWith(FLAG));
  return arg ? arg.slice(FLAG.length) : null;
}

// 실행 인자의 요청 파일을 읽어 패널 설정으로 돌려준다. 인자가 없거나 파일을 못 읽으면 null.
function readRequest(argv) {
  const file = requestPathFrom(argv);
  if (!file) return null;
  try {
    return normalizeRequest(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')));
  } catch {
    return null;
  }
}

module.exports = { FLAG, normalizeRequest, requestPathFrom, readRequest };
