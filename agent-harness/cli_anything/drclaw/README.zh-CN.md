# drclaw

`drclaw` 是一个有状态的 Python CLI，用来从终端、自动化脚本和 OpenClaw 中操作 Dr. Claw。

它把 Dr. Claw 变成一个可控的研究后端，让另一个 agent 可以：
- 查看项目和会话
- 找到等待用户输入的对话
- 回复指定会话
- 继续、批准、拒绝、重试、恢复 workflow
- 汇总项目进度和整个 portfolio 状态
- 把紧凑报告推送到移动端 / OpenClaw

## 这个 CLI 是做什么的

`drclaw` 是三层之间的控制面：
- **Dr. Claw**：研究工作区和服务端
- **`drclaw` CLI**：稳定的机器接口
- **OpenClaw**：面向移动端 / 聊天 / 语音的助手，通过调用 CLI 给用户反馈

典型流程是：用户和 OpenClaw 对话，OpenClaw 执行 `drclaw ...`，然后 Dr. Claw 在正确的项目或会话里继续执行。

## 安装

在仓库根目录执行：

```bash
pip install -e ./agent-harness
```

主入口命令是 `drclaw`。为了兼容改名前的用法，`vibelab` 别名仍然可用。

安装后先验证：

```bash
drclaw --help
drclaw --json projects list
```

如果你本机没有把命令装进 PATH，也可以直接用模块方式调用：

```bash
PYTHONPATH=agent-harness python3 -m cli_anything.drclaw.drclaw_cli --help
```

## 服务和登录

先检查本地 Dr. Claw 服务是否可用：

```bash
drclaw server status
```

如果没启动：

```bash
drclaw server on
```

然后登录：

```bash
drclaw auth login --username <username> --password <password>
```

登录态保存在 `~/.drclaw_session.json`。

常用认证命令：

```bash
drclaw auth status
drclaw auth logout
```

如果 `~/.drclaw_session.json` 里只有 OpenClaw 配置而没有 `token`，那像 `projects list`、`chat waiting` 这类命令会返回 `Not logged in`。

## 怎么使用

### 1. 先找到项目

列出所有项目：

```bash
drclaw --json projects list
```

凡是参数里写 `<project-ref>` 的地方，都可以传：
- 项目的 `name`
- 项目的 `displayName`
- 项目的文件系统 `path` 或 `fullPath`

### 2. 查看当前状态

看项目最近一次对话：

```bash
drclaw --json projects latest <project-ref>
```

看项目进度和下一步：

```bash
drclaw --json projects progress <project-ref>
drclaw --json workflow status --project <project-ref>
drclaw --json digest project --project <project-ref>
```

看整个 portfolio：

```bash
drclaw --json digest portfolio
drclaw --json digest daily
```

### 3. 找出哪些会话在等回复

查看所有项目里等待中的会话：

```bash
drclaw --json chat waiting
```

只看某一个项目：

```bash
drclaw --json chat waiting --project <project-ref>
```

列出一个项目下的已知会话：

```bash
drclaw --json chat sessions --project <project-ref>
drclaw --json sessions list <project-ref>
```

读取某个会话的消息历史：

```bash
drclaw --json sessions messages <project-ref> <session-id> --provider claude --limit 100
```

### 4. 和项目对话，或者回复等待中的会话

给项目发一条新消息：

```bash
drclaw --json chat send --project <project-ref> --message "What changed?"
```

回复一个等待中的会话：

```bash
drclaw --json chat reply --project <project-ref> --session <session-id> -m "Please continue with the plan and tell me the next decision point."
```

在一个指定项目会话里继续对话：

```bash
drclaw --json chat project --project <project-ref> --session <session-id> -m "Summarize the current blockers and propose the next three actions."
```

### 5. 显式控制 workflow

当用户想要明确控制执行，而不只是自然语言对话时，用这些命令：

```bash
drclaw --json workflow status --project <project-ref>
drclaw --json workflow continue --project <project-ref> --session <session-id> -m "<instruction>"
drclaw --json workflow approve --project <project-ref> --session <session-id>
drclaw --json workflow reject --project <project-ref> --session <session-id> -m "<reason>"
drclaw --json workflow retry --project <project-ref> --session <session-id>
drclaw --json workflow resume --project <project-ref> --session <session-id>
```

### 6. 使用 TaskMaster 和 artifacts

```bash
drclaw --json taskmaster detect <project-ref>
drclaw --json taskmaster summary <project-ref>
drclaw --json taskmaster next <project-ref>
drclaw --json taskmaster next-guidance <project-ref>
drclaw --json taskmaster artifacts --project <project-ref>
```

如果一个项目还没初始化 TaskMaster：

```bash
drclaw taskmaster init <project-ref>
```

### 7. 创建或管理项目

创建一个新的空项目：

```bash
drclaw --json projects create /abs/path --name "Display Name"
```

从一个新 idea 创建项目，并立即启动第一次讨论：

```bash
drclaw --json projects idea /abs/path --name "Display Name" --idea "Build an OpenClaw-native project secretary for Dr. Claw"
```

添加、重命名、删除项目：

```bash
drclaw projects add /abs/path --name "Display Name"
drclaw projects rename <project-ref> "New Display Name"
drclaw projects delete <project-ref>
```

## 重要聊天参数

高级聊天和 workflow 命令支持：
- `--provider [claude|gemini|codex|cursor]`：强制指定 provider
- `--bypass-permissions`：自动批准工具调用，适合自动化
- `--timeout <seconds>`：硬超时
- `--attach <path>`：附加文件或图片，可重复传入
- `--model <model-id>`：覆盖默认模型

如果不传 `--timeout`，CLI 会使用 heartbeat 检测等待完成，并带 1 小时的安全上限。对于长时间研究任务，这通常是更合适的默认行为。

## OpenClaw 集成

> OpenClaw 通过本地调用 `drclaw` 命令，把 Dr. Claw 变成一个移动端友好、支持语音的研究秘书。

```
用户（手机 / 聊天 / 语音）
  ↕
OpenClaw  ── 执行 `drclaw ...` ──→  drclaw CLI  ──→  Dr. Claw 服务
                ↑                                        │ WebSocket
                └─── 主动推送 ←──────── Watcher ─────────┘
```

| 层级 | 功能 |
|------|------|
| **控制面** | OpenClaw 在本地执行 `drclaw --json ...` 命令 |
| **结构化契约** | JSON 响应携带版本化的 `openclaw.*` schema |
| **主动推送** | 事件驱动的 watcher 把重要变化推送到飞书 / Lark |

### 快速接入

```bash
# 1. 安装并关联
drclaw install --server-url http://localhost:3001
# 带推送 channel：
drclaw install --server-url http://localhost:3001 --push-channel feishu:<chat_id>
```

### 验证核心命令

```bash
drclaw --json chat waiting                             # 等待回复的会话
drclaw --json digest portfolio                         # 跨项目汇总
drclaw --json digest project --project <project-ref>   # 单项目摘要
drclaw --json workflow status --project <project-ref>   # 项目状态
```

如果 OpenClaw 能执行这些命令并正确消费 JSON，核心集成就已经跑通了。

### 串行化本地 turn

当 OpenClaw 用 `openclaw agent --local` 调本地能力时，建议走 wrapper 避免 session lock 冲突：

```bash
agent-harness/skills/dr-claw/scripts/openclaw_drclaw_turn.sh \
  --json -m "Use your exec tool to run \`drclaw --json digest portfolio\`. Return only the result."
```

---

## Watcher 与主动通知

Watcher 订阅 Dr. Claw WebSocket 事件，只在真正值得提醒的变化上发通知。

```bash
# 配置推送 channel
drclaw openclaw configure --push-channel feishu:<chat_id>

# 管理 watcher
drclaw --json openclaw-watch on --to feishu:<chat_id>
drclaw --json openclaw-watch status
drclaw --json openclaw-watch off
```

**工作流程：**

```
WebSocket 事件 → 项目解析 → snapshot 对比 → signal 推导
    → 去重 (6h TTL) → openclaw agent --deliver → 飞书 / Lark 消息
```

**派生 signal：**

| Signal | 含义 |
|--------|------|
| `human_decision_needed` | Agent 请求工具调用权限 |
| `waiting_for_human` | 会话等待用户输入 |
| `blocker_detected` / `blocker_cleared` | 任务阻塞 / 解除阻塞 |
| `task_completed` | 任务完成 |
| `next_task_changed` | 推荐的下一个任务已变更 |
| `attention_needed` | 需要关注 |
| `session_aborted` | 会话执行中止 |

状态文件：`~/.drclaw/openclaw-watcher-state.json` | 日志：`~/.drclaw/logs/openclaw-watcher.log`

---

## 结构化 OpenClaw Schema

面向机器的命令返回版本化的 `openclaw` 字段：

| Schema | 用途 |
|--------|------|
| `openclaw.turn.v1` | 单轮对话摘要 |
| `openclaw.project.v1` | 项目摘要（状态、计数、下一步操作） |
| `openclaw.portfolio.v1` | 跨项目概览与建议 |
| `openclaw.daily.v1` | 每日摘要 |
| `openclaw.report.v1` | 移动端报告 |
| `openclaw.event.v1` | Watcher 事件与派生 signal |

**客户端消费建议：**

| 场景 | 读取字段 |
|------|---------|
| 判断是否需要打断用户 | `openclaw.decision.needed` |
| 快捷操作 / 语音建议 | `openclaw.next_actions` |
| 紧凑展示 | `openclaw.turn.summary` 或 `openclaw.focus` |
| 处理 watcher 通知 | `openclaw.event.v1.event.signals` |

> 只要有 `openclaw` 字段，就不要只依赖原始 `reply` 文本。

正式契约文档：[`SCHEMA.md`](SCHEMA.md)

## 常见用法

### 用户问：现在哪些在等我回复？

```bash
drclaw --json chat waiting
```

### 用户让 OpenClaw 帮他回复某个会话

```bash
drclaw --json chat reply --project <project-ref> --session <session-id> -m "Please proceed with option B and tell me the next milestone."
drclaw --json chat waiting --project <project-ref>
```

### 用户突然有了一个新 idea

```bash
drclaw --json projects idea /absolute/path/to/project --name "Idea Project" --idea "<idea text>"
```

### 用户想看跨项目进度和建议

```bash
drclaw --json digest portfolio
```

### 用户想推送一个适合移动端的报告

```bash
drclaw --json openclaw report --project <project-ref> --dry-run
drclaw openclaw report --project <project-ref>
```

## 配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DRCLAW_URL` | 服务端地址 | `http://localhost:3001` |
| `DRCLAW_TOKEN` | 不走 session file 直接注入 token | session file |
| `DRCLAW_LANG` | CLI 默认语言 | `en` |
| `VIBELAB_URL` | 兼容旧名的服务端地址 | `http://localhost:3001` |
| `VIBELAB_TOKEN` | 兼容旧名的 token fallback | session file |

`--url URL` 可以覆盖一次调用的 `DRCLAW_URL` 和 `VIBELAB_URL`。

## 排障

如果系统里找不到 `drclaw` 命令：

```bash
PYTHONPATH=agent-harness python3 -m cli_anything.drclaw.drclaw_cli --help
```

如果认证命令失败，先检查：

```bash
drclaw auth status
drclaw server status
```

如果 watcher 推送效果不对，检查：

```bash
drclaw --json openclaw-watch status
tail -n 50 ~/.drclaw/logs/openclaw-watcher.log
cat ~/.drclaw/openclaw-watcher-state.json
```

## 运行测试

```bash
PYTHONPATH=agent-harness python3 -m unittest cli_anything.drclaw.tests.test_core -q
```
