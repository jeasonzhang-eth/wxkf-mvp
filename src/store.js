// 消息持久化存储：append-only JSON 文件，按 external_userid 分组
// 与 cursor.js 同一风格：零依赖，同步读写，MVP 够用
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "..", "messages.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}

function save(messages) {
  fs.writeFileSync(FILE, JSON.stringify(messages, null, 2));
}

// 保存一条消息
// msg: { msgid, external_userid, open_kfid, direction, msgtype, content, timestamp }
// direction: "in" = 用户→客服, "out" = 客服→用户
export function append(msg) {
  const all = load();
  all.push(msg);
  save(all);
  return msg;
}

// 获取所有消息（按时间升序）
export function all() {
  return load();
}

// 按 external_userid 获取消息
export function byUser(externalUserid) {
  return load().filter((m) => m.external_userid === externalUserid);
}

// ---- 用户名称缓存 ----
const NAMES_FILE = path.join(__dirname, "..", "names.json");

function loadNames() {
  try {
    return JSON.parse(fs.readFileSync(NAMES_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveNames(names) {
  fs.writeFileSync(NAMES_FILE, JSON.stringify(names, null, 2));
}

export function setName(externalUserid, name) {
  const names = loadNames();
  names[externalUserid] = name;
  saveNames(names);
}

export function getNames(externalUserids) {
  const names = loadNames();
  const result = {};
  for (const id of externalUserids) {
    if (names[id]) result[id] = names[id];
  }
  return result;
}

export function getAllNames() {
  return loadNames();
}

// 列出所有会话（按 external_userid 分组，含最后一条消息时间和内容预览）
export function conversations() {
  const messages = load();
  const map = new Map();
  for (const m of messages) {
    const prev = map.get(m.external_userid);
    if (!prev || m.timestamp > prev.last_message_at) {
      map.set(m.external_userid, {
        external_userid: m.external_userid,
        open_kfid: m.open_kfid,
        last_message_at: m.timestamp,
        last_content:
          m.content.length > 50 ? m.content.slice(0, 50) + "…" : m.content,
        last_direction: m.direction,
        message_count: (prev?.message_count || 0) + 1,
      });
    } else if (prev) {
      prev.message_count += 1;
    }
  }
  return [...map.values()].sort(
    (a, b) => new Date(b.last_message_at) - new Date(a.last_message_at),
  );
}
