# NCSA Delta Codex Skill

面向 OpenAI Codex 的 NCSA Delta 全流程 skill。它同时覆盖手机到 Mac Remote Control、Mac 到 Delta 的 SSH/Codex 连接，以及登录后的 Slurm 规划和审计。它不是一篇静态“命令速查”，而是一套要求 Codex 先验证每一层连接和现场事实、再执行工作的流程。

## 安装

当前 Codex 会扫描用户级 `$HOME/.agents/skills`，以及从当前目录到仓库根目录沿途的 `.agents/skills`。

**用户级与仓库级安装二选一，不要同时保留两个可见的 `ncsa-delta`。** 两份同名 skill 会造成路由重复、版本漂移和规则冲突。本项目以仓库内 `.agents/skills/ncsa-delta` 为唯一主版本；若已经存在用户级旧副本，先审计差异，再移除或移到可恢复归档位置。

### 用户级安装

```bash
mkdir -p "$HOME/.agents/skills"
cp -R ncsa-delta "$HOME/.agents/skills/ncsa-delta"
```

### 仓库级安装

```bash
mkdir -p .agents/skills
cp -R ncsa-delta .agents/skills/ncsa-delta
```

如果 Codex 会在 Delta 远端运行，还要把 skill 安装到 Delta 用户自己的 home；只安装在 Mac 上不会自动复制到 SSH 主机：

```bash
ssh delta-codex 'mkdir -p "$HOME/.agents/skills/ncsa-delta"'
rsync -a ncsa-delta/ delta-codex:.agents/skills/ncsa-delta/
```

该命令不使用 `--delete`，不会删除远端其他 skill。安装前若目标已存在，应先审计差异并明确更新策略。

Codex 通常会自动检测变更；没有出现时重启 Codex。使用 `/skills` 查看，或在提示中写：

```text
$ncsa-delta
```

## 运行要求

- Codex CLI/IDE 能读取本地 skills；
- Bash；
- Python 3.9 或更高版本（仅标准库）。在 Delta 上先运行 `module reset`，再用 `python3 --version` 核实；若系统默认版本过旧，使用 `module spider python` 选择现场可用版本，不要把某个版本号永久硬编码进作业。

## 第一次连接

完整步骤见 `references/01-access-and-quickstart.md`。一句话入口：

```text
$ncsa-delta 请按分层手册建立手机到 Mac Remote Control、delta-codex SSH master、Delta 远端 Codex 登录和 Desktop SSH 连接；不要记录任何密码、Duo、PIN 或设备码，最后做端到端只读验证。
```

连接过程明确区分 NCSA Kerberos、NCSA Duo 与 OpenAI 账号/MFA。`Connected` 只是界面状态；仍需核对 SSH control socket、远端身份、远端 Codex 登录和实际工作区。

## 第一次使用 Delta

在 Delta 登录节点执行只读诊断：

```bash
bash "<SKILL_ROOT>/scripts/delta-doctor.sh" \
  --output "$HOME/delta-doctor-$(date +%Y%m%d-%H%M%S).txt"
```

然后把目标仓库、历史日志或现有 `.slurm` 脚本交给 Codex，例如：

```text
$ncsa-delta 请检查这个训练任务，先读取 accounts、quota、sinfo，选择最合适的 GPU，
根据历史 sacct 给 walltime，估算预期 SU 和准入上界，生成脚本，但先不要提交。
```

默认在 `/projects/<PROJECT>/$USER`、`/work/hdd/<PROJECT>/$USER` 和（若已分配）`/work/nvme/<PROJECT>/$USER` 下组织个人数据；项目根目录只放明确的共享内容。实际路径和额度始终先用 `quota` 与权限探针核实。

对 Python/Torch/CUDA 有固定合同的作业，`module spider`、lint 和 `sbatch --test-only` 都不够；还必须在登录节点实际 load/import，并在 compute allocation 内再生成 runtime receipt。PyTorch 2.8/cu128 的已验证 loader 见 `scripts/delta-load-pytorch-2.8-cu128.sh`，详细 claim boundary 见 `references/07-software-and-reproducibility.md`。login/compute 间的 `load_method`、`wrapper_rc`、`module_list` 只保留为 Lmod 路由观测；真正的 fail-closed parity 只由精确 Python/Torch/CUDA/executable/prefix/origin 字段决定。Delta 裸 `python3` 的 3.9 支持只针对 skill 自身 stdlib 工具；项目 semantic preflight 也必须走 frozen loader 进入 Python 3.11.13。

正式部署还必须冻结项目依赖闭包、`PYTHONPATH`/import origin 和文件 mode；sealed source 上的测试只能使用外部 tempfile/cache，并保存完整 unittest log 与 test IDs。可选 conversion dependency、interpreter symlink、immutable overlay、F3 fixture 同步和失败 attempt identity 的完整门禁见 `references/12-formal-deployment-preflight-and-runtime-closure.md`。

compute runtime 还要严格区分 scheduler/node-global、allocation-visible inventory 与 framework-local 三个 GPU ordinal namespace。`IDX=3` 而 CVD/`nvidia-smi`/Torch 为 local `0` 是已验证的正常映射；三处数字恰好都为 `0` 也不表示同一 namespace。可冻结 `scripts/delta-gpu-runtime-contract.py` 做 fail-closed 验证；Python lexical/resolved、Torch usable-vs-board memory 与前台 single-writer operator 见 `references/13-runtime-gpu-namespaces-and-single-writer-operators.md`。

sealed parent 加 signed overlay 的 source 恢复必须做逐路径 mode projection：base-only 继承父 seal，overlay 采用签名 mode；local writable full tree 只比较 path/type/size/SHA256，不提供 mode authority。可冻结 `scripts/delta-mode-projection.py` 验证 Stage1/prepublish/postpublish 并生成 projected rows digest。

若物化还会生成 canonical JSON config，inventory 必须按阶段切换：pre-materialization 明确拒绝 config；post-materialization 要求恰好一个 canonical config，核对其 path/type/size/SHA256/mode/schema，并证明其余 projected rows 未变；post-seal 则把 config 纳入全树 exact-mode manifest 和独立 replay。不能把通用清单中默认排除 config 的结果直接用于 post-materialization。`scripts/delta-phase-inventory.py stage1-check` 会在 unique disposable root 中真实执行 materialize → post-inventory → seal → replay。partial/incoming 失败后必须保留，修复必须换新完整 execution identity，不只换 recovery-id。详见 `references/14-sealed-parent-overlay-mode-projection.md`。

macOS 到 Delta 的 tar 传输要同时使用 `COPYFILE_DISABLE=1` 和 `--no-xattrs`，并用 `scripts/delta-fileset-manifest.py` 在目标端做拒绝额外 `._*` 的 exact file-set 验证。验证失败时 incoming 不得发布为 final。

## 安全边界

本 skill 要求默认只读。`sbatch`、`scancel`、requeue、删除和覆盖必须有用户明确意图。排队中的作业不会被自动取消、修改或重复提交；取消后重新提交会重新排队，不能继承旧 JobID 与 queue age/位置。脚本不会保存密码、Duo 信息或令牌。

GPU 脚本不绑定 GPU 型号、物理卡、节点、UUID、固定 device index 或 `CUDA_VISIBLE_DEVICES`。GPU 分区只在提交层通过 `sbatch --partition=...` 选择；业务脚本使用 Slurm 实际分配的可见设备。NVIDIA/AMD 运行环境仍需分别满足 CUDA/ROCm 兼容性。

前台长 controller 的 wrapper 空 output 或 duplicate `FATAL` 不等于原进程失败。必须核实 exact PID/`/proc` starttime/scope 并等待原 owner 的真实 exit；write-once aggregate `COMPLETE` 是完整性证据，禁止并发重复 invoke 或覆盖旧 scope。

## 包含内容

- `SKILL.md`：Codex 的主指令与决策流程；
- `PROMPTS.md`：首次体检、作业审计、提交、排队诊断、失败复盘和更新 skill 的提示词；
- `references/`：账户、计费、GPU 无绑定可移植性、排队保护、walltime、存储、环境、formal deployment/runtime closure、GPU 三域 ordinal/single-writer、sealed-parent overlay mode projection、只读源码测试、监控和维护细节；
- `scripts/`：环境体检、SU 估算、walltime 建议、Slurm lint、作业报告、exact file-set、GPU runtime-contract、mode-projection 和 generated-artifact phase-inventory 验证，以及 PyTorch 2.8/cu128 加载/runtime receipt；
- `assets/templates/`：CPU/MPI、单卡、多卡、多节点、数组、容器、抢占、节点本地盘 staging 和交互模板；
- `tests/`：本地单元测试，不需要登录 Delta。

## 版本与事实新鲜度

版本见 `VERSION`。静态集群事实最后核实于 2026-08-09。Delta 的 live `sinfo`、`scontrol`、`accounts`、`quota`、`module spider` 始终优先。

## 本地自检

解压后可在普通 Linux/macOS 环境运行，不需要 Delta 账户：

```bash
cd ncsa-delta
bash tests/run-tests.sh
```

测试不会连接 Delta、不会提交作业。模板故意含 `CHANGE_ME`；替换完成前 `delta-lint.py` 报 placeholder error 是安全设计。

## 给 Codex 的一句话入口

```text
$ncsa-delta 先建立 accounts/quota/sinfo/sacct 的实时事实；审计当前任务并生成脚本、成本与 walltime 建议，但没有我的明确授权不要 sbatch。
```

更多场景见 `PROMPTS.md`。
