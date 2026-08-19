# 给 Codex 的推荐提示词

安装后可在 Codex 中写 `$ncsa-delta` 显式调用。以下提示词都要求先读现场输出，不把静态表当成当前真相。

## 建立手机到 Mac 再到 Delta 的完整连接

```text
$ncsa-delta
按 references/01-access-and-quickstart.md 建立并验证“手机 ChatGPT -> Mac Remote Control -> delta-codex SSH master -> Delta 远端 Codex”链路。先确认手机和 Mac 是同一个 ChatGPT 账号/workspace；再检查具体 SSH alias、Kerberos + Duo、control socket、远端 codex PATH 和登录状态；最后在 Desktop SSH 中选定已验证的远端目录并做 pwd/hostname/whoami 端到端只读测试。不要替我输入、保存或回显密码、Duo、8 位 PIN、OpenAI MFA 或设备码；不要把 ControlPersist 7d 描述成永久在线。
```

## 切换 ChatGPT 账号后恢复连接

```text
$ncsa-delta
我刚从旧 ChatGPT 账号切换到新账号。按账号作用域重新核对手机与 Mac Remote Control、网页授权和 OpenAI MFA；然后在 Delta 上重新执行 codex device auth，并重连 Desktop SSH。保留仍健康的 NCSA SSH master，不要因为 OpenAI 授权失败去重置 NCSA Duo。最后分别验证 Remote Control、ssh -O check、远端 codex login status 和实际 Delta 工作区。
```

## 第一次建立个人 Delta 配置

```text
$ncsa-delta
你正在 NCSA Delta 登录节点。先运行 skill 的 delta-doctor，只做只读查询；辨认我的 CPU/GPU account、余额、/projects 与 /work/hdd 配额、WORK/SCRATCH 指向、当前 partitions 和 filesystem features。特别判断我所说的 500G 与 1.5TB 分别是什么。把结果整理成一个不含密码/令牌的本地 delta-profile.env，但不要提交任何作业，也不要删除或移动文件。
```

## 审计并生成作业，不提交

```text
$ncsa-delta
阅读当前仓库、训练配置和最近的 Slurm 日志。先用 accounts/quota/sinfo/sacct 建立事实，再选择 GPU、CPU、内存、walltime 和路径；计算预期实际 SU 与按请求 walltime 的余额准入上界。用最接近的模板生成 job.slurm，但脚本不得绑定 GPU 型号/分区、节点、UUID、CUDA_VISIBLE_DEVICES 或固定 device index；把 live-verified partition 只传给 delta-lint.py --submission-partition 和 sbatch --test-only --partition。先不要执行真正的 sbatch。最后列出所有仍未验证的假设。
```

## 处理“预计 15 分钟”

```text
$ncsa-delta
这个任务我主观估计 15 分钟。不要直接写 15 分钟：先找同型成功作业的 sacct 历史，按 GPU 类型、GPU 数和输入规模过滤，给 median/P90/P95/max；再给出 walltime、margin、TIMEOUT 风险、backfill 影响和 SU 准入上界。没有可靠历史时按首次运行处理，并建议最小基准方案。
```

## 比较 A40/A100/H200/MI100

```text
$ncsa-delta
为这个具体程序比较 Delta 的 A40、A100x4、A100x8、H200 和 MI100。先检查 CUDA/ROCm、显存、互联和多节点需求；使用同一份不绑定 GPU 的脚本，在每个独立授权的提交中从命令行选择 partition；输出 samples/s、elapsed、peak VRAM、实际 jobcharge、SU/实验和排队风险。不要只按 GPU 新旧或单步速度推荐。
```

## 提交（明确写操作）

```text
$ncsa-delta
前面的资源和脚本我已经审阅，现在明确授权提交这一份 job.slurm。提交前确认脚本没有 GPU 型号/partition/node/UUID/device-index pinning，把同一个 live-verified partition 同时传给 lint --submission-partition、sbatch --test-only --partition 和 sbatch --parsable --partition；确认日志目录存在、账户余额足够、没有 CHANGE_ME placeholder。只提交一次，返回 JobID、squeue/scontrol 结果、预计费用和监控命令。不要提交重复副本。
```

## 诊断 pending

```text
$ncsa-delta
诊断 JobID <ID> 为什么 pending。读取 squeue、squeue --start、scontrol show job、sprio、accounts 和同项目 pending jobs；区分 Priority、Resources、QOSGrpBillingMinutes、MaxGRESPerAccount、Dependency、reservation/maintenance。默认保持该队列对象不动并继续等待：不要 cancel/re-submit、hold/release/requeue、修改资源/分区/依赖或提交重复副本。若确需建议 mutation，先明确取消会丢失旧 JobID 与 queue age/位置，新作业重新排队；没有我针对该 JobID 的明确授权不要执行。
```

## 诊断失败与优化下一轮

```text
$ncsa-delta
对 JobID <ID> 运行 delta-job-report，读取 stdout/stderr、sacct、sstat/seff 和 jobcharge。判断是 TIMEOUT、host OOM、GPU OOM、NODE_FAIL、PREEMPTED、程序异常、配额或 I/O 问题；给出下一次精确资源/walltime/checkpoint/存储修改。先保留证据，不自动重跑。
```

## 审计 allocation GPU runtime namespace

```text
$ncsa-delta
按 references/13-runtime-gpu-namespaces-and-single-writer-operators.md 审计这个 compute receipt。把 scontrol GRES/IDX、SLURM_JOB_GPUS、SLURM_STEP_GPUS 放在 scheduler/node-global 域，把 CVD/nvidia-smi 放在 allocation-visible inventory 域，把 Torch/local rank 放在 framework-local 域；只做域内 cardinality/consistency，绝不做跨域 ordinal equality。用同一 allocation 的 UUID/name/PCI 做观察性 join，不注册目标 GPU；验证 declared minimum <= Torch usable memory <= board total，不要求 exact equality；lexical Python 只对 lexical、resolved 只对 resolved。冻结并运行 delta-gpu-runtime-contract.py，保存 write-once report。
```

## 恢复前台长 controller

```text
$ncsa-delta
这个前台 controller 的 tool wrapper 没有新 output，另一次调用报 duplicate FATAL。不要据此判原进程失败，也不要并发重启。按 references/13-runtime-gpu-namespaces-and-single-writer-operators.md 核实原 scope 的 exact PID、/proc starttime、cmdline/script SHA、ACTIVE/TERMINAL/COMPLETE；若 owner 仍活着就继续等原 session 的真实 exit。只有 child exit 0 且全部 receipt/hash 通过时才接受 write-once aggregate COMPLETE；若原 PID 已死且无可信 terminal/complete，保留证据并设计新的 immutable recovery identity。
```

## 审计 sealed-parent overlay mode projection

```text
$ncsa-delta
按 references/14-sealed-parent-overlay-mode-projection.md 审计这次 source 合并。冻结 sealed-parent、signed-overlay 和 local-full-content 三份 mode rows manifest；base-only 完整继承父 seal，overlay 完整采用签名 path/type/size/SHA256/mode。local writable full tree 只做忽略 mode 的 content comparator，绝不作 mode authority。用真正 0440 parent + 0644/0750 overlay 的 disposable Stage1 merge 运行 delta-mode-projection.py，publish 后重新扫描 projected rows digest。失败时保留 partial/incoming，换新完整 execution/source/preflight/incoming/final/run/log/controller identity，不得只换 recovery-id。
```

## 更新这份 skill

```text
$ncsa-delta
维护本 skill。读取 references/09-maintenance-and-live-verification.md；用当前 Delta 只读命令和当前 NCSA/Slurm 官方文档复核 partitions、charge factors、硬件、配额、feature labels、命令与已知冲突。更新机器可读 facts、脚本常量、文字、last_verified、VERSION、CHANGELOG 和测试；运行 tests/run-tests.sh。任何无法确定的差异标为 unknown，不猜测；不要包含我的真实账号、用户名、路径或 doctor 输出。
```
