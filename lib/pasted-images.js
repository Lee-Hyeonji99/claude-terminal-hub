'use strict';
/**
 * 클립보드로 붙여넣은 이미지 — 입력창(컴포즈)에 Ctrl+V 한 이미지를 파일로 저장하고 그 경로를 돌려준다.
 * Claude Code 는 메시지에 든 이미지 경로를 읽으므로 경로를 넣는 것이 곧 첨부다.
 *
 * 저장 위치: ~/.claude-terminal-hub/pasted/ (사용자 PC 에만). 오래된 파일은 저장할 때마다 정리한다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 8 * 1024 * 1024;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const EXT_OF = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const FILE_RE = /^paste-\d{8}-\d{6}-[0-9a-f]{6}\.(png|jpg|webp|gif)$/;

const pad = (n) => String(n).padStart(2, '0');
function stamp(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** data:image/...;base64,... → { ext, buf }. 형식·크기가 맞지 않으면 사용자에게 보일 메시지로 throw. */
function decodeDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new Error('이미지 데이터가 올바르지 않습니다');
  const ext = EXT_OF[m[1].toLowerCase()];
  if (!ext) throw new Error('png · jpg · webp · gif 이미지만 붙여넣을 수 있습니다');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new Error('빈 이미지입니다');
  if (buf.length > MAX_BYTES) throw new Error('이미지가 너무 큽니다 (8MB 제한)');
  return { ext, buf };
}

/** 이 폴더에서 우리가 만든 오래된 붙여넣기 파일만 지운다. */
function prune(dir, now = Date.now()) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    if (!FILE_RE.test(name)) continue;
    const full = path.join(dir, name);
    try {
      if (now - fs.statSync(full).mtimeMs > KEEP_MS) { fs.unlinkSync(full); removed++; }
    } catch { /* 이미 지워졌거나 잠김 — 다음에 */ }
  }
  return removed;
}

/** @returns {string} 저장한 파일의 절대 경로 */
function savePasted(dir, dataUrl, now = new Date()) {
  const { ext, buf } = decodeDataUrl(dataUrl);
  fs.mkdirSync(dir, { recursive: true });
  prune(dir, now.getTime());
  const name = `paste-${stamp(now)}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  const full = path.join(dir, name);
  fs.writeFileSync(full, buf);
  return full;
}

module.exports = { savePasted, prune, decodeDataUrl, FILE_RE, KEEP_MS };
