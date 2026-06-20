// 企业微信「微信客服」接入 MVP
// 闭环：回调收到事件 -> 校验解密拿 Token -> sync_msg 拉消息 -> send_msg 原样回显
import "./loadenv.js"; // 必须最先 import，加载 .env 到 process.env
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { verifySignature, decrypt } from "./wxcrypt.js";
import {
  getAccessToken,
  syncMsg,
  sendText,
  batchGetCustomers,
} from "./wecom.js";
import { getCursor, setCursor } from "./cursor.js";
import * as store from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  WXKF_CORPID,
  WXKF_SECRET,
  WXKF_TOKEN,
  WXKF_AES_KEY,
  PORT = 3000,
} = process.env;

for (const [k, v] of Object.entries({
  WXKF_CORPID,
  WXKF_SECRET,
  WXKF_TOKEN,
  WXKF_AES_KEY,
})) {
  if (!v) {
    console.error(`缺少环境变量 ${k}，请检查 .env`);
    process.exit(1);
  }
}

const app = express();
app.use(express.json()); // API 用 JSON body
// 静态目录：企业微信域名归属认证文件（WW_verify_*.txt）等放这里，根路径可访问
app.use(express.static("public"));
// 回调 body 是 XML，用 raw text 接收，避免 JSON 解析报错
app.use("/wxkf/callback", express.text({ type: "*/*" }));

// 从 XML 里取某个标签的值（兼容 CDATA 与纯文本）
function pick(xml, tag) {
  const m = xml.match(
    new RegExp(
      `<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`,
    ),
  );
  return m ? (m[1] ?? m[2] ?? "").trim() : "";
}

// ---- 1) URL 验证：企业微信后台保存回调配置时发 GET ----
app.get("/wxkf/callback", (req, res) => {
  const { msg_signature, timestamp, nonce, echostr } = req.query;
  if (!verifySignature(WXKF_TOKEN, timestamp, nonce, echostr, msg_signature)) {
    console.warn("GET 验证签名失败");
    return res.status(401).send("invalid signature");
  }
  try {
    const { message } = decrypt(echostr, WXKF_AES_KEY);
    res.send(message); // 原样返回解密后的明文 echostr
  } catch (e) {
    console.error("echostr 解密失败:", e.message);
    res.status(500).send("decrypt failed");
  }
});

// ---- 2) 接收消息/事件推送 ----
app.post("/wxkf/callback", async (req, res) => {
  const { msg_signature, timestamp, nonce } = req.query;
  const encrypt = pick(req.body, "Encrypt");
  if (!verifySignature(WXKF_TOKEN, timestamp, nonce, encrypt, msg_signature)) {
    console.warn("POST 验证签名失败");
    return res.status(401).send("invalid signature");
  }

  // 必须 5s 内回应微信，先 ack，再异步处理拉消息
  res.send("success");

  try {
    const { message } = decrypt(encrypt, WXKF_AES_KEY);
    const event = pick(message, "Event");
    const token = pick(message, "Token");
    const openKfId = pick(message, "OpenKfId");
    if (event !== "kf_msg_or_event" || !token) return;
    await handleNewMessages({ token, openKfId });
  } catch (e) {
    console.error("处理回调失败:", e.message);
  }
});

// ---- 3) 拉消息 + 回显 ----
async function handleNewMessages({ token, openKfId }) {
  const accessToken = await getAccessToken(WXKF_CORPID, WXKF_SECRET);
  let cursor = getCursor(openKfId);
  let hasMore = true;

  while (hasMore) {
    const data = await syncMsg(accessToken, { token, cursor, openKfId });
    for (const msg of data.msg_list || []) {
      const timestamp = msg.send_time
        ? new Date(msg.send_time * 1000).toISOString()
        : new Date().toISOString();

      // 存储所有文本消息（origin=3 用户, origin=5 接待人员）
      if (msg.msgtype === "text" && (msg.origin === 3 || msg.origin === 5)) {
        store.append({
          msgid: msg.msgid || "",
          external_userid: msg.external_userid || "",
          open_kfid: msg.open_kfid || openKfId,
          direction: msg.origin === 3 ? "in" : "out",
          msgtype: "text",
          content: msg.text?.content || "",
          timestamp,
        });
      }

      // origin=3 表示用户发的消息，原样回显
      if (msg.origin === 3 && msg.msgtype === "text") {
        const content = msg.text?.content || "";
        console.log(`收到 ${msg.external_userid}: ${content}`);
        const res = await sendText(accessToken, {
          toUser: msg.external_userid,
          openKfId: msg.open_kfid || openKfId,
          content: `你说的是：${content}`,
        });
        // 存储客服发出的回复
        if (res.errcode === 0) {
          store.append({
            msgid: res.msgid || "",
            external_userid: msg.external_userid,
            open_kfid: msg.open_kfid || openKfId,
            direction: "out",
            msgtype: "text",
            content: `你说的是：${content}`,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
    cursor = data.next_cursor || cursor;
    if (cursor) setCursor(openKfId, cursor);
    hasMore = data.has_more === 1;
  }

  // 解析新用户名称（本地没有缓存的才调 API）
  const users = store.conversations().map((c) => c.external_userid);
  const existing = store.getAllNames();
  const missing = users.filter((u) => !existing[u]);
  if (missing.length > 0) {
    try {
      const info = await batchGetCustomers(accessToken, missing);
      for (const [id, { name }] of Object.entries(info)) {
        if (name) store.setName(id, name);
      }
    } catch (e) {
      console.error("批量获取客户信息失败:", e.message);
    }
  }
}

// ---- API：会话列表 ----
app.get("/api/conversations", (_req, res) => {
  const convs = store.conversations();
  const names = store.getAllNames();
  res.json(
    convs.map((c) => ({
      ...c,
      name: names[c.external_userid] || null,
    })),
  );
});

// ---- API：发送消息给用户（从 chat 页面回复） ----
app.post("/api/send", async (req, res) => {
  const { toUser, openKfId, content } = req.body || {};
  if (!toUser || !openKfId || !content) {
    return res.status(400).json({ error: "缺少参数 toUser/openKfId/content" });
  }
  try {
    const accessToken = await getAccessToken(WXKF_CORPID, WXKF_SECRET);
    const apiRes = await sendText(accessToken, { toUser, openKfId, content });
    if (apiRes.errcode === 0) {
      store.append({
        msgid: apiRes.msgid || "",
        external_userid: toUser,
        open_kfid: openKfId,
        direction: "out",
        msgtype: "text",
        content,
        timestamp: new Date().toISOString(),
      });
      return res.json({ ok: true, msgid: apiRes.msgid });
    }
    res.json({ ok: false, errcode: apiRes.errcode, errmsg: apiRes.errmsg });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API：批量获取用户名称 ----
app.post("/api/names", async (req, res) => {
  const { users } = req.body || {};
  if (!users || users.length === 0) return res.json({ names: {} });

  // 先查本地缓存
  const names = store.getNames(users);
  const missing = users.filter((u) => !names[u]);

  if (missing.length > 0) {
    try {
      const accessToken = await getAccessToken(WXKF_CORPID, WXKF_SECRET);
      const info = await batchGetCustomers(accessToken, missing);
      for (const [id, { name }] of Object.entries(info)) {
        if (name) {
          store.setName(id, name);
          names[id] = name;
        }
      }
    } catch (e) {
      console.error("批量获取客户信息失败:", e.message);
    }
  }
  res.json({ names });
});

// ---- API：某用户的聊天记录 ----
app.get("/api/messages", (req, res) => {
  const user = req.query.user;
  if (!user) return res.status(400).json({ error: "缺少 user 参数" });
  res.json(store.byUser(user));
});

// ---- 聊天页面 ----
app.get("/chat", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "chat.html"));
});

app.get("/healthz", (_req, res) => res.send("ok"));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`wxkf-mvp 监听 127.0.0.1:${PORT}`);
});
