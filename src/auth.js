// 简单鉴权：scrypt 密码哈希 + 内存 session（零依赖）
import crypto from "node:crypto";

const sessions = new Map(); // token -> { username, createdAt }
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 小时

// 定时清理过期 session，每 10 分钟跑一次
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL) sessions.delete(token);
  }
}, 10 * 60 * 1000);

// 用 scrypt 哈希密码，salt 拼在结果前面（hex:salt:hash）
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const attempt = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(hash));
}

// 创建 session，返回 token
export function createSession(username) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { username, createdAt: Date.now() });
  return token;
}

// 校验 token，返回 username 或 null
export function validateSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }
  return s.username;
}

// 注销
export function destroySession(token) {
  sessions.delete(token);
}
