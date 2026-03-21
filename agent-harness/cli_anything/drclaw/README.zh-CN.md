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

当前集成已经有三层稳定能力：
- **控制面**：OpenClaw 直接执行本地 `drclaw ...` 命令
- **结构化契约**：主要 JSON 响应都带顶层 `openclaw` 字段
- **主动推送**：后台 watcher 可以把重要项目变化通过 OpenClaw 主动推到 Feishu/Lark

### 最低前置条件

接入 OpenClaw 之前，先确认：
- Dr. Claw 服务已启动
- 本地已安装 `drclaw` CLI
- 至少已经存在一个 Dr. Claw 项目
- OpenClaw 具备本地 shell 或 `exec` 能力
- 如果要做推送，OpenClaw 已经能往 Feishu/Lark channel 发消息

### 推荐先跑通的命令

```bash
drclaw --json chat waiting
drclaw --json digest portfolio
drclaw --json digest project --project <project-ref>
drclaw --json workflow status --project <project-ref>
```

如果 OpenClaw 能执行这些命令并正确消费 JSON，核心集成就已经跑通了。

### 一键安装给 OpenClaw

```bash
drclaw install --server-url http://localhost:3001
```

这个命令会：
- 把 Dr. Claw skill 复制到 `~/.openclaw/workspace/skills/drclaw`
- 安装 OpenClaw 本地串行调用需要的 wrapper script
- 把当前 Dr. Claw 服务地址保存到 `~/.drclaw_session.json`
- 记录本地 `drclaw` 可执行路径，供 OpenClaw 使用

如果想同时保存默认推送 channel：

```bash
drclaw install --server-url http://localhost:3001 --push-channel feishu:<chat_id>
```

也可以用 OpenClaw 风格别名：

```bash
drclaw openclaw install --server-url http://localhost:3001
```

### 串行化本地 turn

当 OpenClaw 用 `openclaw agent --local` 调本地能力时，建议走 wrapper，避免 session lock 冲突：

```bash
agent-harness/skills/dr-claw/scripts/openclaw_drclaw_turn.sh --json -m "Use your exec tool to run `drclaw --json digest portfolio`. Return only the result."
```

## Watcher 和主动通知

watcher 现在是事件驱动的。它会监听 Dr. Claw 的 WebSocket 事件，只在真正值得提醒的变化上发通知。

先配置默认推送 channel：

```bash
drclaw openclaw configure --push-channel feishu:<chat_id>
```

启动、查看状态、停止：

```bash
drclaw --json openclaw-watch on --to feishu:<chat_id>
drclaw --json openclaw-watch status
drclaw --json openclaw-watch off
```

它会做这些事：
- 订阅 Dr. Claw WebSocket 事件，而不是轮询 digest
- 在可能时把 task、project、file-change 事件解析到具体项目
- 对比 workflow snapshot，提炼高层 signal，而不是转发原始事件名
- 用稳定签名和 6 小时 TTL 做去重
- 调 `openclaw agent --deliver` 生成最终给人看的 Feishu/Lark 摘要
- 如果 agent 总结失败，回退到 bridge 直接发送
- 状态保存在 `~/.drclaw/openclaw-watcher-state.json`
- 日志保存在 `~/.drclaw/logs/openclaw-watcher.log`

当前重要 signal 包括：
- `human_decision_needed`
- `waiting_for_human`
- `blocker_detected`
- `blocker_cleared`
- `task_completed`
- `next_task_changed`
- `attention_needed`
- `session_aborted`

## Structured OpenClaw Schema

主要面向机器的命令现在都会返回版本化的 `openclaw` 字段。

当前 schema 家族：
- `openclaw.turn.v1`
- `openclaw.project.v1`
- `openclaw.portfolio.v1`
- `openclaw.daily.v1`
- `openclaw.report.v1`
- `openclaw.event.v1`

正式契约文档：

```bash
cat agent-harness/cli_anything/drclaw/SCHEMA.md
```

给客户端的推荐消费规则：
- 用 `openclaw.decision.needed` 判断是否要打断用户
- 用 `openclaw.next_actions` 生成快捷操作或语音建议
- 用 `openclaw.turn.summary` 或 portfolio 的 `openclaw.focus` 做紧凑展示
- watcher 通知优先读 `openclaw.event.v1.event.signals`
- 只要有 `openclaw` 字段，就不要只依赖原始 `reply` 文本

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
