// 企业微信「微信客服」接口封装：access_token 缓存、拉消息、发消息
const BASE = "https://qyapi.weixin.qq.com/cgi-bin";

let tokenCache = { value: null, expireAt: 0 };

// 获取 access_token（带缓存，提前 200s 过期）
export async function getAccessToken(corpid, secret) {
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.expireAt) {
    return tokenCache.value;
  }
  const url = `${BASE}/gettoken?corpid=${encodeURIComponent(corpid)}&corpsecret=${encodeURIComponent(secret)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode !== 0) {
    throw new Error(`gettoken 失败: ${data.errcode} ${data.errmsg}`);
  }
  tokenCache = {
    value: data.access_token,
    expireAt: now + (data.expires_in - 200) * 1000,
  };
  return data.access_token;
}

// 拉取消息：用回调里给的 token + 上次的 cursor
// 返回 { msg_list, next_cursor, has_more }
export async function syncMsg(
  accessToken,
  { token, cursor, openKfId, limit = 1000 },
) {
  const url = `${BASE}/kf/sync_msg?access_token=${accessToken}`;
  const body = { token, limit, open_kfid: openKfId };
  if (cursor) body.cursor = cursor;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.errcode !== 0) {
    throw new Error(`sync_msg 失败: ${data.errcode} ${data.errmsg}`);
  }
  return data;
}

// 批量获取客户信息（含昵称），最多 100 个/次
// 返回 { external_userid: { name, avatar } }
export async function batchGetCustomers(accessToken, externalUserids) {
  const result = {};
  // 分批，每批最多 100 个
  for (let i = 0; i < externalUserids.length; i += 100) {
    const batch = externalUserids.slice(i, i + 100);
    const url = `${BASE}/kf/customer/batchget?access_token=${accessToken}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ external_userid_list: batch }),
    });
    const data = await res.json();
    if (data.errcode !== 0) {
      console.error(`batchget 失败: ${data.errcode} ${data.errmsg}`);
      continue;
    }
    for (const c of data.customer_list || []) {
      result[c.external_userid] = { name: c.name, avatar: c.avatar || "" };
    }
  }
  return result;
}

// 发送文本消息给用户
export async function sendText(accessToken, { toUser, openKfId, content }) {
  const url = `${BASE}/kf/send_msg?access_token=${accessToken}`;
  const body = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype: "text",
    text: { content },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.errcode !== 0) {
    // 常见：95012 用户超过 48h 未发消息，无法主动发送；不抛死，记日志即可
    console.error(`send_msg 失败: ${data.errcode} ${data.errmsg}`);
  }
  return data;
}
