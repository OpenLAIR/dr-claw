# Formal deployment preflight、runtime closure 与只读源码测试

本专题处理一种常见但危险的失败模式：Slurm 资源、科学代码和 GPU 本身都可能没有问题，作业却在任何训练 step 之前因 Python 层级、module 路由、依赖闭包、导入来源、文件 mode、测试副作用或旧 fixture 失败。这样的失败是 **prelaunch engineering failure**，不是科学结果，也不能靠在旧目录中“补一个包、改一个 fixture、再运行”来消除审计痕迹。

这里的规则适用于需要冻结 source、runtime 和 preflight receipt 的正式作业。普通交互探索可以更轻量，但不得被事后包装成正式运行。

## 1. 先区分三层 Python/依赖环境

### 1.1 Delta 裸登录环境

Delta 登录节点裸 `python3` 已验证可能是 Python `3.9.18`。它只适合本 skill 中明确保持 Python 3.9+、stdlib-only 的基础设施工具，例如成本估算、Slurm lint 和 exact file-set manifest。它不证明项目代码可导入。

### 1.2 冻结的生产 runtime

项目 semantic preflight、配置 materializer、source validator、完整 unittest 和正式作业必须使用同一冻结生产 runtime。当前 PyTorch 2.8/cu128 路线的已验证目标是 Python `3.11.13`、Torch `2.8.0+cu128` 和 Torch CUDA build `12.8`。

若 wrapper 因 hidden module 失败，使用完整 fallback；不能只写 `module load`，也不能省略 cache 规避：

```bash
module reset
module use /sw/rh9.4/user/modules/python/.conda-env
module --ignore_cache load cudatoolkit/25.3_12.8
module --ignore_cache load pytorch/2.8-cu128
```

随后在同一 shell 中生成 login runtime receipt 并执行项目 preflight。`module spider`、lint 和 `sbatch --test-only` 都不会 import 项目，不能替代这个步骤。

### 1.3 项目依赖 overlay

生产 runtime 自带的包与项目额外依赖是两个闭包。不要把一个位于 `/work`、可修改且未哈希的旧 venv 当成正式 authority。额外包若确实属于正式训练闭包，应构建成 `/projects/<PROJECT>/$USER/env-locks/...` 下的 **immutable hashed overlay**：

1. requirements/lock 文件列出直接和传递依赖的精确版本与 wheel SHA256；
2. wheelhouse 与 lock file 先做 exact file-set + SHA256 验证；
3. 安装到新的 unique incoming 目录，不复用旧目录；
4. 使用 `python -m pip install --require-hashes --no-deps --no-index --no-compile --target <INCOMING> ...`；
5. 对 incoming 做完整 fileset、size、SHA256、mode 和 import-origin 检查；
6. 原子 rename 到从未存在过的 final overlay，并设为只读；
7. receipt 记录 overlay manifest SHA256、lock SHA256、Python ABI、包版本与 origin。

`--no-deps` 只有在 lock 中已经显式列出全部传递依赖时才安全；否则应先修正 lock，而不是让 pip 临时联网求解。

## 2. interpreter symlink 不是身份漂移

venv/overlay 中的 `bin/python` 常是指向冻结 base interpreter 的 symlink。`sys.executable` 可以保留 venv launcher 的词法路径，而 `readlink -f` 返回 base interpreter；这是正常的 Python 环境结构，不能仅因二者字符串不同就 fail-close。

禁止使用下列 blanket guard：

```bash
[[ "$(readlink -f "$configured_python")" == "$configured_python" ]]
```

正确门禁应同时验证：

- configured interpreter 是绝对、规范化、预期目录内且不可被非授权主体修改的路径；
- 若它是 symlink，链条中的每一层都没有越过允许的 immutable runtime/overlay root；
- resolved target 的设备/inode 或 SHA256/版本符合 frozen runtime receipt；
- 运行后 `sys.executable`、`sys.prefix`、`sys.base_prefix` 和关键包 origin 符合合同；
- lexical path、resolved path 和 symlink chain 都写入 receipt。

也就是说，允许受审计的 symlink，不允许未受审计的重定向。安全判断针对归属、可写性、目标和 runtime receipt，而不是“路径必须没有 symlink”。

continuation 比较也必须按字段同类相配：

```text
current lexical launcher  == expected/prior lexical launcher
current resolved target   == expected/prior resolved target
```

禁止把 `Path(sys.executable).resolve()` 与先前 receipt 的 lexical `bin/python` 比较。前者常为 `bin/python3.11`，后者可以是合法 symlink；这种 resolved-to-lexical 混比不是安全加固，而是错误的 environment drift detector。配套回归与离线 validator 见 `13-runtime-gpu-namespaces-and-single-writer-operators.md`。

## 3. 固定 `PYTHONPATH` 与 import origin

正式入口应清除用户态和环境偶然性，再显式构造导入顺序：

```bash
export PYTHONNOUSERSITE=1
export PYTHONDONTWRITEBYTECODE=1
unset PYTHONHOME
export PYTHONPATH="<FORMAL_SOURCE>:<IMMUTABLE_OVERLAY>"
```

不要在已有任意 `PYTHONPATH` 后追加 formal source；那会允许旧 checkout 或 `$HOME/.local` 抢先导入。若需要多个 source root，顺序必须在协议中明确并写入 receipt。

在 login preflight 和 compute authority gate 中都至少打印并机器验证：

- `sys.executable`、`sys.prefix`、`sys.base_prefix` 和 `sys.path`；
- 项目顶层包、训练入口、validator/materializer 的 `module.__file__` 位于 `<FORMAL_SOURCE>`；
- overlay 包的 `module.__file__` 位于 `<IMMUTABLE_OVERLAY>`；
- Torch 等冻结基础包来自预定 base runtime；
- 没有项目模块来自 checkout、旧 attempt、writable test mirror 或用户 site-packages。

import-origin 不匹配是 prelaunch failure。不要通过把更多目录塞进 `PYTHONPATH` 来“直到能 import”。

## 4. formal runtime 与 conversion-only dependency 必须分开

某些数据转换、可视化或离线检查依赖（例如医学影像 I/O 包）不一定属于训练 runtime。项目应满足：

- conversion-only dependency 在转换函数内部 lazy import；仅 import 训练包时不应强制加载它；
- 若正式训练、配置 materializer、机器 preflight 或 source import 闭包会触达该包，它就已经是 `formal_runtime_dependencies`，不能继续称为可选；
- 真正仅离线转换使用的包列在 `conversion_only_dependencies`，由单独 conversion receipt 验证；
- machine preflight 分别输出两组依赖的 required/observed/version/origin/status，不得用一个笼统的 “dependencies passed” 掩盖边界；
- conversion 产物一旦冻结，正式训练只读取经 hash/manifest 绑定的数据产物，不应为了历史转换逻辑而加载整个转换环境。

优先通过 lazy import 缩小正式闭包。若科学/工程合同确实要求额外包，则使用上一节的 immutable hashed overlay；不要在 sealed source 中临时改代码，也不要在作业启动时 `pip install`。

## 5. macOS tar、umask 与 mode normalization

macOS 发送 tar 时必须同时禁用 AppleDouble/xattr：

```bash
COPYFILE_DISABLE=1 tar --no-xattrs -cf source.tar <SOURCE>
```

目标端先解压到 unique incoming。设置 `umask 0027` 能限制新建临时文件的默认权限，但 **umask 不会可靠覆盖 archive 中显式保存的 mode**，因此不能把它当作 mode normalization。

在 incoming 内、发布前执行显式 policy：

- 拒绝 `._*`、symlink、device、FIFO、socket 和未声明文件；
- 普通目录、普通文件与显式 executable 清单分别规范化；不要用一次 `chmod -R` 抹掉可执行位差异；
- 推荐的共享项目基线是目录 `0750`、普通文件 `0640`、清单内 executable `0750`；最终 seal 可按项目政策收紧为目录/可执行文件 `0550`、普通文件 `0440`；
- mode policy 和 executable 清单本身纳入 manifest；
- normalization 后再计算 exact fileset + SHA256 + mode manifest；
- final 路径必须此前不存在，使用同一文件系统内 atomic rename 发布；发布后不再原地 chmod 或补文件。

若跨平台比较的是“预期源字节”，先核对 path/type/size/SHA256；若比较的是“可执行部署闭包”，还要核对 normalized mode。两种 manifest 的语义不可混用。

## 6. sealed source 测试不得写源码树

正式 source seal 后，compile/unittest/F3/validator 不得在 source root 内创建、修改、删除或 chmod 任何路径。测试设计应遵守：

```bash
export PYTHONDONTWRITEBYTECODE=1
export PYTHONPYCACHEPREFIX="<APPROVED_SCRATCH>/pycache/<ATTEMPT>"
export TMPDIR="<APPROVED_SCRATCH>/tmp/<ATTEMPT>"
```

Python 测试使用外部临时目录，例如：

```python
with tempfile.TemporaryDirectory(dir=approved_scratch) as tmp:
    ...
```

所有测试生成的 config、checkpoint、receipt、mock registry、cache 和日志都写到 attempt 专属外部目录。测试前后都 verify formal source manifest。

若 legacy test 暗含“源码目录可写”，优先修复 harness 使其接受外部 temp root。确有必要时可在 seal 后建立一个 **exact writable mirror** 作为测试沙箱，但必须：

1. 先证明 mirror 与 formal source 的 path/type/size/SHA256 完全相等；
2. 将 mirror 明确标为 non-authoritative、never submitted；
3. 保存测试前后 mirror content manifest 和完整差异；
4. 仍在 sealed formal source 上单独通过 import-origin、compile 和不写源码的 smoke gate；
5. 正式作业的 `PYTHONPATH` 绝不包含 writable mirror。

“mirror 上 unittest 通过”只说明测试逻辑在对应字节上通过，不能替代 formal source 的 runtime/import-origin 证明。

## 7. ordinary unittest receipt 必须可诊断

只保存 stdout/stderr 的 SHA256 不足以解释失败。完整 ordinary receipt 至少包含：

- command、cwd、frozen Python/runtime receipt SHA256、source manifest SHA256；
- UTC 开始/结束时间、return code、discovered/run/skipped/failures/errors 数量；
- 精确 `failure_test_ids` 和 `error_test_ids`；
- 每项失败的 exception class、message，以及指向完整 traceback 的日志位置；
- 完整 **unittest log** 的绝对路径、size 和 SHA256；
- `PYTHONPATH`、`TMPDIR`、`PYTHONPYCACHEPREFIX` 与 import-origin 摘要；
- 测试前后 formal source manifest verify 结果。

runner 必须用 `try/finally` 或 shell trap 在成功和失败时都以 write-once 方式生成 receipt；receipt 若已存在则拒绝覆盖。为了节省摘要体积可以截断 JSON 中的 traceback，但完整日志必须保留，且 `failure_test_ids`/`error_test_ids` 不得省略。

## 8. schema 变化必须同步全部 F3 fixtures

新增或修改 schema 字段时，不能只更新生产 parser。一次变更必须作为原子 fileset 同步：

- schema/TypedDict/dataclass；
- producer、consumer、validator、materializer 和 serializer；
- registry/template/default config；
- 所有 F0/F1/F2/F3 正向 fixture；
- 缺字段、错类型、越权字段等负向 fixture；
- source manifest/协议中绑定的 schema version 或 SHA256；
- full unittest discovery 和 targeted F3 test ID 清单。

若 full discovery 出现一批相同“missing field”错误，应先判断 fixture 是否落后于 schema；不得跳过这些测试、只跑 targeted happy path，或把 fixture failure 误判成 GPU/runtime 故障。F3 fixtures 未同步时不得进入 `sbatch --test-only` 之后的执行阶段。

## 9. D03–D06 等 prelaunch failure identity 不得原地修

preflight/deployment identity 一经写出就是 audit evidence；每一个都是 write-once 的 **immutable attempt identity**。假设 `D03`、`D04`、`D05`、`D06` 分别因 module、dependency、mode 或 fixture 失败：

- 保留每个 source/preflight root、stdout/stderr、receipt 和 manifest；
- 不删除失败 marker，不覆盖 receipt，不在原 root 中装包或改 fixture；
- 修复后创建新的 `D07`（或下一唯一 identity），新的 incoming/source/preflight/run root 必须此前不存在；
- 新 attempt 记录 parent identity、父失败 receipt SHA256、根因分类、补丁 fileset 和每个变更 SHA256；
- 如果修复改变正式代码、依赖或 schema，明确标为新的工程/科学合同；不能宣称旧 identity 被“修好了”。

这条规则在任何 optimizer step、Validation 或科学输出之前失败时同样适用。prelaunch failure 没有科学效应估计，但它仍是不可变的工程证据。

## 10. 推荐的 fail-closed 顺序

1. 创建唯一 incoming/source/preflight/run identity，确认所有 final 路径不存在；
2. 传输到 incoming，拒绝 AppleDouble/special file，验证源字节 fileset；
3. 显式 mode normalization，生成部署 fileset/mode manifest；
4. 物化纯配置并运行 source/science audit；
5. 加载 frozen Python 3.11 runtime；核对 interpreter symlink chain 与 login receipt；
6. 构建或验证 immutable dependency overlay，分别审计 `formal_runtime_dependencies` 与 `conversion_only_dependencies`；
7. 固定 `PYTHONPATH`/`PYTHONNOUSERSITE=1`，验证所有关键 import origin；
8. seal formal source，并立即 verify whole-source manifest；
9. 在 external temp 上运行 compile、full ordinary unittest、F3 和静态/resource smoke；每一步保存完整日志、test IDs 和 write-once receipt；
10. 若使用 writable mirror，只作为补充测试沙箱；随后再次 verify sealed formal source 和 formal import origin；
11. 在任何 `sbatch --test-only` 前再次 verify source/runtime/overlay manifests；
12. actual submit 后，compute authority job 作为首个 GPU gate 复核 allocation、machine/F3/resource/runtime/import-origin；prefix/arm 只能 `afterok` authority；
13. 任一门禁失败，保留 identity，停止 downstream，以新 identity 修复。

这个顺序把“登录节点预检”和“计算节点 CUDA 资格”分开：登录节点可以完成 source、schema、ordinary/F3、module/import 和 `sbatch --test-only`，但不能声称 CUDA 可用；真正 CUDA receipt 必须由 allocation 内的 authority gate 生成。

若 preflight/deployment controller 是前台长进程，还必须遵守 single-writer：wrapper 空输出或 duplicate invocation 的 `FATAL` 不能代替 exact PID/starttime 与真实 wait exit；write-once aggregate `COMPLETE` 只能由原 owner 在全部 stage receipt/hash 通过后创建。详见 `13-runtime-gpu-namespaces-and-single-writer-operators.md`。
