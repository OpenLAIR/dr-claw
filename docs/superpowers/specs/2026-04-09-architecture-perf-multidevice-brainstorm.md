# VibeLab 架构性能 × 多端协同 × 交互控制：发散分析

> Date: 2026-04-09
> Scope: Low-hanging fruit & high-impact opportunities
> Codebase: main @ 7cfc883 (v1.1.3)
> Open PRs surveyed: #134, #135, #136, #138, #141, #142, #152

---

## Executive Summary

VibeLab 的核心瓶颈是一个 3,176 行的 server/index.js 单体文件，同时承载 HTTP、WebSocket chat、Shell PTY 和项目发现四大职责。前端 `useProjectsState` (1,086 行) 在每次 `projects_updated` 消息时做全量 JSON.stringify 对比，37 个 dependency 的 useMemo 导致整个 sidebar 频繁重渲染。Session 并发被 `isActive()` guard 硬性阻止且无客户端反馈。这三个结构性问题是后续所有 feature（多 session 并行、插件协同、多端支持）的前置障碍。

下面按 **Effort / Impact 象限** 组织所有发现。

---

## 一、Low Effort × High Impact（立即可做）

### 1.1 Provider 崩溃后客户端无反馈 → 静默挂起

**现状**: `server/index.js:1553` — Claude query 的 `.catch()` 只 `console.error`，不向客户端发送任何错误消息。Codex (line 1611)、Cursor (line 1582)、OpenRouter (line 1682)、Local GPU (line 1712) 全部如此。唯一有 fallback 链的是 Gemini (line 1641-1655)。

**用户体验**: 如果 provider 在流式传输中途崩溃，前端 `isLoading` 永远为 true，用户看到一个无限转圈的 spinner，必须手动刷新。

**修复**: 在每个 provider 的 `.catch()` 中加入 `writer.send({ type: '<provider>-error', error: error.message })`。前端已有 error 处理逻辑 (errorClassifier.js)，只需要 server 发消息即可。

**估计工作量**: 1-2 小时。6 处 catch block，每处加 3 行。

---

### 1.2 Session 并发拒绝 → 静默丢弃请求

**现状**: `server/index.js:1547-1551` — 当 session 已 active 时直接 `return`，不通知客户端。所有 6 个 provider 都是这个模式。

```js
if (sessionId && isClaudeSDKSessionActive(sessionId)) {
    console.log(`[WARN] Session ${sessionId} is already active. Ignoring concurrent request.`);
    return;  // ← 客户端完全不知道发生了什么
}
```

**修复**: 改为发送 `{ type: 'session-busy', sessionId, provider }` 消息。前端显示 toast/inline 提示。

**估计工作量**: 2-3 小时。6 处 guard + 前端 toast 组件。

**延伸机会**: 这个 guard 是阻止 **多 Session 并行** 的核心障碍。修复后可以进一步讨论是否允许同一 provider 的多个 session 同时活跃。

---

### 1.3 WebSocket 重连无指数退避

**现状**: `WebSocketContext.tsx:107-110` — 固定 3 秒重连。如果服务器持续不可用，客户端每 3 秒发一次连接请求。

**修复**: 改为指数退避 (3s → 6s → 12s → 30s max)，加一个 "Reconnecting..." UI 指示器。

**估计工作量**: 30 分钟。

---

### 1.4 数据库缺少关键索引

**现状**: `session_metadata` 表按 `datetime(last_activity) DESC` 排序（db.js），但无 `last_activity` 索引。`projects` 表同样缺少 `last_accessed` 索引。

```sql
-- 当前: 全表扫描 + 内存排序
SELECT * FROM session_metadata WHERE project_name IN (...)
ORDER BY datetime(last_activity) DESC
```

**修复**:
```sql
CREATE INDEX idx_session_metadata_activity ON session_metadata(last_activity);
CREATE INDEX idx_session_metadata_composite ON session_metadata(project_name, provider, last_activity);
CREATE INDEX idx_projects_accessed ON projects(last_accessed);
```

**估计工作量**: 30 分钟。Migration + 测试。

---

### 1.5 Trash 系统无 TTL 自动清理

**现状**: `projects.js:2415` — deleteProject 写入 `trashedAt` 时间戳但无任何清理机制。Trash 条目永久累积在 `~/.claude/project-config.json` 中。

**修复**: Server 启动时 + 每 24h 定时扫描 trash，超过 30 天的自动调用 `deleteTrashedProject(name, 'logical')`。可配置 TTL。

**估计工作量**: 2-3 小时。

---

## 二、Low Effort × Medium Impact（近期值得做）

### 2.1 前端 Error Boundary 缺失

**现状**: `App.tsx` (37 行) — 无 React Error Boundary。ChatInterface 任何 JS 错误直接白屏。

**修复**: 在 `<AppContent>` 外包一层 ErrorBoundary，fallback 显示 "Something went wrong" + 重试按钮。

---

### 2.2 WebSocket 消息队列无上限

**现状**: `WebSocketContext.tsx:46` — `messageQueueRef.current` 是普通数组，无 maxLength。如果消费者慢（比如 React 渲染卡顿），队列无限增长。

**修复**: 加 maxLength = 1000，超出时丢弃最旧消息 + 发 warning。

---

### 2.3 PTY Session 内存泄漏风险

**现状**: `server/index.js:2214-2230` — WebSocket 断开后 PTY session 保留 30 分钟。如果客户端异常断开（网络故障），sessions 积压。`ptySessionsMap` 无上限。

**修复**: 
- 加 `MAX_PTY_SESSIONS = 20` 上限
- 新建 session 时如果超限，evict 最旧的 idle session
- 减少 timeout 到 10 分钟

---

### 2.4 项目广播全量推送

**现状**: `server/index.js:198-221` — 每次文件变化调用 `getProjects()` 获取完整项目列表，JSON.stringify 后和上次比较，然后广播给所有客户端。

**优化方向**: 
- 发送增量更新 `{ type: 'project-delta', action: 'session-added', projectName, session }` 而非全量
- 前端 patch 本地 state 而非替换

**估计工作量**: 4-6 小时（需要同时改 server broadcast 和前端 state 处理）。

---

## 三、Medium Effort × High Impact（架构性改进）

### 3.1 server/index.js 拆分 — 架构根因

**现状**: 3,176 行单文件，包含：
- HTTP 中间件 + 路由注册 (lines 1-400)
- 项目发现 + chokidar watchers (lines 100-277)
- WebSocket chat handler (lines 1495-1837) — 13 种消息类型
- Shell/PTY handler (lines 1847-2236)
- Compute shell handler (lines 2251-2430)
- 启动逻辑 (lines 2431+)

**拆分建议**:
```
server/
├── index.js              ← 只保留 Express 初始化 + server.listen (~200 行)
├── ws/
│   ├── chat-handler.js   ← 所有 claude/codex/gemini/... 消息路由
│   ├── shell-handler.js  ← PTY session 管理
│   ├── compute-handler.js ← 远程计算 shell
│   └── writer.js         ← WebSocketWriter 类
├── watchers/
│   └── project-watcher.js ← chokidar 相关逻辑
└── providers/             ← 已有，无需变动
```

**杠杆效应**: 拆分后每个 handler 可以独立测试、独立部署、独立限流。是多 session 并行和插件系统的前置条件。

**估计工作量**: 8-12 小时（纯重构，不改行为）。

---

### 3.2 useProjectsState 拆分 — 前端性能根因

**现状**: 1,086 行单 hook，14 个 useState + 3 个 useRef。`sidebarSharedProps` 有 37 个 dependency，每次变化重算整个对象。`projectsHaveChanges()` 对每个项目做 9 次 JSON.stringify 比较。

**拆分建议**:
```
hooks/
├── useProjectsList.ts       ← projects[], trashedProjects[] 管理
├── useSessionSelection.ts   ← selectedProject, selectedSession, active sessions
├── useSidebarUI.ts          ← collapsed, settings, sort preferences
└── useProjectsState.ts      ← thin orchestration layer combining above three
```

**优化**:
- 用 `useSyncExternalStore` 或 `zustand` 替换 14 个 useState
- projectsHaveChanges() 改用 shallow comparison（比较 project.name + session count + last_activity 即可）
- 给 Sidebar, ChatMessagesPane 加 `React.memo`

**估计工作量**: 8-12 小时。

---

### 3.3 多 Session 并行 — 架构核心能力

**现状**: 
- Server: 每个 provider 的 `isActive()` guard 阻止同 session 并发（合理），但也阻止了同 provider 的不同 session 并发（不合理——实际上不同 sessionId 已经可以并发）
- Frontend: `ChatInterface.tsx` 只有一个 `isLoading` 状态，一个 `selectedSession`，无法同时显示多个 chat panel

**实现路径**:

**Phase A — 后端并发解锁** (已就绪):
- 现有 guard 只检查 same sessionId，不同 session 已经可以并发
- 需要：让前端能同时发送多个不同 sessionId 的消息

**Phase B — 前端 split-panel**:
```
┌─────────────────────────┐
│  Sidebar  │  Panel A    │  Panel B    │
│           │  (Claude)   │  (Gemini)   │
│           │  Session 1  │  Session 2  │
└─────────────────────────┘
```
- 路由: `/session/:id1/and/:id2`
- 每个 panel 独立的 ChatInterface 实例
- 共享同一个 WebSocket 连接，按 sessionId 分发消息
- 每个 panel 独立的 `isLoading`, `streamBuffer`, `permissionRequests`

**Phase C — 多 provider 混合 session**:
- 同一个 project 下同时运行 Claude 和 Gemini
- 比较输出，选择更好的回答
- "Race mode": 两个 provider 同时回答，先完成的显示

**估计工作量**: Phase A: 2h, Phase B: 16-24h, Phase C: 8-12h。

---

### 3.4 /btw 动态干预扩展 (PR #138 基础上)

**现状**: PR #138 实现了 Claude-only 的 `/btw` side-question，overlay 式一次性回答，不进入主对话。

**扩展方向**:

**A. 多 Provider 支持**:
- 当前只有 `runClaudeBtw` + `POST /api/claude/btw` (claude-sdk.js:67 行新增)
- 扩展到 OpenRouter、Gemini API (都支持单次 completion)
- Codex/Cursor CLI 不适合（无单次 query 模式）

**B. 上下文感知干预**:
- `/btw` 当前传入对话上下文（最近 N 条消息），让 side-model 基于对话历史回答
- 扩展：传入当前打开的文件、选中的代码片段、工具输出
- 场景："这个 error 是什么意思？" — 自动附带最近的错误输出

**C. 流式传输中的 /btw**:
- 当前 chat composer 在 streaming 时不禁用 `/` 命令 (PR #138 的设计)
- 这是一个很好的 UX 决策：允许用户在等待长回答时问一个快速问题
- 扩展：overlay 可以 pin 住，变成 side panel

**D. /btw 作为 Provider 切换入口**:
- 场景：主对话用 Claude (强但慢)，/btw 用 Gemini Flash (快但浅)
- 自动选择最快的可用 provider 回答

---

### 3.5 插件系统深化 (PR #152 基础上)

**现状**: 
- Skill catalog (skills-catalog-v2.json) + SKILL.md 文件
- PR #152 加了 skill expansion (server/utils/skillExpander.js) — 把 @skill-name 替换为 SKILL.md 内容
- 上传/删除/标签管理通过 REST API (server/routes/skills.js)

**缺失**:

**A. Plugin 热加载 (Hot Reload)**:
- 当前修改 SKILL.md 后需要重启或重新上传
- 改进：用 chokidar 监听 skills/ 目录，变化时自动刷新 catalog 缓存

**B. Plugin Marketplace / Registry**:
- 当前 skills 全部本地
- 扩展：支持 `npm install @drclaw/skill-<name>` 或 git clone
- 社区 skill 发现 + 评分系统

**C. Plugin 沙箱隔离**:
- 当前 skill expansion 直接注入到 system prompt，没有执行隔离
- 风险：恶意 skill 可以 prompt-inject 到 agent 中
- 改进：skill 内容经过 sanitize，或者使用独立的 context window

**D. Plugin 间协作**:
- 场景：deep-research skill 产出文献综述 → paper-writing skill 自动引用
- 需要：shared artifact store（当前各 skill 写文件到不同目录，没有统一的 artifact registry）

**E. Plugin 版本管理**:
- 当前无版本概念
- 改进：SKILL.md frontmatter 加 `version: 1.2.0`，catalog 支持 version 过滤

---

### 3.6 Nano Claude Code 接入完善 (PR #141 基础上)

**现状**: 
- `server/nano-claude-code.js` 已实现 stream-json harness
- 映射到 `claude-response` / `claude-complete` WebSocket 消息（复用现有 UI）
- 多轮对话需要上游 CLI 支持 `--session-file` + `--resume`

**优化方向**:

**A. Session 持久化 workaround**:
- 在上游支持 `--resume` 之前，server 端维护对话历史
- 每轮结束时保存 messages 到 `~/.dr-claw/nano-sessions/{sessionId}.json`
- 下轮开始时读取历史，注入到 prompt 中（类似 OpenRouter 的做法）

**B. Provider fallback 链**:
- Claude SDK 失败 → 降级到 Nano Claw Code (免费，本地)
- 类似 Gemini 已有的 API → CLI fallback 模式

**C. 统一 Provider 接口**:
- 所有 7 个 provider 的消息类型统一为 `agent-response` / `agent-complete`
- 前端不再需要 switch on message type

---

## 四、High Effort × High Impact（战略级改进）

### 4.1 OpenClaw 手机端

**现状**: 
- 前端是纯 React，理论上浏览器可直接访问
- 无 PWA manifest、无 service worker、无 responsive breakpoints
- 依赖 WebSocket 长连接，移动网络环境下不稳定

**路径选择**:

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. PWA** | 最小改动，复用现有代码 | iOS Safari WebSocket 限制，无原生通知 |
| **B. React Native** | 原生体验，Push 通知 | 代码不共享，维护成本高 |
| **C. Capacitor/Ionic** | 复用 React 代码，打包原生壳 | WebView 性能一般 |
| **D. 纯移动 Web（响应式）** | 零额外成本 | 体验最差 |

**推荐: A (PWA) → D (响应式) 渐进式**:
1. 先做响应式 CSS（移动 sidebar 折叠、touch-friendly 按钮）
2. 加 PWA manifest + service worker（离线支持、Install 提示）
3. 加 push notification via Web Push API（session 完成通知）

**移动端特有需求**:
- Voice input → text（用 Web Speech API）
- 简化版 chat UI（隐藏 file tree, shell, compute dashboard）
- Session 状态 push notification（"Claude finished your task"）
- 断线恢复：消息缓存 + 自动 resume

---

### 4.2 桌面端方向决策

**现状矛盾**: 
- `electron/main.mjs` (26KB) 存在且功能完整
- PR #134 大规模移除 Electron 基础设施
- 方向不明确

**需要回答的问题**:
1. Electron 是否继续维护？还是转向 Tauri (更轻量)?
2. 桌面端的核心差异化是什么？（系统托盘、全局快捷键、文件系统深度集成？）
3. 还是纯 Web + PWA 就够了？

**如果继续桌面端**:
- 系统托盘常驻，显示 active sessions 状态
- 全局快捷键 (Cmd+Shift+Space) 唤起 /btw overlay
- 拖拽文件到 dock icon 直接进入 chat
- 剪贴板监听 → 自动 context attachment

**如果放弃 Electron**:
- Tauri (Rust backend + WebView) — 包体 5MB vs Electron 150MB
- 或者纯 PWA + 浏览器扩展

---

### 4.3 多端协同 — Session 跨设备漫游

**场景**: 桌面开始一个研究 session → 出门后手机上继续看 streaming → 回来桌面接手

**技术要求**:
- Session state 必须 server-side（当前部分在 localStorage）
- WebSocket 支持 session 级别的 subscribe/unsubscribe
- 消息送达确认（当前无 ACK 机制）
- 多客户端同时连接同一 session 时的消息广播

**实现草案**:
```
Client A (Desktop)                Server                Client B (Mobile)
     │                              │                         │
     ├── subscribe(session-1) ──────┤                         │
     │                              ├── subscribe(session-1) ─┤
     │                              │                         │
     ├── send(message) ─────────────┤── broadcast(msg) ───────┤
     │                              │                         │
     │◄─── stream(response) ────────┤── stream(response) ────►│
     │                              │                         │
     ├── unsubscribe ───────────────┤                         │
     │                              │   (Mobile continues)    │
```

---

## 五、安全加固（PR #135, #136 延伸）

### 5.1 已在 PR 中修复
- Shell injection in user.js, openrouter.js, cli-chat.js (PR #135)
- Path traversal in tool calls (PR #136, safePath utility)
- CORS 限制 (PR #135)

### 5.2 仍然存在的风险

**A. Skill expansion 的 prompt injection 风险**:
- `server/utils/skillExpander.js` 读取 SKILL.md 内容直接注入到 user prompt
- 恶意 skill 可以包含 "ignore all previous instructions" 类攻击
- 改进：skill content 放在 system message 而非 user message，或者加 sanitize

**B. WebSocket 认证**:
- `authenticateWebSocket` 在连接时验证一次
- 之后所有消息不再验证 token
- 风险：token 过期后连接仍然有效
- 改进：定期 heartbeat + token 刷新

**C. 并发 tool approval race condition**:
- `permissions.js` 的 `pendingToolApprovals` Map 是全局的
- 同一 session 如果有多个 tool request in flight，理论上可能 race
- 实际风险低（SDK 串行处理 tool calls），但应加 session-scoped locking

---

## 六、机会矩阵

```
                    Low Impact          Medium Impact         High Impact
                ┌─────────────────┬─────────────────────┬─────────────────────┐
 Low Effort     │ WS 指数退避     │ DB 索引             │ Provider 崩溃反馈   │
 (< 4h)         │ WS 队列上限     │ Error Boundary      │ Session 并发反馈    │
                │ PTY 上限         │ Trash TTL           │                     │
                ├─────────────────┼─────────────────────┼─────────────────────┤
 Medium Effort  │ Skill 热加载    │ 广播增量化          │ server/index.js 拆分│
 (4-16h)        │ Nano 降级链     │ /btw 多 Provider    │ useProjectsState 拆分│
                │ Plugin 版本管理 │ Provider 消息统一   │                     │
                ├─────────────────┼─────────────────────┼─────────────────────┤
 High Effort    │                 │ 桌面端方向决策      │ 多 Session 并行     │
 (> 16h)        │                 │ Plugin Marketplace  │ 手机端 PWA          │
                │                 │ Plugin 沙箱         │ 跨设备 Session 漫游 │
                └─────────────────┴─────────────────────┴─────────────────────┘
```

---

## 七、建议执行顺序

**Sprint 1 (本周)** — Low-hanging fruit, 立即改善稳定性:
1. Provider 崩溃 → 客户端错误反馈 (1.1)
2. Session 并发 → 客户端提示 (1.2)
3. DB 索引 (1.4)
4. WS 指数退避 (1.3)
5. Error Boundary (2.1)

**Sprint 2 (下周)** — 架构解耦，为并行能力铺路:
1. server/index.js 拆分 (3.1)
2. useProjectsState 拆分 (3.2)
3. 广播增量化 (2.4)
4. Trash TTL (1.5)

**Sprint 3 (两周后)** — 核心新能力:
1. 多 Session 并行 Phase A+B (3.3)
2. /btw 多 Provider 扩展 (3.4)
3. Nano 降级链 + Provider 统一消息 (3.6)

**Sprint 4 (一个月)** — 多端 + 生态:
1. 移动端响应式 + PWA (4.1)
2. 桌面端方向决策 + 实施 (4.2)
3. Plugin 热加载 + 版本管理 (3.5)

---

## 附录：关键代码位置索引

| 模块 | 文件 | 关键行号 |
|------|------|----------|
| WS 消息路由 | server/index.js | 1516-1837 |
| Session 并发 guard | server/index.js | 1547-1697 (6处) |
| Provider 错误吞没 | server/index.js | 1553, 1582, 1611, 1682, 1712 |
| PTY 管理 | server/index.js | 1859-2236 |
| 项目广播 | server/index.js | 198-221 |
| 前端 WS | src/contexts/WebSocketContext.tsx | 107-110 (重连) |
| 项目状态 | src/hooks/useProjectsState.ts | 71-109 (stringify), 980-1039 (37 deps) |
| Chat 单 session | src/components/chat/view/ChatInterface.tsx | 147 (pendingViewSessionRef), 185 (isLoading) |
| 权限系统 | server/utils/permissions.js | pendingToolApprovals Map |
| Trash | server/projects.js | 2415 (delete), 2575 (permanent) |
| DB schema | server/database/db.js | session_metadata, projects 表 |
| Skill 扩展 | server/utils/skillExpander.js | 全文 142 行 |
| /btw overlay | PR #138 | server/routes/claude-btw.js, BtwOverlay.tsx |
| Nano provider | PR #141 | server/nano-claude-code.js (303 行) |
