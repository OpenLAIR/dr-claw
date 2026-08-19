# Dr. Claw Web 可复现安装层

`install_app.py` 是 Codex/skills 基线之外的可选 Web 应用层。它只管理当前 Unix 用户的 Node 运行时、npm 依赖、前端构建、应用配置和服务入口；不会读取或复制旧机器的 `.env`、数据库、Codex 登录、connector token 或研究项目。

## 新服务器安装

在已经 checkout 到批准的 immutable Git tag/commit 后运行：

```bash
python3 -I -S bootstrap/codex/install_app.py install
```

`-I -S` 是直接入口合同的一部分：它在脚本代码执行前忽略外部 `PYTHONHOME`、`PYTHONPATH`、user-site 与 `sitecustomize`。生产首选仍是总入口 `remote-install.sh --with-app` 或 `--full`，它还会统一完成主机、source 与 pre-activation 验收。

默认把 Web 进程使用的 `CODEX_HOME` 固定为目标用户的 `<home>/.codex`。总安装器使用自定义 Codex 根时，会把同一个绝对路径通过 `--codex-home` 传入；该路径当前必须位于目标 home 内。它会写入受管 env、receipt，并由 doctor 逐项核对。生成的 launcher 由 Python 严格解析固定键集合并直接设置进程环境，不会用 shell `source`/`eval` 读取 env。

它会依次完成：

1. 在任何目标写入前确认 Linux `x86_64`/`aarch64`、glibc `>= 2.28`，并确认实际承载 `$HOME/.local/bin` 与 `$HOME/.local/share/drclaw` 的最近父文件系统不是 `noexec`；
2. 下载 manifest 固定的 Node.js `22.23.2` Linux 归档，并核对 Node 官方 SHA256；Node 在 staging 中通过版本与关键文件布局验证后，私有 standalone runtime receipt 会随整个 runtime 一次原子发布；
3. 用仓库 `package-lock.json` 执行 `npm ci`、生产构建和 native-module 准备，再删除仅构建期需要的开发依赖；各步骤和最终 dependency verify 都使用 manifest 固定的有限 timeout。release workflow 还在 clean lock 树上执行 `npm audit --omit=dev --audit-level=moderate`；目标安装器关闭重复网络 audit，避免 advisory 数据变化破坏同一 release 的可复现安装；
4. 在用户私有目录生成 loopback-only 配置、64 位十六进制随机 JWT secret、独立 SQLite 路径和新 workspace 根；
5. 写入 `$HOME/.local/bin/drclaw-web`；
6. 若真实 login home 的 user-systemd 可用，则安装并 enable 用户 unit，但默认不立即启动；没有 user-systemd 时明确降级为 launcher-only；
7. 写入不含 secret 的 app receipt，并自动运行 read-only doctor。

npm lifecycle 子进程只收到最小允许列表、受管 Node `PATH`、独立 cache/tmp 和不含 registry credential 的私有 npmrc；当前 shell 中的 API key、npm token、SSH agent、password/secret 变量不会继承进去。只有经过校验且不含用户名/密码的 proxy 与显式批准的 `DRCLAW_CA_BUNDLE` 会按网络合同传入。运行 Web 服务时需要的 provider key 仍须由目标机的人或批准的 secret 系统单独配置。

当前 lock 将 `adm-zip`、React Router、syntax highlighter 与 `node-gyp` 固定到已验证版本，并通过精确 npm overrides 把 `sqlite3@5.1.7` 的安装期 `tar`、cache/fetch/proxy 链升级到无已知 production advisory 的版本。这样保留 Delta glibc 2.34 可加载的 sqlite3 prebuild；直接改用 sqlite3 6.0.1 会拉取要求 glibc 2.38 的 x64 binary，已经在 Delta 被回归测试拒绝。任何 overrides 变化都必须重新运行 native import、typecheck、build、完整测试与 production audit。

所有 user-systemd 探测、配置和 doctor 查询只使用固定系统目录中解析出的绝对 `systemctl`。该可执行文件及其路径链必须由 root 拥有且不可被 group/other 写入；相对路径或 `$PATH` 中用户可写的同名程序不会执行。systemctl 子进程只收到目标 `HOME`、固定可信 `PATH`、由 passwd 推导的 `USER`/`LOGNAME`、C locale，以及验证为当前用户私有目录后才加入的 `XDG_RUNTIME_DIR` 和对应 D-Bus 地址，不继承 operator shell secret；每次调用都有 manifest timeout。

需要安装后立即启动时必须显式选择：

```bash
python3 -I -S bootstrap/codex/install_app.py install --start
```

默认只监听 `127.0.0.1:3001`。从个人电脑访问远端服务器时使用 SSH tunnel：

```bash
ssh -L 3001:127.0.0.1:3001 <SERVER_ALIAS>
```

然后打开 `http://127.0.0.1:3001`。安装器拒绝 `0.0.0.0` 等 public bind；公网部署需要单独评审 TLS、反向代理、API key、权限和 workspace 边界。

## 隔离验收边界

`--home` 只用于一次性验收。为了保证不会操作真实 user-systemd 或外部 checkout，它有两个硬门禁：

- 非 login home 永远强制 `service=none`，即使调用者传入 `auto` 或 `user-systemd`；`--start` 直接失败；
- 非 dry-run 安装的 checkout 必须位于该隔离 home 内，避免 `npm ci`/build 改写真实工作树。

示意流程如下；必须使用唯一临时目录和 disposable checkout：

```bash
test_root="$(mktemp -d /tmp/drclaw-app-acceptance.XXXXXX)"
test_home="$test_root/home"
mkdir -m 700 "$test_home"
git clone --branch <APPROVED_TAG> --depth 1 \
  https://github.com/OpenLAIR/dr-claw.git "$test_home/dr-claw"
python3 -I -S "$test_home/dr-claw/bootstrap/codex/install_app.py" \
  --repo-root "$test_home/dr-claw" \
  install --home "$test_home" --codex-home "$test_home/.codex" --service none
```

这个流程不会启动服务，因此不会扫描或改动真实 home 中已有的 Codex sessions、Dr. Claw 数据库或三个现有项目。验收目录确认无用后再按站点政策清理；不要让清理命令指向变量未解析的宽泛路径。

## Doctor 和更新

只读验收：

```bash
python3 -I -S bootstrap/codex/install_app.py doctor
python3 -I -S bootstrap/codex/install_app.py doctor --json
```

Doctor 验证 standalone Node runtime receipt、Node/npm 关键文件 digest 与 in-runtime 目标、npm production graph、`package-lock.json`、Git revision/status/diff、应用源码指纹、完整 `dist/` 指纹、私有配置权限、launcher digest 与 service unit。只有 receipt 表明安装器曾经启动或重启服务时，它才要求 `systemctl --user is-active` 和 loopback `/health` 同时成功；仅 enable 未 start 会明确 WARN。

升级时 checkout 新的批准 tag/commit 并重新运行 install。v0.1 已有 runtime 若没有 standalone receipt，安装器只会在旧 app receipt 的 schema、owner/mode、旧 checkout 的 Git 身份、固定 artifact 元数据、Node/npm digest 与版本全部通过后，原子补写 runtime receipt；新 release 位于另一个 immutable checkout 不会被误判为篡改。没有任一可信 receipt 或 receipt/tamper 不一致时会拒绝执行 Node。runtime receipt 在 npm/build 之前已经发布，所以 npm 或 build 失败后可安全重跑 install，而不依赖尚未生成的最终 app receipt。Node 版本不会跟随网络上的“latest”移动；升级 Node 必须先更新 `app-manifest.json` 的版本和官方 checksum，再完成测试和新 release。

## 不能自动完成的内容

以下内容必须在目标机由人或经过批准的 secret/identity 系统完成：

- Codex device login、connector/plugin OAuth；
- OpenAI、OpenRouter 或其他 provider API key；
- 浏览器中的第一个 Dr. Claw 账号注册；
- native npm 包没有可用 prebuilt binary 时所需的系统编译工具；
- 任何非 loopback 网络发布。

“skill 文件已安装”和“Web 应用已构建”都不能替代这些账号、凭据和任务级依赖的真实验收。
