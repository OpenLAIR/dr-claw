# 访问 Delta、Remote Control 与首次配置

本章同时覆盖普通 SSH 登录，以及已经验证可工作的完整链路：

```text
手机 ChatGPT
  -> Mac 上的 ChatGPT Desktop / Remote Control
  -> Mac 的具体 SSH alias 与复用 master
  -> NCSA Delta 登录节点
  -> Delta 上的 Codex app server / CLI
```

手机并不是直接 SSH 到 Delta。Mac 是持续在线的控制端和 SSH 跳板，因此“完整、直接、持续”取决于链路中的每一层都健康。

## 1. 先区分系统与三套认证

本技能只针对 **NCSA Delta**，不是 DeltaAI。Delta 与 DeltaAI 共享部分 `/work` 存储和 Globus 入口，但 home、CPU 架构和分区不同。

连接过程涉及三套相互独立的认证：

| 层 | 用途 | 典型凭据 |
|---|---|---|
| NCSA/ACCESS 身份 | SSH 登录 Delta | NCSA 用户名和 NCSA Kerberos 密码 |
| NCSA Duo | Delta SSH 第二因素 | Duo Push 或当次 6 位 passcode |
| OpenAI/ChatGPT | Remote Control 与远端 Codex | ChatGPT 账号、OpenAI MFA/SSO/passkey、临时设备登录码 |

重要边界：

- 网页上登录 ACCESS 门户的会话，不等于 SSH 已获得认证；SSH 提示的是 NCSA Kerberos 密码。
- 出现 Duo 菜单说明第一因素已通过；还没有出现 Duo 就 `Permission denied`，应先排查 NCSA 用户名/Kerberos 密码或 SSH 认证方式。
- NCSA Duo 不能满足 OpenAI 的 MFA 要求，OpenAI MFA 也不能代替 NCSA Duo。
- 不让 Codex、脚本或日志保存、自动输入、回显或转发密码、Duo passcode、8 位配对 PIN、OpenAI MFA 或设备登录码。

## 2. 先配好手机到 Mac 的 Remote Control

### 2.1 前置条件

- 手机和 Mac 使用当前版本的 ChatGPT app；
- 两端登录**同一个 ChatGPT 账号和 workspace**；
- 按账号策略启用 OpenAI MFA、SSO 或 passkey；
- Mac 联网、保持清醒，ChatGPT Desktop 保持登录和运行；
- MacBook 合盖时不能假定 Remote Control 仍可用；按 OpenAI 当前说明，通常需要开盖，合盖运行则需要满足外接显示器和系统供电条件。

### 2.2 配对

在 Mac 的 ChatGPT Desktop 中打开：

```text
Settings -> Connections -> Control this Mac or PC
```

选择设置/添加设备，按界面完成网页授权和验证；再用手机端扫描二维码或输入当次 8 位 PIN。PIN 是短期认证信息，只在官方界面中输入，不复制到聊天、命令行或文档。

配对后，从手机打开一个 Mac 上的任务，确认能看到并继续该任务。仅看到设备名称还不等于远端 SSH 已打通。

### 2.3 切换 ChatGPT 账号后的处理

Remote Control 授权和 Delta 上的 Codex 登录都与 ChatGPT 账号/workspace 绑定。若 Mac 以前由另一个账号设置：

1. 在 Mac 和手机上确认当前账号及 workspace；
2. 退出旧账号并登录新账号；
3. 在浏览器授权页确认没有被旧账号的缓存会话接管；
4. 重新启用 `Control this Mac or PC` 并完成新配对；
5. 稍后在 Delta 上重新运行 `codex login --device-auth`，使用同一个新账号完成授权。

退出 ChatGPT 会关闭 Remote Control；再次登录后需要重新开启。若出现 `Failed to authorize remote control`，优先检查账号/workspace 不一致、OpenAI MFA/SSO 要求、旧网页会话或已失效的配对，而不是去重置 NCSA Duo。

## 3. 配置适合 ChatGPT SSH 连接的具体 alias

NCSA 官方推荐普通登录使用 round-robin 名称：

```bash
ssh CHANGE_ME_NCSA_USERNAME@login.delta.ncsa.illinois.edu
```

但持续的 ControlMaster、ChatGPT Remote SSH 和 `tmux` 都需要知道实际登录节点。为此，在 Mac 的 `~/.ssh/config` 中建立一个**具体、无通配符**的 alias；下面的 `dt-login03` 是示例，可替换成当前可用的 `dt-login01` 至 `dt-login04`：

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

说明：

- ChatGPT Desktop 的 SSH 自动发现需要具体 alias；只有 `Host *.delta...` 之类的 pattern 不可靠。
- `PreferredAuthentications` 让 SSH 使用 NCSA 支持的键盘交互/密码流程。
- Delta 对普通用户禁用 SSH public-key 登录。即使 ACCESS 账号页面能保存公钥，也不能据此假定 Delta 会接受该公钥；只有 NCSA 明确批准的 Gateway allocation 例外才按官方流程配置。
- `ControlPath ~/.ssh/control-%C` 避免主机名过长，并复用已经通过 Duo 的连接。
- `ServerAliveInterval`、`ServerAliveCountMax` 和 `ControlPersist 7d` 提高可恢复性，但不承诺连接一定维持七天。
- 第一次连接时核对 NCSA 官方页面公布或由管理员确认的 host key；不要无条件接受发生变化的指纹。

普通一次性终端也可以继续使用 round-robin 主机名；`delta-codex` 专门用于需要稳定落在同一登录节点的远端控制。

## 4. 建立并验证 SSH master

先在 Mac 终端运行：

```bash
ssh -MNf delta-codex
```

依次人工输入 NCSA Kerberos 密码，并在 Duo 提示中选择 Push 或输入当次 passcode。成功时命令会安静地返回本地 shell，这是 `-f` 后台运行的正常表现，不是卡住。

立即验证 control socket：

```bash
ssh -O check delta-codex
```

成功时会报告类似 `Master running (pid=...)`。再做只读远端探针：

```bash
ssh delta-codex 'printf "user=%s\nhost=%s\nhome=%s\n" "$USER" "$(hostname -f)" "$HOME"'
```

若第一步需要观察详细错误，暂时不要后台化：

```bash
ssh -vvv -MN delta-codex
```

调试输出可能包含主机、用户名和路径；分享前先检查并删去不需要的个人信息。不要分享密码或 Duo 信息。

### 4.1 正确理解“几天”

复用连接能减少重复 Duo，但不能绕过 NCSA 的认证政策：

- `ControlPersist 7d` 是客户端复用 master 的配置，不是服务器 SLA；
- Mac 重启、系统睡眠、网络切换、VPN 变化、登录节点维护、NCSA 主动清理或 SSH 进程退出都会中断；
- 中断后通常需要重新运行 `ssh -MNf delta-codex`，再次输入 Kerberos 密码并完成 Duo；
- 不要写自动输入密码/Duo 的脚本，也不要用明文凭据换取所谓永久连接。

在 Mac 的 ChatGPT Connections 设置中，若有 `Keep this Mac awake` 选项，应在接通电源时开启。也可以在明确知道 SSH master PID 后，用 macOS 自带命令把防睡眠生命周期绑定到该进程：

```bash
ssh -O check delta-codex
# 将上一行显示的数字人工替换到这里
caffeinate -is -w CHANGE_ME_MASTER_PID
```

`-i` 防止 idle system sleep，`-s` 在接通交流电时防止 system sleep，`-w` 在 SSH master 退出时同时结束 `caffeinate`。这不会修复网络或 NCSA 服务端中断，也不应替代正常的电源设置。

## 5. 在 Delta 安装并登录 Codex

先确认登录 shell 的平台和 home：

```bash
ssh delta-codex 'uname -m; printf "HOME=%s\n" "$HOME"'
```

在 Delta 登录节点安装当前官方 Codex CLI：

```bash
ssh -t delta-codex 'curl -fsSL https://chatgpt.com/codex/install.sh | sh'
```

安装脚本通常把二进制放在用户目录，例如 `$HOME/.local/bin/codex`。不要把二进制或缓存放在共享项目的公共可写目录。确认交互 shell和非交互登录 shell都能找到它：

```bash
ssh delta-codex 'command -v codex && codex --version'
```

若本地交互终端能找到、上述命令却找不到，说明登录 shell 的 `PATH` 不完整。把 `$HOME/.local/bin` 加到该账号实际使用的登录启动文件（Delta 上常见为 `~/.bash_profile`），然后重新验证；不要只在临时 shell 中 `export PATH`。

使用设备授权登录：

```bash
ssh -t delta-codex 'codex login --device-auth'
```

把终端显示的临时网址/设备码只输入 OpenAI 官方授权页，并选择与手机和 Mac 相同的 ChatGPT 账号/workspace。设备码会过期，不要发到聊天或保存进脚本。完成后验证：

```bash
ssh delta-codex 'codex login status'
```

可做一个不依赖 Git 仓库、只读 sandbox 的轻量端到端测试：

```bash
ssh delta-codex 'codex exec --skip-git-repo-check --sandbox read-only "Reply with exactly: DELTA_CODEX_OK"'
```

看到精确回复 `DELTA_CODEX_OK`，说明远端 CLI、OpenAI 登录和模型调用均已工作；它仍不代表 ChatGPT Desktop 的 SSH app server 已经连上。

## 6. 在 ChatGPT Desktop 中添加 Delta SSH

在 Mac 的 ChatGPT Desktop 中打开：

```text
Settings -> Connections -> SSH
```

添加或启用 `delta-codex`，然后选择一个已核实的远端目录，例如用户 home `/u/<NCSA_USERNAME>` 或具体项目目录。不要在不知道内容的情况下直接选择整个共享项目盘作为工作区。

ChatGPT Desktop 会通过现有 SSH 连接在远端启动 Codex app server；不要把 app server 自己暴露到公网，也不要另外开未经认证的监听端口。

界面显示 `Connected` 后，再做两项验证：

1. Mac 终端中运行 `ssh -O check delta-codex` 和上一节的远端身份/Codex探针；
2. 在一个明确标记为 SSH/Delta 的 Codex 任务中只读运行 `pwd`、`hostname -f`、`whoami`，确认路径和身份确实来自 Delta，而不是本地 Mac。

只有两层都通过，才称为手机到 Delta 的端到端连接已建立。

## 7. 断线恢复手册

按从底层到上层的顺序检查：

```bash
# 1. SSH master 是否仍活着
ssh -O check delta-codex

# 2. 能否执行远端只读命令
ssh delta-codex 'date -Is; hostname -f; whoami'

# 3. 远端 Codex 是否在 PATH 且仍登录
ssh delta-codex 'command -v codex; codex --version; codex login status'
```

如果 `ssh -O check` 报 control socket 不存在或 master 未运行：

```bash
ssh -MNf delta-codex
```

重新完成 Kerberos + Duo 后，再回到 ChatGPT Desktop 的 SSH 页面重连。若指定 `dt-login03` 正在维护，先查 NCSA 公告或用普通 round-robin 登录确认可用节点，再把 alias 的 `HostName` 改成另一个官方 `dt-login0N`；更换节点会建立新 master，并需要重新认证。

如果刚切换 ChatGPT 账号：

1. 重新授权手机到 Mac 的 Remote Control；
2. 在 Delta 上执行 `codex logout` 后再 `codex login --device-auth`；
3. 在 Desktop 中禁用再启用该 SSH host，或重新打开远端任务；
4. 再做本章第 6 节的双层验证。

## 8. 常见错误定位

| 现象 | 所在层 | 优先处理 |
|---|---|---|
| 密码后直接 `Permission denied`，没有 Duo 菜单 | NCSA 第一因素/SSH 方法 | 核对 NCSA 用户名、Kerberos 密码和 `PreferredAuthentications`；不是 OpenAI 密码 |
| 已显示 Duo 菜单，之后 `Success. Logging you in...` | NCSA SSH | SSH 认证成功；后台 master 正常时会返回本地提示符 |
| `Failed to authorize remote control` 或网页要求 MFA | OpenAI Remote Control | 核对 ChatGPT 账号/workspace、OpenAI MFA/SSO、旧浏览器会话并重新配对 |
| `Not logged in` / `codex login status` 失败 | Delta 上的 Codex | 在远端执行 `codex login --device-auth`，选择当前 ChatGPT 账号 |
| Desktop 找不到 SSH host | 本地 SSH config | 使用具体 alias，不用通配 pattern；先确保 `ssh delta-codex` 可用 |
| `codex: command not found` | 远端 login-shell PATH | 将安装目录加入远端登录启动文件，再用非交互 `ssh ... command -v codex` 验证 |
| app-server bootstrap timeout | Desktop 到远端 Codex | 先查 master、远端 PATH/版本/登录；等待 app 自动重试后确认最终状态，不把一次 timeout 当最终结论 |
| UI 显示 Connected，但任务像在本地 | 工作区/路由 | 在该任务中核对 `pwd`、`hostname -f`、`whoami` |
| 过一段时间后 control socket 消失 | Mac/网络/NCSA 会话 | 重新运行 `ssh -MNf delta-codex` 并完成 Kerberos + Duo |

## 9. 登录后确认 Delta，而不是 DeltaAI

进入系统后记录：

```bash
date -Is
hostname -f
uname -a
uname -m
scontrol show config | grep -Ei 'ClusterName|SlurmctldHost|SlurmVersion'
```

典型 Delta 登录主机是 `dt-login01` 至 `dt-login04`，体系结构应是 `x86_64`。若是 DeltaAI、`aarch64`、Grace Hopper 或不同 Slurm cluster name，停止套用本技能中的 x86/CUDA/分区假设。

## 10. 登录节点允许与禁止的工作

适合登录节点：

- 编辑脚本、Git 操作；
- 查看账户、quota、队列；
- 小规模编译和轻量预处理；
- `sbatch`/`squeue`/`sacct`；
- 小到中等文件的 `scp`/`rsync`；
- 准备 Globus 传输。

禁止或不应在登录节点做：

- 训练、推理、长时间 CPU 运算；
- Jupyter kernel；
- GPU 程序（登录节点没有 GPU）；
- 大规模数据解压、校验、扫描；
- 大量并行编译；
- 持续高频轮询 Slurm。

大编译也可申请 CPU interactive 节点完成。

## 11. Open OnDemand

Open OnDemand 适合验证账户能否登录、JupyterLab、VS Code Code Server、noVNC Desktop，以及不熟悉 SSH tunnel 的交互用户。

OOD 启动的应用本质上也会申请 Slurm 资源并计费。结束浏览器标签不一定等于终止 allocation；必须在 OOD 面板确认 session 已停止，或用 `squeue -u "$USER"` 检查。

## 12. 首次登录的只读清单

```bash
# 身份和系统
whoami
id
date -Is
hostname -f
uname -m

# 账户与余额
accounts

# 存储配额
quota
printf 'HOME=%q\nWORK=%q\nSCRATCH=%q\n' "$HOME" "${WORK-}" "${SCRATCH-}"
readlink -f "$HOME"
readlink -f "${WORK-}" 2>/dev/null || true
readlink -f "${SCRATCH-}" 2>/dev/null || true

# 分区与特征
sinfo -a
sinfo -o '%P|%a|%l|%D|%t|%G|%m|%c|%f'
scontrol show partition

# 当前作业
squeue -u "$USER"

# 软件
module list
module spider python
command -v apptainer && apptainer --version
```

保存完整结果：

```bash
bash <SKILL_ROOT>/scripts/delta-doctor.sh --output "$HOME/delta-doctor.txt"
```

## 13. 建立不含秘密的项目 profile

建议在项目仓库创建**不提交 Git**的 `.delta-profile.env`：

```bash
# 绝不放密码/token
export DELTA_PROJECT_CODE="abcd"
export DELTA_CPU_ACCOUNT="abcd-delta-cpu"
export DELTA_GPU_ACCOUNT="abcd-delta-gpu"
export DELTA_PROJECT_DIR="/projects/abcd/$USER"
export DELTA_WORK_DIR="/work/hdd/abcd/$USER"
export DELTA_LOG_DIR="/work/hdd/abcd/$USER/logs"
```

配套 `.gitignore`：

```gitignore
.delta-profile.env
slurm-*.out
logs/
```

生成前必须从 `accounts` 和 `quota` 核实，不能按后缀猜。若多个 allocation 同时可用，记录每个账户的用途和 PI，不要默认消耗余额最多的项目。

## 14. `tmux` 与登录节点

`tmux` 会话只存在于创建它的具体登录节点。通过 round-robin 名称重新登录时可能落在另一台，找不到会话。先记住主机：

```bash
hostname -s
tmux new -s delta
```

重连到当时记录的具体节点：

```bash
ssh CHANGE_ME_NCSA_USERNAME@dt-login03.delta.ncsa.illinois.edu
tmux attach -t delta
```

若使用本章的 `delta-codex` alias 且仍指向同一节点，也可以 `ssh delta-codex` 后 attach。`tmux` 不能让计算任务绕过 Slurm；只用于保持编辑、监控和传输会话。

## 15. 最小作业生命周期

```bash
# 1) 从模板复制并编辑
cp <SKILL_ROOT>/assets/templates/gpu-single.slurm job.slurm

# 2) 创建日志目录
mkdir -p /work/hdd/<PROJECT>/$USER/logs

# 3) lint
python3 <SKILL_ROOT>/scripts/delta-lint.py job.slurm

# 4) 无提交测试
sbatch --test-only job.slurm

# 5) 用户明确要求后提交
job_id=$(sbatch --parsable job.slurm)
echo "$job_id"

# 6) 排队/运行
squeue -j "$job_id"
squeue --start -j "$job_id"
scontrol show job -dd "$job_id"

# 7) 完成后
bash <SKILL_ROOT>/scripts/delta-job-report.sh "$job_id" <ACCOUNT>
```

## 16. 数据进入 Delta

- Git 源码：正常 `git clone`/`git pull`，但不要把巨大数据放 Git。
- 小到中等数据：`rsync -avP` 或 `scp`。
- 大数据：Globus，集合名通常是 `NCSA Delta` 或 `ACCESS Delta`。
- 不把大传输压在登录节点；不从登录节点长时间跑多进程下载器。

## 17. 退出与清理

离开前：

```bash
squeue -u "$USER"
```

确认没有遗忘的 interactive/OOD allocation。interactive allocation 即使 shell 空闲也占资源并计费；`exit` 释放 `srun` shell 或 `salloc` allocation。

停止本地 SSH master 是一个有状态动作，只在用户明确要求断开时执行：

```bash
ssh -O exit delta-codex
```

这不会取消 Slurm 作业；但会断开通过该 master 复用的 SSH/Remote 连接。
