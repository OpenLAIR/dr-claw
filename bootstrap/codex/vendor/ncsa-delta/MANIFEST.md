# 包清单与设计说明

## 核心

- `SKILL.md`：Codex 的连接/运行主流程、硬规则、分区/费率速查、walltime、存储和输出标准。
- `agents/openai.yaml`：显示名称、默认提示和隐式触发策略。
- `README.md`：安装与第一次使用。
- `PROMPTS.md`：可直接交给 Codex 的典型提示词。

## 深入参考

`references/01` 覆盖手机到 Mac Remote Control、SSH ControlMaster、Kerberos + Duo、远端 Codex、持续连接/恢复和普通登录；`references/02` 到 `10` 分别覆盖账户计费、硬件、队列/walltime、存储、Slurm 模式、软件、监控、维护和官方来源；`references/11-gpu-portability-and-recovery.md` 覆盖 GPU 无绑定脚本、提交层分区选择、排队保护、恢复/依赖链、环境/传输/时间可移植性与科学污染边界；`references/12-formal-deployment-preflight-and-runtime-closure.md` 覆盖登录/生产 Python 分层、Lmod fallback、interpreter symlink、正式 `PYTHONPATH`/import origin、依赖 overlay、tar/mode normalization、只读源码测试、完整 unittest receipt、F3 fixture 同步和 prelaunch attempt identity；`references/13-runtime-gpu-namespaces-and-single-writer-operators.md` 覆盖 GPU 三域 ordinal、same-allocation observation join、Torch usable memory、Python lexical/resolved 和 foreground single-writer operator；`references/14-sealed-parent-overlay-mode-projection.md` 覆盖 sealed parent + signed overlay 逐路径 mode projection、generated-config 阶段化 inventory、Stage1 真实 materialize/post-inventory/seal/replay、postpublish/whole-tree digest 和完整重试 identity。`references/data/` 保存可更新的机器可读静态快照。

## 可执行工具

- `delta-doctor.sh`：只读现场快照；
- `delta-cost.py`：SU 与 walltime 准入上界估算，并精确换算 Slurm MiB/GiB 到 NCSA 十进制计费 GB；
- `delta-time-advisor.py`：从 sacct 历史或初始估计给 walltime；
- `delta-lint.py`：静态审计 Slurm 脚本；
- `delta-job-report.sh`：单作业队列、会计、利用率与 charge 报告。
- `delta-load-pytorch-2.8-cu128.sh`：实际加载 Delta 当前验证的 PyTorch 2.8/cu128 环境，wrapper 失败时使用 hidden-module fallback，并在同一环境中执行命令；
- `delta-pytorch-runtime-receipt.py`：生成不覆盖的 login/compute JSON receipt；严格核对 Python/Torch/CUDA/executable/prefix/origin 与 compute CUDA 可用性，同时把 `load_method`/`wrapper_rc`/`module_list` 保留为不参与 parity 的观测字段。
- `delta-fileset-manifest.py`：用 Python 3.9 标准库创建/验证 immutable exact file-set + SHA256 manifest，拒绝任何多余路径和 AppleDouble `._*`。
- `delta-gpu-runtime-contract.py`：用 Python 3.9 标准库离线验证 scheduler/visible/framework 三域 runtime receipt、Python lexical/resolved 与 usable-memory 下限，拒绝跨域 ordinal equality 和跨 job GPU pinning。
- `delta-mode-projection.py`：用 Python 3.9 标准库建立 sealed-parent + signed-overlay 逐路径 mode projection，分层验证 source-content 与 deployment authority，并生成 write-once projected/postpublish rows digest。
- `delta-phase-inventory.py`：用 Python 3.9 标准库执行 generated JSON config 的 pre-materialization、post-materialization、post-seal 与 whole-manifest replay 门禁；`stage1-check` 会在 unique disposable root 中真实完成整条转换。

带下划线的同名 Python 文件是可导入实现，带连字符的是面向命令行的稳定入口。

## 模板

`assets/templates/` 包含 CPU、MPI、单卡、单节点多卡、多节点 torchrun、数组、Apptainer、preempt/checkpoint、local `/tmp` staging 和 interactive 命令。GPU `.slurm` 不写型号分区，由提交层传入 `--partition`；所有模板都故意含 `CHANGE_ME`，在替换前 linter 会报错，防止误提交示例账户/路径。

## 测试

`tests/run-tests.sh` 执行 Python/Bash 语法、布局、计费、walltime、GPU 无绑定模板/linter、排队保护、exact file-set、环境恢复合同、formal deployment/runtime closure、GPU runtime 三域正负 fixture、single-writer 文档合同、sealed-parent overlay mode projection、generated-artifact phase inventory 正负回归和 CLI 测试；不需要登录 Delta，也不会提交作业。
