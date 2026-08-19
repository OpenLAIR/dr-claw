# 从零部署 Dr. Claw Codex

本目录是新 Linux 服务器上部署 Codex 的唯一入口。它把可版本化的 Dr. Claw 环境安装成一套可重复、可检查、不会复制旧机器认证状态的基线：

- 完整 `skills/` 保留在固定 Git 版本中；
- Codex 原生只发现 `drclaw-skill-library` 路由器，以及在 NCSA Delta 上使用的 `ncsa-delta`；
- 全局约束写入 `$CODEX_HOME/AGENTS.md` 的受管区块；
- Codex 配置按明确 profile 合并；
- `doctor` 检查版本、skill、配置、主机和认证状态，但不打印凭据；`--full` 还会安装固定 Node 与完整 Web 应用层。

不要把旧机器的整个 `~/.codex` 或 `~/.agents` 搬到新服务器。正确的迁移单位是“固定版本的仓库 + 本安装器 + 在目标机重新完成的交互认证”。

## 一、部署边界

### 可以复制或从 Git 重建

| 内容 | 唯一来源 | 目标形态 |
|---|---|---|
| 172 个完整 skill 包 | 仓库 `skills/` | 留在固定版本的 checkout；包括 `SKILL.md`、脚本、references、assets 和模板 |
| skills 路由器 | `bootstrap/codex/skills/drclaw-skill-library/` | `$HOME/.agents/skills/drclaw-skill-library` |
| Delta 约束与工具 | `bootstrap/codex/vendor/ncsa-delta/` | `$HOME/.agents/skills/ncsa-delta` |
| 全局约束 | `bootstrap/codex/templates/global-agents.md` | 合并进 `$CODEX_HOME/AGENTS.md` 的受管区块 |
| 可移植配置 | `bootstrap/codex/templates/config.*.toml` | 合并到 `$CODEX_HOME/config.toml` 的根级键 |
| 安装记录 | `manifest.json` 与 Git revision | `$CODEX_HOME/drclaw-bootstrap-state.json`，不含秘密 |

默认使用符号链接安装两个用户级 skill，因此仓库 checkout 本身就是可审计的 source of truth。若目标文件系统不支持或不允许符号链接，可用 `--copy-skills` 复制这两个入口；**完整的 172 项库仍留在 checkout 中，所以两种模式都要求保留固定路径的仓库**。复制模式更新时必须重新运行安装器。

### 永远不要复制

- `~/.codex/auth.json`、任何 `*sqlite*`、sessions、archived sessions、日志、attachments、memory 或 goal 状态；
- `~/.codex/.tmp`、plugin marketplace 临时快照及其他产品管理目录；
- plugin/connector cache、OAuth token、API key、JWT secret、`.env`、设备登录码；
- SSH 私钥、ControlMaster socket、NCSA Kerberos 密码、Duo passcode；
- 另一台机器的绝对路径 trust 配置、项目 instance 路径、队列、账户、配额或 Slurm 作业状态；
- 旧机器上的整份 `~/.codex/plugins/cache`、`~/.codex/packages` 或模型缓存。

这些内容要么是秘密，要么是机器/会话状态。它们必须在目标机通过设备授权、OAuth、secret store 或实时只读探针重新建立。

## 二、三个容易混淆的状态

1. **已安装（installed）**：skill 的完整文件在仓库中，或两个受管 skill 已链接/复制到用户目录。
2. **可发现（discoverable）**：Codex 启动时能看到原生 skill。这里故意只暴露路由器与 Delta skill，不把 172 项全部塞进初始上下文；路由器按任务选出最小集合后再读取目标 `SKILL.md`。
3. **可运行（runnable）**：目标 skill 的外部命令、Python/Node 包、模型、MCP、账号和数据在当前服务器上都满足。

前两层通过不代表第三层成立。部分 imported skill 含 Claude 专用路径或外部 provider 依赖；`doctor` 会提示兼容性风险，执行前仍要阅读所选 skill 并验证依赖。plugin cache 的存在也不等于 connector 已授权。

当前基线的文件系统与生成 catalog 都包含 172 个 `SKILL.md`。文件系统仍是安装事实，catalog 由生成器/CI 校验；若以后出现 drift，路由器会从文件系统补齐并由 `doctor` 报告，不能通过删除完整 skill 来掩盖警告。

## 三、前置条件

- Linux 与 Python 3.9 或更高版本；
- Git；
- 能访问批准的 Dr. Claw Git revision；
- 若要由安装器安装 Codex，目标机需要访问官方 Codex installer；
- Node 不是 skills 路由器的依赖，只是完整 Dr. Claw Web 应用的可选依赖。

必须以最终实际运行 Codex 的非 root Unix 用户执行本方案；管理员应先 `sudo -iu <USER>`，再 clone 和安装。`--home` 只用于同一用户的隔离测试，不是跨用户 provision 开关；安装器会拒绝 root、owner 不匹配、受保护系统目录后代和隐式符号链接写穿。新建的 `$CODEX_HOME` 权限为 `0700`，已有目录若向 group/other 开放则由 doctor 警告。

生产部署必须由维护者批准一个 immutable Git tag 或完整 commit SHA。`manifest.json` 的 `audited_base_commit` 只是编写本方案时检查的起始树，并不包含当时尚未提交的 bootstrap；合并本变更后，维护者必须把 `bundle_release_ref` 更新为真正包含这些文件的 release tag/完整 SHA。不要部署 moving branch。

## 四、NCSA Delta：先建立交互连接

本节只适用于 **NCSA Delta**，不适用于 DeltaAI。手机 Remote Control 的实际链路是“手机 ChatGPT → 保持在线的 Mac ChatGPT Desktop → Mac SSH → Delta → 远端 Codex”；手机不会直接 SSH 到 Delta。

在 Mac 的 `~/.ssh/config` 建立具体 alias。下面的登录节点只是示例，应使用当前核实可用的 `dt-login01` 至 `dt-login04`，首次连接还要核对官方 host key：

```sshconfig
Host delta-codex
    HostName dt-login03.delta.ncsa.illinois.edu
    User CHANGE_ME_NCSA_USERNAME
    PreferredAuthentications keyboard-interactive,password
    KbdInteractiveAuthentication yes
    PasswordAuthentication yes
    PubkeyAuthentication no
    ServerAliveInterval 60
    ServerAliveCountMax 3
    TCPKeepAlive yes
    ControlMaster auto
    ControlPath ~/.ssh/control-%C
    ControlPersist 7d
```

在 Mac 终端人工建立 master：

```bash
ssh -MNf delta-codex
ssh -O check delta-codex
ssh delta-codex 'printf "user=%s\nhost=%s\nhome=%s\n" "$USER" "$(hostname -f)" "$HOME"'
```

第一条命令会依次要求 NCSA Kerberos 密码与 Duo。只在 SSH/Duo 官方交互界面输入；不要交给 Codex、脚本、聊天或日志。`ControlPersist 7d` 不是七天不断线保证，Mac 睡眠、重启、网络变化、节点维护都可能要求重新认证。

登录后先只读确认这是 Delta：

```bash
hostname -f
uname -m
scontrol show config | grep -Ei 'ClusterName|SlurmctldHost|SlurmVersion'
```

典型 Delta 登录节点是 `dt-login0N` 且架构为 `x86_64`。不匹配就停止套用 Delta 配置。登录节点只用于 Git、编辑、轻量验证、数据管理和 Slurm 提交，生产训练/推理必须进入 compute allocation。

更完整的 Remote Control、SSH、Kerberos/Duo 和断线恢复说明见 `vendor/ncsa-delta/references/01-access-and-quickstart.md`。

## 五、全新服务器安装

### 0. 推荐：GitHub 固定 release 的一命令入口

发布者先把 `manifest.json` 的 `bundle_release_ref` 设置为 release tag，并记录该 tag 对应的完整 commit SHA。`codex-bootstrap-release.yml` 会在只读 job 完成 Python、Node、真实 Codex 和隔离 Web 验收，再由单独的写权限 job 发布 tar/checksum/provenance；仓库还应给 `codex-bootstrap-v*` 配置 protected tag rule，并把 `codex-bootstrap-release` environment 设为需维护者批准。目标服务器以最终运行 Codex 的**非 root 用户**执行下面一条命令；raw 脚本 URL 固定到 commit，tag 再由 `--expected-commit` 绑定到同一个 commit，所以 tag 被移动时安装会失败：

```bash
bash -c 'set -Eeuo pipefail; curl -fsSL "https://raw.githubusercontent.com/OpenLAIR/dr-claw/<FULL_COMMIT_SHA>/bootstrap/codex/remote-install.sh" | bash -s -- --ref "<RELEASE_TAG>" --expected-commit "<FULL_COMMIT_SHA>" --full'
```

先做零写入预览时，在末尾加 `--dry-run`。若维护者只发布完整 SHA，也可把 raw URL 和 `--ref` 都设为该 SHA，不传 `--expected-commit`。不要在 URL 中嵌入 Git token；私有 fork 使用目标机 credential helper 或 SSH agent，并显式传不含凭据的 `--repo-url`。

远程入口会：

- 只把 checkout 写入 `$HOME/.local/share/drclaw/releases/<FULL_COMMIT_SHA>`，不搜索或修改任何现有 research project；
- 验证 ref、commit、clean worktree、manifest 发布 ref 和必需文件后，才调用该 checkout 自带的 `bootstrap.sh`；两个 optional community gitlink 必须与 manifest 的路径及对象 SHA 完全一致并保持未初始化，安装器不会拉取或执行其中的第三方代码；
- 默认使用 `safe` profile、自动安装缺失的 Codex、运行 doctor，并把 fresh Codex 固定到 manifest 的最高已审计版本；
- `--full` 还安装 Python 控制 CLI、SHA256 固定的 Node、locked npm 依赖、Web build、loopback-only 私有配置与 launcher；user-systemd 可用时只 enable，除非另加 `--start-app` 才立即启动；
- 重跑同一 release 时复用并重新验证同一 checkout；升级到新 release 时使用同一命令的新 tag/SHA，并在末尾加 `--replace` 归档旧的受管 skill 链接；
- 不复制 auth、sessions、connector/plugin cache、SSH 材料、`.env`、API/JWT token 或旧项目路径。

若明确要让 fresh host 直接安装官方当前 Codex，可加 `--codex-release latest`；Dr. Claw bundle 仍固定在自己的 Git release，随后由 doctor 的隔离兼容性合同判断新 Codex 是否可用。`--home` 默认只能等于当前 Unix 用户的 login home；`--allow-nonlogin-home` 是 Delta 隔离测试的显式 interlock，不是跨用户 provision 开关。完整参数见：

```bash
bash bootstrap/codex/remote-install.sh --help
```

若只要 Codex/skills/约束基线，可从命令中去掉 `--full`；只要 Web 而不装控制 CLI可改用 `--with-app`。Codex 设备登录、connector OAuth、SSH/Duo、第三方 API key 和首次浏览器账号仍需目标用户在各自官方界面完成，安装器不会复制或伪造这些身份状态。

### 1. 获取固定版本

在目标服务器选择受控路径并 checkout 已批准版本：

```bash
git clone https://github.com/OpenLAIR/dr-claw.git
cd dr-claw
git checkout <APPROVED_FULL_COMMIT_SHA_OR_TAG>
python3 --version
```

私有 fork 的 Git 凭据应由目标机 credential helper 或 secret store 提供，不写入 URL、仓库或本文件。

### 2. 先预览（推荐）

```bash
bash bootstrap/codex/bootstrap.sh install \
  --install-codex \
  --config-profile safe \
  --dry-run
```

`--dry-run` 不写文件、不下载 Codex，可用来确认目标路径和冲突。

### 3. 一条命令安装 portable baseline

```bash
bash bootstrap/codex/bootstrap.sh install --install-codex --config-profile safe
```

这是新主机的默认命令。若 `codex` 已在 `PATH`，`--install-codex` 会安全跳过；若不存在，它运行当前官方 installer。安装结束会自动运行 `doctor`。如果 installer 刚修改了 shell `PATH` 而当前进程尚未读到，重新打开 login shell，再运行下节的 doctor。

官方 installer URL 指向当前 Codex，而 Dr. Claw bundle 固定到自己的 Git ref；两者故意独立升级。`doctor` 不再要求 Codex 版本号永远等于 bundle 编写时的版本，而是要求 Codex 不低于 manifest 的最低版本，并在一次性、无凭据的 HOME/CODEX_HOME 中验证 config 加载、prompt JSON、全局 AGENTS.md、受管 skills 与 plugin JSON 五项合同。新版本若合同全部通过，只产生“尚未审计版本” warning，不会破坏交付；需要冻结到已审计版本时，显式增加 `--require-audited-codex-version`。

默认写入：

- `$HOME/.agents/skills/drclaw-skill-library`（链接）；
- `$HOME/.agents/skills/ncsa-delta`（链接，可用 `--skip-delta-skill` 排除非 Delta 主机）；
- `$CODEX_HOME/AGENTS.md` 的 Dr. Claw 受管区块；
- `$CODEX_HOME/config.toml` 中缺少的安全根级键；
- `$CODEX_HOME/drclaw-bootstrap-state.json`。

通常不应传 `--home` 或 `--codex-home`；这两个参数主要用于隔离测试或经过设计的非标准目录。

安装器不会静默穿过默认 `$HOME/.codex`、`$HOME/.agents` 或其受管父目录中的符号链接写到别处。需要把 `CODEX_HOME` 放到共享盘时，应先审计目标权限，再把 `CODEX_HOME` 明确设置为解析后的实际目录；用户级 native skills 仍按 Codex 约定留在实际 `$HOME/.agents/skills`。`doctor` 也会把受管文件或默认路径链上的意外符号链接判为失败。

### 4. 在目标机完成 Codex 设备登录

Delta 上可从 Mac 发起交互命令：

```bash
ssh -t delta-codex 'codex login --device-auth'
```

或直接在目标服务器终端运行：

```bash
codex login --device-auth
```

终端显示的网址和设备码只输入 OpenAI 官方授权页，使用预期的 ChatGPT 账号/workspace；不要复制到聊天或脚本。connector/plugin 也必须分别走自己的交互 OAuth，安装器不会复制或伪造授权。

### 5. 恢复产品管理的 plugins（可选）

当前审计环境启用了 `sites@openai-bundled` 与 `visualize@openai-bundled`，但 marketplace 快照和连接状态属于目标产品状态，不能从旧 `~/.codex/.tmp` 或 cache 复制。先检查目标 Codex 实际提供的 marketplace：

```bash
codex plugin marketplace list
codex plugin list --available --json
```

只有当输出中确实出现 manifest 记录的 plugin ID 时，才运行：

```bash
bash bootstrap/codex/bootstrap.sh install \
  --config-profile preserve \
  --install-plugins
bash bootstrap/codex/doctor.sh --require-plugins
```

若 fresh CLI 没有 `openai-bundled`，先通过目标 Codex 产品初始化官方 marketplace，或配置经过批准的 marketplace；不要把当前机器 `/u/.../.codex/.tmp/bundled-marketplaces` 当作可移植源。涉及账号的 connector 仍需单独 OAuth。安装器会隐藏失败命令输出，避免把潜在授权信息写入日志。

所有后续 `install` 都必须重复首次部署时影响拓扑的 flag：非 Delta 主机继续带 `--skip-delta-skill`，复制模式继续带 `--copy-skills`（内容更新时还可能需要审核后加 `--replace`）。`--config-profile preserve` 只表示本次不改配置；若 receipt 已记录早先的 `safe` 或 `current-delta`，安装器会保留那份 provenance，doctor 仍按原 profile 检查。

本基线没有无条件安装 MCP server。33 个现有 skill 提到 MCP，但它们缺少统一、经过验证的 Codex dependency 声明，且常需不同凭据；执行选中的 skill 前，应根据它的实际依赖用 `codex mcp` 在目标机配置，并从 secret store 注入环境变量。不能用“plugin/skill 文件已存在”替代可运行性验证。

### 6. 验证

```bash
bash bootstrap/codex/doctor.sh --check-auth --require-clean-native-skills
```

机器可读报告：

```bash
bash bootstrap/codex/doctor.sh --check-auth --require-clean-native-skills --json
```

发布后的生产 gate（要求 manifest 已填真实 `bundle_release_ref`、checkout clean、Codex 达到最低版本且隔离兼容性合同全部通过）：

```bash
bash bootstrap/codex/doctor.sh \
  --check-auth \
  --require-clean-native-skills \
  --strict-release
```

若 plugins 是这台主机的交付要求，再加 `--require-plugins`；否则它们保持产品管理的可选组件。

`--strict-release` 固定的是 Dr. Claw checkout，不会把 Codex 或产品管理的 plugin 锁死在旧版本。若某次受监管验收明确要求只接受 manifest 已审计过的 Codex 版本，再额外使用：

```bash
bash bootstrap/codex/doctor.sh \
  --strict-release \
  --require-audited-codex-version
```

每次 Codex 自身更新后直接重跑普通 doctor 即可。合同 PASS 表示当前 Codex 仍能消费这套外接层；未审计版本 warning 是维护者补跑完整回归并把版本加入 `codex_cli_audited_versions` 的提示，而不是要求回滚。任何合同 FAIL 才表示上游接口发生了真实破坏，需要适配 Dr. Claw 后再交付。

然后做不依赖 Git、只读 sandbox 的端到端 smoke test：

```bash
codex exec --skip-git-repo-check --sandbox read-only \
  'Reply with exactly: DRCLAW_CODEX_OK'
```

Delta 上也可以从 Mac 执行：

```bash
ssh delta-codex 'codex exec --skip-git-repo-check --sandbox read-only "Reply with exactly: DRCLAW_CODEX_OK"'
```

精确返回 `DRCLAW_CODEX_OK` 才证明 CLI、目标机登录和模型调用连通。它不自动证明 ChatGPT Desktop SSH 工作区连接正确；在远端任务中还要只读核对 `pwd`、`hostname -f` 和 `whoami`。

## 六、配置 profile

| Profile | 用法 | 行为 |
|---|---|---|
| `safe`（默认） | 新主机 | 只补缺失的 `on-request`、`workspace-write` 与文档预算；不覆盖已有根级键 |
| `preserve` | 已有人工配置且只想安装 skills/约束 | 完全跳过 `config.toml` |
| `current-delta` | 仅限已明确批准的可信 Delta 主机 | 重现审计时的 model、`approval_policy = "never"` 与 `sandbox_mode = "danger-full-access"` 等高信任根级键 |

显式启用当前 Delta 高信任 profile：

```bash
bash bootstrap/codex/bootstrap.sh install --config-profile current-delta
```

这会覆盖模板管理的根级键，意味着命令无需逐项批准且没有文件系统 sandbox。不要在共享、临时、未知、面向公网或包含不可信仓库的主机上使用。`safe` 是非破坏性合并；若旧配置本来就含高信任值，它不会自动降权，`doctor` 会警告，仍需人工审计。

## 七、skills 路由验证与使用

结构验证：

```bash
python3 bootstrap/codex/skills/drclaw-skill-library/scripts/query_library.py \
  --repo-root "$PWD" --validate
```

按中英文任务查询：

```bash
python3 bootstrap/codex/skills/drclaw-skill-library/scripts/query_library.py \
  --repo-root "$PWD" --query '论文引用' --limit 5
```

按 canonical name 或目录 alias 精确解析：

```bash
python3 bootstrap/codex/skills/drclaw-skill-library/scripts/query_library.py \
  --repo-root "$PWD" --resolve huggingface-accelerate --format paths
```

在 Codex 中可直接要求：

```text
$drclaw-skill-library 为这个任务选择一个主 skill、最多两个辅助 skill；只读取被选中的完整说明和必要 references。
```

Delta 连接、Slurm、账户、配额、GPU、排队和故障诊断则使用 `$ncsa-delta`。所有账户、queue、quota 与模块版本仍须在现场只读核实。

## 八、幂等更新、冲突与回滚

### 同一路径更新

```bash
git fetch --tags
git checkout <NEW_APPROVED_FULL_COMMIT_SHA_OR_TAG>
bash bootstrap/codex/bootstrap.sh install --config-profile safe
bash bootstrap/codex/doctor.sh --check-auth
```

默认链接模式下，skill 立即随 checkout 的内容更新；安装器刷新受管约束、配置和状态。重复运行不会重复追加 `AGENTS.md` 区块，也不会覆盖 unmanaged 文本或配置表。

### 复制模式

目标文件系统不允许符号链接时：

```bash
bash bootstrap/codex/bootstrap.sh install --copy-skills --config-profile safe
```

相同内容可幂等重跑。源 skill 更新后，已复制目录与源 digest 不同，安装器会拒绝静默覆盖；审计差异后使用：

```bash
bash bootstrap/codex/bootstrap.sh install \
  --copy-skills --replace --config-profile safe
```

复制的路由器通过 `$CODEX_HOME/drclaw-bootstrap-state.json` 找到原仓库；它不是 172 项库的独立副本。因此不要删除或移动 checkout。若必须移动，先在新路径重跑带 `--replace` 的安装，再运行 doctor。

### 冲突处理

已有同名 skill 但来源/模式不符时，安装器返回错误码 `2`，不会直接覆盖。确认目标后加 `--replace`，旧目录或链接会先移动到：

```text
$CODEX_HOME/drclaw-backups/<UTC_TIMESTAMP>/
```

`AGENTS.md` 或 `config.toml` 确实发生变更时也会在该目录保存变更前副本。不要先手工删除冲突；先检查归档内容和来源。

### checkout 移动与回滚

默认 skill 链接指向 checkout 的绝对路径。移动仓库后，从新路径用 `--replace` 重装并运行 doctor。回滚时：

1. 停止开启新的 Codex 任务；
2. 记录 `drclaw-bootstrap-state.json` 并检查对应 timestamp backup；
3. checkout 上一个已批准的 immutable revision；
4. 使用原 profile 与安装模式重跑安装器，必要时用 `--replace` 归档当前副本；
5. 运行 doctor 与只读 smoke test。

恢复人工配置时只恢复明确审计过的单个 backup，不要把整个旧 `$CODEX_HOME` 覆盖回来。

## 九、完整 Dr. Claw 组件

安装 Python 控制 CLI：

```bash
bash bootstrap/codex/bootstrap.sh install \
  --config-profile safe \
  --with-drclaw-cli
```

该 flag 执行 `python3 -m pip install --user -e agent-harness`。它依赖目标机 Python/pip 环境，不是 skills 路由器的必要条件。

远程一命令入口的 `--full` 已把控制 CLI 和 Web 应用一起自动化。单独安装 Web 层可运行：

```bash
python3 bootstrap/codex/install_app.py install
```

应用 manifest 固定 Node 版本及官方 SHA256，执行 locked `npm ci`、build/native/prune，生成仅监听 `127.0.0.1` 的私有配置、随机 JWT、独立数据库/workspace 根和 launcher。user-systemd 可用时默认只 enable、不立即启动；显式 `--start` 才启动并要求 `/health` 通过。任何 public bind 都被拒绝，公网访问必须另行评审 TLS/反向代理。完整边界和 doctor 见 `APP_INSTALL.zh-CN.md`。旧机器 `.env`、数据库和 `instance.json` 绝不搬运。

## 十、维护者验收

在提交新的 bootstrap revision 前运行：

```bash
python3 bootstrap/codex/skills/drclaw-skill-library/scripts/query_library.py --validate
python3 -m unittest discover -s bootstrap/codex/tests -v
```

新主机交付至少满足：

- checkout 固定到批准的完整 SHA/tag，工作树内容可追溯；
- router 验证通过且文件系统 skill 数不低于 manifest 下限；
- `$HOME/.agents/skills` 只暴露预期的受管入口，没有 172 项重复 native discovery；
- unmanaged `AGENTS.md` 与 config 内容保留；
- `doctor` 无 failure，高信任 warning 已有书面理由；
- 生产交付的 `--strict-release` 无 failure，release provenance 中的 tag 与完整 commit SHA 一致；
- GitHub protected tag 与 `codex-bootstrap-release` environment approval 已启用；有 `contents: write` 的 publish job 不 checkout、不执行仓库代码，只发布前一只读 job 的已验证 artifacts；
- `codex login status` 与只读 smoke test 通过；
- Delta 主机身份、架构与 Slurm 只读探针通过，生产计算不在登录节点；
- 没有 auth、token、`.env`、SSH secret、session/cache 或运行时状态进入 Git。

维护者还应使用 app manifest 固定的 Node 运行 server focused tests、完整 `npm test` 与一次隔离 Web install/doctor；Python bootstrap 测试不能替代这些 JavaScript 和 native dependency 回归。

## 十一、规范依据

- [Codex customization overview](https://learn.chatgpt.com/docs/customization/overview)：区分持久约束、skills 与 MCP 的职责；
- [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)：全局与项目级约束发现、覆盖顺序；
- [Build skills](https://learn.chatgpt.com/docs/build-skills)：skill 的按需加载、作用域与大型技能集合的上下文预算；
- [Codex config](https://learn.chatgpt.com/docs/config-file/config-basic)：`config.toml` 与安全配置；
- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp)：目标机外部工具连接与凭据边界。

交给一个全新 Codex 时，可使用下面的起始指令：

```text
完整阅读 bootstrap/codex/README.zh-CN.md 和 bootstrap/codex/manifest.json。
先确认主机与 Git revision，再 dry-run；不要复制任何认证或旧机器状态。
使用 safe profile 安装，所有交互认证留给我在官方界面完成，最后运行 doctor 和只读 smoke test。
```
