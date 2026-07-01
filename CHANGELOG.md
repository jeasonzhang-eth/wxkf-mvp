# Changelog

## 2026-06-20
- **feat**: 消息持久化存储 (`src/store.js`) — append-only JSON 文件，按 external_userid 分组
- **feat**: REST API (`/api/conversations`, `/api/messages`, `/api/send`) — 会话列表、消息查询、发送回复
- **feat**: 聊天查看页面 (`/chat`) — 左侧会话列表 + 右侧聊天记录 + 底部消息输入框，支持手机端面板切换
- **feat**: 微信用户昵称解析 (`/api/names`) — 调企业微信 API 获取昵称，本地 names.json 缓存
- **feat**: 账号密码登录系统 (`src/auth.js`) — scrypt 密码哈希 + 内存 session + HttpOnly cookie
- **feat**: 登录页面 (`/login`) — 居中卡片式表单，登录后跳转 /chat
- **refactor**: `server.js` 中 `handleNewMessages` 改为同时存储入站和出站消息
- **refactor**: `chat.html` 移至 `views/` 目录，防止 express.static 绕过鉴权
- **chore**: `.gitignore` 新增 `messages.json`、`names.json`（运行时数据）

## 2026-06-14
- **feat**: 初始化项目 — 企业微信「微信客服」回调接入 MVP

## 2026-07-01
- **fix**: 登录表单 async onsubmit 返回 Promise 拦不住原生提交，页面刷新导致「点击无反应」；改用 preventDefault
- **feat**: 登录页密码框加显示/隐藏切换（眼睛按钮）
- **feat**: 支持一个应用监控多个客服账号 —— 会话按 `open_kfid + external_userid` 组合分组，列表/聊天头显示客服账号名（`kf/account/list` 拉取缓存到 `kf_accounts.json`），消息按客服过滤，避免同一用户跨客服合并
