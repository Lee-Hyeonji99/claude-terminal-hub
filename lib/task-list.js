'use strict';
/**
 * Claude 작업 목록 읽기 — 패널 「작업 목록」 서랍용.
 *
 * Claude 가 작업 목록 도구(TaskCreate · TaskUpdate)를 쓰면
 * <설정 폴더>/tasks/<세션 ID>/<번호>.json 에 항목마다 파일 하나를 쓴다.
 *   { "id": "1", "subject": "…", "description": "…", "status": "pending|in_progress|completed",
 *     "blocks": [], "blockedBy": [] }
 * 최신 모델(Opus 5.5 · Sonnet 5.5 …)에는 이 도구가 기본으로 없어서, 허브는 claude 패널에
 * CLAUDE_CODE_ENABLE_TODO_TOOLS=1 을 넣어 켠다(server.js cleanEnv).
 */
const fs = require('fs');
const path = require('path');

const STATUSES = new Set(['pending', 'in_progress', 'completed']);

function taskDir(configDir, sessionId) {
  if (!configDir || !sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return null;
  return path.join(configDir, 'tasks', sessionId);
}

// 폴더의 항목 파일을 번호 순으로 읽는다. 폴더가 없으면 빈 목록. 깨진 파일은 건너뛴다(쓰는 중일 수 있음).
function readTasks(dir) {
  if (!dir) return [];
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const items = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const o = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (!o || typeof o.subject !== 'string') continue;
      items.push({
        id: String(o.id ?? name.replace(/\.json$/, '')),
        subject: o.subject.slice(0, 200),
        status: STATUSES.has(o.status) ? o.status : 'pending',
      });
    } catch { /* 다음 주기에 다시 읽는다 */ }
  }
  return items.sort((a, b) => (Number(a.id) - Number(b.id)) || a.id.localeCompare(b.id));
}

module.exports = { taskDir, readTasks };
