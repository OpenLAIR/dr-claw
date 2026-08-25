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

## 三、前置条件与跨服务器支持矩阵

总入口在任何目标写入前先做能力探测，并以一行 `capability` 结果报告 OS、架构、Git、Delta 身份和磁盘空间。当前服务器交付边界是：

| 环境差异 | 支持与处理方式 |
|---|---|
| OS | 支持 Linux；其他 OS 在写入前失败。macOS/Windows desktop build 不等于服务器 bootstrap 已受支持。 |
| CPU | `x86_64/amd64` 与 `aarch64/arm64`；release 必须同时通过 x64 与 GitHub native arm64 read-only gate，后者实际执行 Python bootstrap/router、固定 host Codex 合同及 Web install/doctor。Web 层分别使用 manifest 固定且校验 SHA256 的 Node/Codex 平台包；未知架构拒绝。 |
| Python | 最低 3.9；release CI 以只读 matrix 完整运行 router 与 `bootstrap/codex` tests，审计 3.9、3.10、3.11、3.12、3.13。默认安装 Codex、控制 CLI 或 Web 时，入口会在写入前验证 `ssl` import 与 `ssl.create_default_context()`；仅 `--skip-codex-install` 的 core-only 安装不需要 Python SSL。Web 还必须通过 `lzma`/`tarfile` 的内存 XZ roundtrip。Python 控制 CLI 的 10 个运行包全部使用跨平台 wheel、精确版本与 SHA256 lock。 |
| Git | 最低 2.25；版本不可解析或过旧时先失败。 |
| libc / shell tools | core 要求 Bash 4+ 与 GNU coreutils 的 `stat -c`/`mktemp` 语义；`--with-app`/`--full` 额外要求 glibc 2.28+，因为固定的官方 Node 22 Linux binary 以此为最低运行边界。musl、未知 libc 或更旧 glibc 会在任何目标写入前失败；core-only 不加这一 glibc 门槛。离线 wrapper 还要求 GNU `sha256sum --strict --quiet --check`。 |
| systemd | 可选。user-systemd 不可用时生成 foreground launcher；不会假装服务已运行。已运行的受管服务升级后会安全 restart，原本 inactive 的服务仍不被偷偷启动。 |
| filesystem | 入口按实际目标 root 的最近已存在父目录与 `st_dev` 去重检查空间，包括 release、`~/.local/bin`、Dr. Claw data/runtime、native skills、`CODEX_HOME`，Web 再加 config/state/systemd；因此既有的独立 `~/.local` mount 不会被 HOME 探针掩盖。会执行代码的 root 必须允许普通文件执行；Linux 暴露 `ST_NOEXEC` 时会在写入前拒绝 `noexec`，不承诺任意 NFS/noexec home。`CODEX_HOME` 必须是 HOME 内的专用目录。默认安装受管 skill 链接；不允许 symlink 的站点显式用 `--copy-skills`。路径含空格有回归测试；owner、权限、祖先 symlink 和跨用户写入均 fail-closed。NCSA Delta 的 login HOME 可由 root 拥有，但只在可信 `getfacl` 证明当前用户具有有效 `rwx`、没有其他主体的有效写权限、默认 ACL 同样安全时接受；HOME 以下受管祖先仍须由当前用户拥有且不可被 peers 写。 |
| 临时目录 | staging 优先使用显式 `TMPDIR`，其次 `XDG_RUNTIME_DIR`，否则 `/tmp`；必须是无 symlink 的绝对真实目录，且为当前用户私有目录，或 root-owned mode `1777` sticky 目录。入口把验证后的目录作为 child `TMPDIR`，但不要求临时文件系统可执行。 |
| 网络 / CA | 安装、下载及 doctor 的本地合同子进程支持 direct/system CA、无 userinfo/control 的 `HTTP(S)_PROXY`/`NO_PROXY`，以及唯一显式 `DRCLAW_CA_BUNDLE`。CA bundle 必须是绝对、regular、无 symlink、root/当前用户 owned 且不可被 group/other 写；入口只在本次安装链中映射给 Git/curl/Python/pip/Node，不写入 receipt、`drclaw.env`、systemd 或日志。credential-bearing proxy、alternate CA env、私有 package mirror 和需认证 mirror 不在当前一命令支持边界；Web 服务运行期若需 proxy/custom CA，属于尚未自动化的 activation profile，必须另行受审配置并做 model smoke。HTTP(S) Git 使用 low-speed 超时，Delta 身份探针也有独立 timeout。 |
| Delta/Slurm | 默认 `auto`：只有 FQDN、x86_64 和 live `scontrol ClusterName=delta` 三项都通过才安装 Delta skill；普通 Linux 自动跳过。可用 `--include-delta-skill` 明确只安装文档型 skill，或 `--skip-delta-skill` 强制跳过；`current-delta` 高信任 profile 永远要求 live Delta 三探针。 |
| 磁盘 | core 默认要求至少 1 GiB 可用；`--full` 保守要求 8 GiB，以覆盖 checkout、Node、npm cache、build 和临时文件。站点可用 `--minimum-free-bytes` 只提高阈值；`--skip-space-check` 是会留下醒目 warning 的高级显式绕过。 |
| 外部服务 | MCP、provider、GPU、Slurm、plugin/OAuth 和 API key 按任务 profile 激活；不存在的能力不会因 skill 文件已安装而被标成 runnable。 |

基础机需要 Bash、Git、Python 3.9+，并能读取批准的 release transport。若要自动安装 Codex、Python CLI 或 Web 依赖，还需分别直接访问官方 Codex installer、PyPI、Node/npm registry，或使用上述无凭据 proxy/单一 CA；私有 mirror/认证 proxy 当前不受支持。这些 endpoint 不可达时会受控失败，不会留下成功 receipt。Node 不是 skills 路由器的依赖，只是完整 Web 层依赖。

必须以最终实际运行 Codex 的非 root Unix 用户执行本方案；管理员应先 `sudo -iu <USER>`，再 clone 和安装。`--home` 只用于同一用户的隔离测试，不是跨用户 provision 开关；安装器会拒绝 root、owner 不匹配、受保护系统目录后代和隐式符号链接写穿。`$CODEX_HOME` 必须是 `$HOME` 内的专用目录；新建权限为 `0700`，已有目录及其自 HOME 起的现存祖先不得由其他主体替换或写入。唯一例外是上一表所述、经过 POSIX ACL 完整验证的 root-owned Delta HOME；例外不会向 HOME 以下受管目录传播。

生产部署必须由维护者批准一个 immutable Git tag 或完整 commit SHA。当前 manifest 固定到 `codex-bootstrap-v0.2.6`；`audited_base_commit` 只是编写本方案时检查的起始树，不是可部署 revision。实际安装还必须把该 annotated tag 与 release provenance 中的完整 commit SHA 绑定；不要部署 moving branch，也不要移动既有 tag。

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

发布者先把 `manifest.json` 的 `bundle_release_ref` 设置为 release tag，并记录该 tag 对应的完整 commit SHA。`codex-bootstrap-release.yml` 会在只读 job 完成 Python、Node、真实 Codex 和隔离 Web 验收，再调用同一 release-kit builder 生成 tar、Git bundle、离线入口、checksums 和 provenance；单独的写权限 job 只发布这些已验证文件。仓库还应给 `codex-bootstrap-v*` 配置 protected tag rule，并把 `codex-bootstrap-release` environment 设为需维护者批准。目标服务器以最终运行 Codex 的**非 root 用户**执行下面一条命令；raw 脚本 URL 固定到 commit，tag 再由 `--expected-commit` 绑定到同一个 commit，所以 tag 被移动时安装会失败：

```bash
bash -c 'set -Eeuo pipefail; curl -fsSL "https://raw.githubusercontent.com/OpenLAIR/dr-claw/<FULL_COMMIT_SHA>/bootstrap/codex/remote-install.sh" | bash -s -- --ref "<RELEASE_TAG>" --expected-commit "<FULL_COMMIT_SHA>" --full'
```

先做零写入预览时，在末尾加 `--dry-run`。若维护者只发布完整 SHA，也可把 raw URL 和 `--ref` 都设为该 SHA，不传 `--expected-commit`。不要在 URL 中嵌入 Git token；私有 fork 使用目标机 credential helper 或 SSH agent，并显式传不含凭据的 `--repo-url`。

远程入口会：

- 只把 checkout 写入 `$HOME/.local/share/drclaw/releases/<FULL_COMMIT_SHA>`，不搜索或修改任何现有 research project；
- 验证 ref、commit、clean worktree、manifest 发布 ref 和必需文件后，才调用该 checkout 自带的 `bootstrap.sh`；两个 optional community gitlink 必须与 manifest 的路径及对象 SHA 完全一致并保持未初始化，安装器不会拉取或执行其中的第三方代码；
- 默认使用 `safe` profile；Codex 缺失或低于 minimum 时安装/升级，达到 minimum 的已有 CLI 则保留；所有内部 installer 成功后再统一运行 credential-free 的 `--strict-release --require-clean-native-skills` pre-activation gate，并由隔离合同验收实际 CLI；
- `--full` 还安装 Python 控制 CLI、SHA256 固定的 Node、locked npm 依赖、Web build、loopback-only 私有配置与 launcher；发布 gate 会对完整 locked npm dependency graph 执行 `npm audit --audit-level=moderate`，不允许已知 moderate/high/critical advisory 随 release 通过；应用 bundle 明确要求 Node `22.x || 24.x`，而受管 runtime 固定为 22.23.2；user-systemd 可用时只 enable，除非另加 `--start-app` 才立即启动；
- 重跑同一 release 时复用并重新验证同一 checkout；升级到新 release 时使用同一命令的新 tag/SHA。旧 receipt 能完整证明来源、内容和安装模式时，两个受管 skill 会以可恢复事务自动切换到新 release，无需宽泛的 `--replace`；只有 drift、损坏或 unmanaged 冲突才需人工审计后显式加 `--replace`；
- 对 v0.1 的受管环境，installer 还只接受一个经过审计的历史例外：旧 `npm ci` 仅改写 `package-lock.json` 的 `peer` metadata，且旧 editable CLI 的三个 setuptools launcher、owner/mode、旧 release、source digest 和 app receipt 均完整匹配。它会备份并原子替换这些 launcher；任何额外 path/content/owner/mode 漂移仍按 unmanaged conflict 拒绝，绝不自动吞掉；
- 不复制 auth、sessions、connector/plugin cache、SSH 材料、`.env`、API/JWT token 或旧项目路径。

若明确要让 fresh host 直接安装官方当前 Codex，可加 `--codex-release latest`；Dr. Claw bundle 仍固定在自己的 Git release，随后由 doctor 的隔离兼容性合同判断新 Codex 是否可用。`--home` 默认只能等于当前 Unix 用户的 login home；`--allow-nonlogin-home` 是 Delta 隔离测试的显式 interlock，不是跨用户 provision 开关。完整参数见：

```bash
bash bootstrap/codex/remote-install.sh --help
```

若只要 Codex/skills/约束基线，可从命令中去掉 `--full`；只要 Web 而不装控制 CLI可改用 `--with-app`。`--full` 成功表示 installed 且 pre-activation verified，不等于已经 logged-in 或所有外部依赖均 runnable；Codex 设备登录、connector OAuth、SSH/Duo、第三方 API key、首次浏览器账号和只读 model smoke 仍需目标用户完成。`--no-doctor` 会显式跳过严格 pre-activation gate，只用于已理解这一验收缺口的场景。

### 0.1 GitHub 不可用：生成可搬运的离线 release kit

在 release tag 所在的 clean checkout 上生成一个新的、不可覆盖的目录：

```bash
release_tag=codex-bootstrap-v0.2.6
release_commit=$(git rev-parse "${release_tag}^{commit}")
kit_parent="$PWD/../drclaw-release-output-private"
(umask 077; mkdir "$kit_parent")
python3 bootstrap/codex/build_release_kit.py \
  --repo-root "$PWD" \
  --tag "$release_tag" \
  --expected-commit "$release_commit" \
  --output "$kit_parent/drclaw-${release_tag}-offline"
```

builder 只接受与 manifest、HEAD 和完整 SHA 一致的 annotated tag；拒绝 dirty worktree、tracked/path symlink、已初始化或漂移的 gitlink、已有输出目录，以及当前或可达 Git 历史中的认证/session 状态和高置信凭据。输出以同文件系统的原子 no-replace rename 发布，包含：

- 保留原 annotated tag object 并验证其 peeled commit 的固定 Git bundle，供安装器作为本地只读 repository；
- 同一 tag 的 `tar.gz` 审阅副本；
- 两者的独立 SHA256 sidecar、全目录 `SHA256SUMS` 与机器可读 provenance；
- tag 内原样提取并纳入 checksum 的 `remote-install.sh`；
- 不含绝对路径或秘密的 `install.sh`，固定 bundle、tag、commit 后透传 `--full`、`--dry-run`、`--replace` 等非身份参数。

完整搬运该目录到新服务器后，只需一条离线命令，不必先从 bundle 手动提取脚本：

```bash
bash /path/to/drclaw-codex-bootstrap-v0.2.6-offline/install.sh --full
```

wrapper 会先拒绝目录中的任何额外 entry、symlink、缺失文件、owner/mode 异常或 checksum inventory 漂移，并验证每个 payload，再把同目录 bundle 交给现有远程安装器；tag object 与 peeled commit 两个身份也同时固定。Git bundle 为了保留发布身份与 commit 原始 SHA 必须携带其可达 Git 历史，因此 builder 会扫描**全部可达历史路径，以及所有可达 blob、commit 和 tag payload**，而不只检查当前 tree；允许的 community gitlink 只记录路径与 object ID，bundle/archive 都不携带其仓库内容。内部 checksum 可证明搬运完整性；抵抗“payload 与 checksum 同时被替换”仍需通过独立可信渠道保存并核对 provenance sidecar 的 SHA256。

这里的“离线”是指**不依赖 GitHub 获取 Dr. Claw source**，不是完全 air-gapped：默认 `--full` 仍需官方 Codex、PyPI、Node 与 npm endpoint。真正隔离网部署还要由维护者预先提供并审核这些 runtime/package mirror；不要把旧机器的 cache、auth 或 connector state 当作离线依赖包。

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

这是新主机的默认命令。若 `codex` 已在 `PATH`，`--install-codex` 会先读取版本：达到 manifest minimum 就保留，并继续由隔离合同验收；低于 minimum 才运行官方 installer 升级。若不存在也会安装。安装结束会自动运行 `doctor`。如果 installer 刚修改了 shell `PATH` 而当前进程尚未读到，重新打开 login shell，再运行下节的 doctor。

官方 installer URL 指向当前 Codex，而 Dr. Claw bundle 固定到自己的 Git ref；两者故意独立升级。`doctor` 不再要求 Codex 版本号永远等于 bundle 编写时的版本，而是要求 Codex 不低于 manifest 的最低版本，并在一次性、无凭据的 HOME/CODEX_HOME 中验证 config 加载、prompt JSON、全局 AGENTS.md、受管 skills 与 plugin JSON 五项合同。新版本若合同全部通过，只产生“尚未审计版本” warning，不会破坏交付；需要冻结到已审计版本时，显式增加 `--require-audited-codex-version`。

默认写入：

- `$HOME/.agents/skills/drclaw-skill-library`（链接）；
- `$HOME/.agents/skills/ncsa-delta`（链接，可用 `--skip-delta-skill` 排除非 Delta 主机）；
- `$CODEX_HOME/AGENTS.md` 的 Dr. Claw 受管区块；
- `$CODEX_HOME/config.toml` 中受管的安全根级键；缺失值会补齐，receipt 证明的旧受管 profile 会迁移，未知人工冲突则拒绝而非静默覆盖；
- `$CODEX_HOME/drclaw-bootstrap-state.json`。

通常不应传 `--home` 或 `--codex-home`；这两个参数主要用于隔离测试或 HOME 内经过设计的非标准目录。

安装器不会静默穿过默认 `$HOME/.codex`、`$HOME/.agents` 或其受管父目录中的符号链接写到别处。当前 release 不支持 HOME 外或共享盘上的 `CODEX_HOME`；站点应把真实 login HOME 配置到批准的存储，或等待未来带逐层 owner/mode trust contract 的显式 profile，不能只用 `--codex-home` 绕过本门禁。用户级 native skills 仍按 Codex 约定留在实际 `$HOME/.agents/skills`；`doctor` 也会把受管文件或默认路径链上的意外符号链接判为失败。

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

所有后续 `install` 都必须重复首次部署时影响拓扑的 flag：非 Delta 主机继续带 `--skip-delta-skill`，复制模式继续带 `--copy-skills`。receipt 能证明旧副本完整时，内容和模式更新会走受管事务；只有 drift 或 unmanaged 冲突才需要审核后加 `--replace`。`--config-profile preserve` 只表示本次不改配置；若 receipt 已记录早先的 `safe` 或 `current-delta`，安装器会保留那份 provenance，doctor 仍按原 profile 检查。

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
| `safe`（默认） | 新主机 | 补齐 `on-request`、`workspace-write` 与文档预算；对 receipt 证明的旧模板或 `current-delta` 做可审计迁移，对未知且不一致的人工键拒绝并要求选择 `preserve` 或显式 `--replace` |
| `preserve` | 已有人工配置且只想安装 skills/约束 | 完全跳过 `config.toml` |
| `current-delta` | 仅限已明确批准的可信 Delta 主机 | 重现审计时的 model、`approval_policy = "never"` 与 `sandbox_mode = "danger-full-access"` 等高信任根级键 |

显式启用当前 Delta 高信任 profile：

```bash
bash bootstrap/codex/bootstrap.sh install --config-profile current-delta
```

这会覆盖模板管理的根级键，意味着命令无需逐项批准且没有文件系统 sandbox。不要在共享、临时、未知、面向公网或包含不可信仓库的主机上使用。切回 `safe` 时，只有当前 receipt 能证明这些高信任键由上一受管 profile 写入，安装器才会自动降权；未知人工配置默认拒绝，必须明确选 `preserve` 保持原样，或审计后用 `--replace` 备份并应用安全值。`doctor` 对受管 profile 要求精确匹配。

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

相同内容可幂等重跑。源 skill 更新或安装模式改变时，若旧 receipt、旧路径和 digest 全部一致，安装器会用带恢复标记的事务自动切换；若目标发生 drift 或不是受管副本，则默认拒绝。审计冲突后可使用：

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

该 flag 不修改系统或用户 site-packages。它按 bundle revision、源码 digest、Python runtime 与架构建立独立私有 venv，把 `agent-harness` 复制为 sealed source，并仅从 `requirements-drclaw-cli.lock` 安装 10 个精确版本、universal-wheel、SHA256 校验的包（包括固定 pip/setuptools/wheel）。三个 launcher 原子切换到新环境，旧环境保留用于显式回滚。receipt 与 doctor 核对 Python identity、完整 distribution graph、源码、lock、runner、launcher 和 import origin；损坏默认拒绝，只有 `--replace` 才归档并恢复受管 launcher。它仍不是 skills 路由器的必要条件。

远程一命令入口的 `--full` 已把控制 CLI 和 Web 应用一起自动化。单独安装 Web 层时也使用 Python isolated mode，避免站点 `PYTHONHOME`、`PYTHONPATH`、user-site 或 `sitecustomize` 污染启动：

```bash
python3 -I -S bootstrap/codex/install_app.py install
```

应用 manifest 固定 Node 版本及官方 SHA256，也独立固定 Web 内嵌 Codex CLI/SDK；它执行 locked `npm ci`、build/native/prune，生成仅监听 `127.0.0.1` 的私有配置、随机 JWT、独立数据库/workspace 根和 launcher。应用 package engine 为 Node `22.x || 24.x`，受管 runtime 固定为 22.23.2。为兼顾 Delta 的 glibc 2.34 与供应链安全，`sqlite3` 保留已验证的 5.1.7 平台构建，同时用精确 npm overrides 升级它和内嵌 `node-gyp` 在安装期使用的 `tar`、cache、fetch 与 proxy 依赖；`better-sqlite3@13.0.3`、Electron 41、Electron Builder、Sharp、React Router、syntax highlighter、ZIP 处理器及 transitive lock 已在 Node/Electron native rebuild 中验证。完整 locked tree audit 为 0，release workflow 会重新门禁；prune 后 doctor 还会逐项确认 exclusively-dev dependencies 没有残留在 server runtime。内嵌 Codex 必须通过与 host CLI 相同的五项无凭据合同及 path/version/digest receipt。user-systemd 可用时默认只 enable、不启动原本 inactive 的服务；若升级前受管服务已经 active，则成功安装后自动 restart，避免旧进程假绿灯。显式 `--start` 用于首次启动并要求 `/health` 通过。任何 public bind 都被拒绝，公网访问必须另行评审 TLS/反向代理。完整边界和 doctor 见 `APP_INSTALL.zh-CN.md`。旧机器 `.env`、数据库和 `instance.json` 绝不搬运。

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
- 离线交付的 bundle、archive、两个入口、sidecar 与 `SHA256SUMS` 全部匹配，`bash install.sh --dry-run` 能从同目录 bundle 完成 source 验证；
- GitHub protected tag 与 `codex-bootstrap-release` environment approval 已启用；有 `contents: write` 的 publish job 不 checkout、不执行仓库代码，只发布前一只读 job 的已验证 artifacts；
- `codex login status` 与只读 smoke test 通过；
- Delta 主机身份、架构与 Slurm 只读探针通过，生产计算不在登录节点；
- 没有 auth、token、`.env`、SSH secret、session/cache 或运行时状态进入 Git。

维护者还应使用 app manifest 固定的 Node 运行 server focused tests、完整 `npm test` 与一次隔离 Web install/doctor；Python bootstrap 测试不能替代这些 JavaScript 和 native dependency 回归。

发布前还必须在 clean、由 lock 重建的依赖树上运行：

```bash
npm audit --audit-level=moderate
```

该检查依赖当前 registry advisory 数据，因此不能替代固定 `package-lock.json` 和 release provenance；新 advisory 出现时应阻止下一次 release，完成 Node/Electron native rebuild、跨 glibc/架构回归后再发布，不能用 `--audit=false` 把已知风险当作通过。

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
