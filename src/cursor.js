// 按 open_kfid 持久化 sync_msg 的游标，避免重启后重复/漏拉消息
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'cursor.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function getCursor(openKfId) {
  return load()[openKfId] || '';
}

export function setCursor(openKfId, cursor) {
  const all = load();
  all[openKfId] = cursor;
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
}
