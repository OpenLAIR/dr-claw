[English](./faq.md) | [中文](./faq.zh-CN.md)

# FAQ — 故障排除

Dr. Claw 常见的安装和运行问题，采用**问题 → 原因 → 解决方案**格式。另请参阅[README](../README.zh-CN.md)和[配置参考](./configuration.zh-CN.md)。

---

## 1. `posix_spawnp failed` — bash 不在 PATH 中

**问题：** Shell 标签页崩溃，显示 `posix_spawnp failed` 或 `spawn bash ENOENT` 错误。

**解决方案：** 尝试重新编译原生模块。在项目根目录下执行：

```sh
npm rebuild node-pty --build-from-source
```

这将强制重新编译 `node-pty` 二进制文件，可解决因依赖缺失或配置异常导致的问题。

---

## 2. `npm install` 在 `better-sqlite3` 处失败（`'climits' file not found` / Node 25）

**问题：** `npm install` 在编译 `better-sqlite3` 时失败，常见日志包括：

- `prebuild-install warn install No prebuilt binaries found (target=25.x ...)`
- `fatal error: 'climits' file not found`

**原因：** 该项目依赖的原生模块主要针对 Node LTS 版本。使用 Node 25 时可能出现编译失败。

**解决方案：** 切换到 Node 22（本仓库推荐），然后重新安装依赖。

```sh
# 使用 nvm
nvm install 22
nvm use 22
node -v

# 重新安装依赖
npm install
```

如果你不使用 `nvm`，可以用系统包管理器安装 Node 22（例如 macOS 上的 Homebrew），确保其在 `PATH` 中优先，然后再执行 `npm install`。

---

## 3. `npm run dev` 报错 `Cannot find module @rollup/rollup-darwin-arm64`

**问题：** 执行 `npm run dev` 后立即退出，Vite 报错：

- `Cannot find module @rollup/rollup-darwin-arm64`
- `npm has a bug related to optional dependencies`

**原因：** npm 偶尔会漏装与平台相关的 Rollup 可选依赖包。

**解决方案：** 手动安装缺失包后重新启动。

```sh
npm install @rollup/rollup-darwin-arm64
npm run dev
```

如果仍然失败，建议在 Node 22 环境下清理并重装依赖。

---

## 4. 已开启权限，但网页搜索仍然失败

**问题：** 即使你已经在 Settings 中允许相关工具，或切换到了更宽松的权限模式，Agent 的网页搜索仍然无法使用。

**原因：** 当前进程可能仍然受到运行时网络锁限制。尤其是当 `CODEX_SANDBOX_NETWORK_DISABLED=1` 时，即使 UI 中的权限设置看起来正确，网络访问仍会被阻止。

**解决方案：** 先检查该环境变量是否被设置，然后在启动 Dr. Claw 的那一层覆盖或移除它。

```sh
echo "${CODEX_SANDBOX_NETWORK_DISABLED:-0}"
```

如果命令输出 `1`，请在 shell 配置、systemd、Docker、PM2 或其他启动配置中移除或覆盖该变量，然后重启 Dr. Claw。

之后再确认各 Provider 的权限仍然已开启：

- Claude Code：允许 `WebSearch` 和 `WebFetch`
- Antigravity（Gemini）：允许 `WebSearch` 和 `WebFetch`
- Codex：需要网页访问时使用 `Bypass Permissions`

---

## 5. `npm install` 在 `better-sqlite3` 或 `sqlite3` 报错

**问题：** 执行 `npm install` 时崩溃，报错信息包含 `node-gyp rebuild`、`Request timed out` 或 `Could not find any Visual Studio installation`。

**原因：** 这些包包含 C++ 原生模块。在 Windows 上，npm 通常会先尝试从 GitHub 下载预编译的二进制文件。如果网络超时或无法访问这些资源，它会回退到本地 `node-gyp` 编译流程，并进一步依赖 Python 和 Visual Studio 的 C++ 构建环境。

**解决方案：** 如果问题是预编译二进制下载失败，通常无需先安装 Visual Studio。可以改用镜像源重新执行完整的 `npm install`：

```bash
# 使用镜像源下载预编译二进制，然后重新安装项目依赖
npm_config_better_sqlite3_binary_host_mirror=https://registry.npmmirror.com/-/binary/better-sqlite3 \
npm_config_sqlite3_binary_host_mirror=https://registry.npmmirror.com/-/binary/sqlite3 \
npm install
```

这样不会修改项目的 `package.json`，并且会按仓库锁定版本完成完整安装流程。
