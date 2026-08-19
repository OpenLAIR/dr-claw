# Dr. Claw Web 可复现安装层

`install_app.py` 是 Codex/skills 基线之外的可选 Web 应用层。它只管理当前 Unix 用户的 Node 运行时、npm 依赖、前端构建、应用配置和服务入口；不会读取或复制旧机器的 `.env`、数据库、Codex 登录、connector token 或研究项目。

## 新服务器安装

在已经 checkout 到批准的 immutable Git tag/commit 后运行：

```bash
python3 bootstrap/codex/install_app.py install
```

默认把 Web 进程使用的 `CODEX_HOME` 固定为目标用户的 `<home>/.codex`。总安装器使用自定义 Codex 根时，会把同一个绝对路径通过 `--codex-home` 传入；该路径当前必须位于目标 home 内。它会写入受管 env、receipt，并由 doctor 逐项核对。生成的 launcher 由 Python 严格解析固定键集合并直接设置进程环境，不会用 shell `source`/`eval` 读取 env。

它会依次完成：

1. 下载 manifest 固定的 Node.js `22.23.2` Linux 归档，并核对 Node 官方 SHA256；
2. 用仓库 `package-lock.json` 执行 `npm ci`、生产构建和 native-module 准备，再删除仅构建期需要的开发依赖；
3. 在用户私有目录生成 loopback-only 配置、64 位十六进制随机 JWT secret、独立 SQLite 路径和新 workspace 根；
4. 写入 `$HOME/.local/bin/drclaw-web`；
5. 若真实 login home 的 user-systemd 可用，则安装并 enable 用户 unit，但默认不立即启动；没有 user-systemd 时明确降级为 launcher-only；
6. 写入不含 secret 的 receipt，并自动运行 read-only doctor。

npm lifecycle 子进程只收到最小允许列表、受管 Node `PATH`、独立 cache/tmp 和不含 registry credential 的私有 npmrc；当前 shell 中的 API key、npm token、proxy URL、SSH agent、password/secret 变量不会继承进去。运行 Web 服务时需要的 provider key 仍须由目标机的人或批准的 secret 系统单独配置。

需要安装后立即启动时必须显式选择：

```bash
python3 bootstrap/codex/install_app.py install --start
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
python3 "$test_home/dr-claw/bootstrap/codex/install_app.py" \
  --repo-root "$test_home/dr-claw" \
  install --home "$test_home" --codex-home "$test_home/.codex" --service none
```

这个流程不会启动服务，因此不会扫描或改动真实 home 中已有的 Codex sessions、Dr. Claw 数据库或三个现有项目。验收目录确认无用后再按站点政策清理；不要让清理命令指向变量未解析的宽泛路径。

## Doctor 和更新

只读验收：

```bash
python3 bootstrap/codex/install_app.py doctor
python3 bootstrap/codex/install_app.py doctor --json
```

Doctor 验证固定 Node、npm production graph、`package-lock.json`、Git revision/status/diff、应用源码指纹、完整 `dist/` 指纹、私有配置权限、launcher digest 与 service unit。只有 receipt 表明安装器曾经 `--start` 时，它才要求 `systemctl --user is-active` 和 loopback `/health` 同时成功；仅 enable 未 start 会明确 WARN。

升级时 checkout 新的批准 tag/commit 并重新运行 install。Node 版本不会跟随网络上的“latest”移动；升级 Node 必须先更新 `app-manifest.json` 的版本和官方 checksum，再完成测试和新 release。

## 不能自动完成的内容

以下内容必须在目标机由人或经过批准的 secret/identity 系统完成：

- Codex device login、connector/plugin OAuth；
- OpenAI、OpenRouter 或其他 provider API key；
- 浏览器中的第一个 Dr. Claw 账号注册；
- native npm 包没有可用 prebuilt binary 时所需的系统编译工具；
- 任何非 loopback 网络发布。

“skill 文件已安装”和“Web 应用已构建”都不能替代这些账号、凭据和任务级依赖的真实验收。
