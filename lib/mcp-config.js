'use strict';
/**
 * 계정 쪽 claude 에 넘길 MCP 서버 — 메인 ~/.claude.json 에서 뽑는다.
 * .claude.json 은 로그인 정보와 한 파일이라 연결할 수 없어서, 실행할 때 --mcp-config 로 넘긴다.
 *   - 사용자 범위: 최상위 mcpServers
 *   - 프로젝트 범위(`claude mcp add` 기본값): projects["<작업 경로>"].mcpServers — 그 프로젝트에서 끈 서버(disabledMcpServers)는 뺀다
 * 작업 경로마다 내용이 달라 파일도 경로마다 따로 만든다(패널 둘이 동시에 뜰 때 서로 덮어쓰지 않게).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// .claude.json 의 프로젝트 키는 Windows 에서도 `C:/Users/...` 처럼 / 로 적힌다 — 비교할 때 맞춘다
function normProjectPath(p) {
  const r = path.resolve(String(p || '')).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** 메인 .claude.json 에서 이 작업 경로용 MCP 서버 목록. 하나도 없으면 null. */
function mcpServersFor(mainAccountFile, cwd) {
  const j = readJson(mainAccountFile);
  if (!j) return null;
  const out = { ...(j.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : {}) };
  if (cwd && j.projects && typeof j.projects === 'object') {
    const want = normProjectPath(cwd);
    const key = Object.keys(j.projects).find((k) => normProjectPath(k) === want);
    const proj = key ? j.projects[key] : null;
    if (proj) {
      Object.assign(out, proj.mcpServers && typeof proj.mcpServers === 'object' ? proj.mcpServers : {});
      for (const name of Array.isArray(proj.disabledMcpServers) ? proj.disabledMcpServers : []) delete out[name];
    }
  }
  return Object.keys(out).length ? out : null;
}

/** 작업 경로별 --mcp-config 파일을 쓰고 경로를 돌려준다. 넘길 서버가 없으면 null. */
function writeMcpConfig(mainAccountFile, cwd, outDir) {
  const servers = mcpServersFor(mainAccountFile, cwd);
  if (!servers) return null;
  const hash = crypto.createHash('sha1').update(normProjectPath(cwd || '')).digest('hex').slice(0, 12);
  const file = path.join(outDir, `mcp-${hash}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }, null, 2), { mode: 0o600 });
  return file;
}

module.exports = { mcpServersFor, writeMcpConfig, normProjectPath };
