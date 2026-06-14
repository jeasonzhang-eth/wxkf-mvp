# 企业微信「微信客服」接入 MVP

最小闭环：**用户发消息 → 微信回调你的服务 → 校验解密拿 Token → `sync_msg` 拉消息 → `send_msg` 原样回显**。

零第三方加解密依赖，只用一个 `express`。

## 目录结构

```
src/
  loadenv.js   # 极简 .env 加载（零依赖）
  wxcrypt.js   # 回调签名校验 + AES-256-CBC 解密
  wecom.js     # access_token 缓存 / sync_msg / send_msg
  cursor.js    # 按 open_kfid 持久化拉取游标
  server.js    # 回调入口 + 业务编排
```

## 本地跑起来

```bash
npm install
cp .env.example .env   # 填入真实 corpid/secret/token/aeskey
npm start              # 监听 127.0.0.1:3000
```

---

## 部署到你的 ECS（复用现网 nginx :8443 + Cloudflare 架构）

> 现网约束：`:443` 被 xray REALITY 占用，nginx 监听 `:8443`，Cloudflare 用
> **Full(Strict) + Origin Rule（`*beisuyinqing.tech` → 端口 8443）**。微信客服子域
> 走同一条路，无需新增 Origin Rule。

### 1. 上传代码 + 装依赖

```bash
ssh aliyun-manila '
  mkdir -p /opt/wxkf-mvp
'
# 本地：把项目同步上去（排除 node_modules / .env）
rsync -av --exclude node_modules --exclude .env \
  /Users/zhangjie/Downloads/wxkf-mvp/ aliyun-manila:/opt/wxkf-mvp/

ssh aliyun-manila '
  cd /opt/wxkf-mvp
  # 若没装 node：curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
  npm install --omit=dev
'
```

### 2. 配置 .env（在服务器上）

```bash
ssh aliyun-manila 'cat > /opt/wxkf-mvp/.env <<EOF
WXKF_CORPID=ww你的企业ID
WXKF_SECRET=微信客服Secret
WXKF_TOKEN=你在回调配置里设置的Token
WXKF_AES_KEY=43位EncodingAESKey
PORT=3000
EOF
chmod 600 /opt/wxkf-mvp/.env'
```

### 3. systemd 常驻

```bash
ssh aliyun-manila 'cat > /etc/systemd/system/wxkf-mvp.service <<EOF
[Unit]
Description=wxkf-mvp
After=network.target

[Service]
WorkingDirectory=/opt/wxkf-mvp
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now wxkf-mvp
systemctl status wxkf-mvp --no-pager'
```

### 4. Cloudflare 加子域 DNS

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `kf` | `8.220.191.148` | 🟠 Proxied |

（Origin Rule 的 `*beisuyinqing.tech → 8443` 已自动覆盖 `kf.beisuyinqing.tech`，无需改。）

### 5. nginx 加 8443 server 块

新建 `/etc/nginx/sites-available/kf.beisuyinqing.tech`：

```nginx
server {
    listen 8443 ssl http2;
    listen [::]:8443 ssl http2;
    server_name kf.beisuyinqing.tech;

    ssl_certificate     /etc/nginx/ssl/beisuyinqing.tech/cert.pem;   # 复用现有泛域名 Origin Cert
    ssl_certificate_key /etc/nginx/ssl/beisuyinqing.tech/key.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ssh aliyun-manila '
  ln -sf /etc/nginx/sites-available/kf.beisuyinqing.tech /etc/nginx/sites-enabled/
  nginx -t && systemctl reload nginx
'
```

验证（走 Cloudflare）：

```bash
curl -s https://kf.beisuyinqing.tech/healthz   # 期望: ok
```

### 6. 企业微信后台配置

企业微信管理后台 → **微信客服**：

1. **API** 区：记下 `Secret`，企业 `corpid`（我的企业 → 企业信息）。
2. **回调配置**：
   - URL：`https://kf.beisuyinqing.tech/wxkf/callback`
   - Token / EncodingAESKey：自己设置/随机生成，**和 `.env` 里保持一致**。
   - 点保存 → 微信发 GET 验证 → 服务返回解密 echostr → 配置成功。
3. **企业可信IP**：把 ECS 出口公网 IP **`8.220.191.148`** 加进去
   （否则调 `gettoken`/`sync_msg`/`send_msg` 会报 `60020 not allow to access from your ip`）。
4. 创建一个**客服账号**，拿到对外二维码/链接，用微信扫码进去发条消息测试。

发一条文本，应收到 `你说的是：xxx` 的回显。

---

## 常见坑

| 现象 | 原因 / 处理 |
|---|---|
| 回调保存失败 | `.env` 的 Token/AESKey 与后台不一致；或 URL 不通（先 `curl /healthz`）|
| `errcode 60020` | ECS 出口 IP 没进「企业可信IP」白名单 |
| `errcode 95012` send_msg 失败 | 用户超过 48h 未发消息，无法主动推送（回显场景不会触发）|
| 收到重复消息 | `sync_msg` 必须带上次的 `next_cursor`（本项目已用 `cursor.json` 持久化）|
| 回调超时 | 微信要求 5s 内响应；本项目先 `res.send('success')` 再异步拉消息 |

## 下一步可扩展

- 回显逻辑在 `server.js` 的 `handleNewMessages()`，把那段换成调大模型即可做自动客服。
- 多客服账号天然支持（按 `open_kfid` 区分 + 各自游标）。
- 图片/语音消息：`sync_msg` 返回 `msgtype` 为 `image`/`voice` 等，按需在循环里分支处理。
