// 企业微信「微信客服」接入 MVP
// 闭环：回调收到事件 -> 校验解密拿 Token -> sync_msg 拉消息 -> send_msg 原样回显
import "./loadenv.js"; // 必须最先 import，加载 .env 到 process.env
import express from "express";
import { verifySignature, decrypt } from "./wxcrypt.js";
import { getAccessToken, syncMsg, sendText } from "./wecom.js";
import { getCursor, setCursor } from "./cursor.js";

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
      // origin=3 表示用户发的消息（4=系统，5=接待人员），只回显用户文本
      if (msg.origin === 3 && msg.msgtype === "text") {
        const content = msg.text?.content || "";
        console.log(`收到 ${msg.external_userid}: ${content}`);
        await sendText(accessToken, {
          toUser: msg.external_userid,
          openKfId: msg.open_kfid || openKfId,
          content: `你说的是：${content}`,
        });
      }
    }
    cursor = data.next_cursor || cursor;
    if (cursor) setCursor(openKfId, cursor);
    hasMore = data.has_more === 1;
  }
}

app.get("/healthz", (_req, res) => res.send("ok"));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`wxkf-mvp 监听 127.0.0.1:${PORT}`);
});
