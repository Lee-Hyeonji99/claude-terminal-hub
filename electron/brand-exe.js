'use strict';
// electron.exe 를 "Claude Terminal Hub.exe" 로 복사 + 리소스 정보 패치.
// 작업표시줄/Alt-Tab이 패키징 안 된 electron.exe 자체 정체성("Electron")으로 뜨는 걸 방지.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const distDir = path.join(ROOT, 'node_modules', 'electron', 'dist');
const src = path.join(distDir, 'electron.exe');
const dest = path.join(distDir, 'Claude Terminal Hub.exe');
const icon = path.join(__dirname, 'icon.ico');

async function main() {
  if (!fs.existsSync(src)) { console.error('electron.exe not found:', src); process.exit(1); }
  fs.copyFileSync(src, dest);
  const { rcedit } = require('rcedit');
  await rcedit(dest, {
    icon,
    'version-string': {
      ProductName: 'Claude Terminal Hub',
      FileDescription: 'Claude Terminal Hub',
      CompanyName: 'Claude Terminal Hub',
      OriginalFilename: 'Claude Terminal Hub.exe',
      InternalName: 'Claude Terminal Hub',
    },
  });
  console.log('branded exe ready:', dest);
}

main().catch((e) => { console.error(e); process.exit(1); });
