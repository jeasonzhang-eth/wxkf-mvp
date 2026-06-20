# Changelog

## 2026-06-20
- **feat**: 消息持久化存储 (`src/store.js`) — append-only JSON 文件，按 external_userid 分组
- **feat**: REST API (`/api/conversations`, `/api/messages`) — 供前端消费的会话列表和消息查询接口
- **feat**: 聊天查看页面 (`/chat`) — 左侧会话列表 + 右侧聊天记录，每 5s 自动刷新
- **refactor**: `server.js` 中 `handleNewMessages` 改为同时存储入站和出站消息
- **chore**: `.gitignore` 新增 `messages.json`（运行时数据）

## 2026-06-14
- **feat**: 初始化项目 — 企业微信「微信客服」回调接入 MVP
