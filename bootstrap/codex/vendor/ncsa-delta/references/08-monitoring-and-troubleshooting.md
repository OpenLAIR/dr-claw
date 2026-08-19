# 监控、状态、故障排查与支持信息

## 1. 队列视图

```bash
squeue -u "$USER" \
  -o '%.18i %.16P %.24j %.2t %.10M %.10L %.6D %.6C %.12b %.24R'
```

字段可因 Slurm 版本变化。重点：JobID、partition、state、elapsed、time left、nodes、CPU、GRES、reason/nodelist。

预计开始：

```bash
squeue --start -j <JOBID>
```

详情：

```bash
scontrol show job -dd <JOBID>
sprio -j <JOBID>
```

开始时间只是当前 backfill 估计，随队列变化。

## 2. 运行中资源

```bash
sstat -j <JOBID>.batch \
  --format=JobID,AveCPU,AveCPUFreq,AveRSS,MaxRSS,MaxVMSize,MaxDiskRead,MaxDiskWrite
```

某些字段/step 可能不可用。列出 steps：

```bash
sstat -j <JOBID>
sacct -X -j <JOBID> --format=JobIDRaw,State,Elapsed,AllocTRES -n
```

作业开始后，Delta 允许 SSH 到分配节点用于监控：

```bash
node=$(squeue -h -j <JOBID> -o '%N' | head -n1)
ssh "$node"
```

只监控自己的 allocation；不要在节点上启动绕过 Slurm allocation 的额外重任务。

NVIDIA：

```bash
nvidia-smi
nvidia-smi dmon -s pucvmet -d 10
```

AMD：

```bash
rocm-smi
```

长时间 `dmon` 输出应放 work，避免终端/日志无限增长。

## 3. 完成后 `sacct`

```bash
sacct -X -j <JOBID> \
  --format=JobIDRaw,JobName,Partition,Account,State,ExitCode,DerivedExitCode,Elapsed,Timelimit,Start,End,AllocTRES,ReqTRES,MaxRSS,TotalCPU,NodeList
```

数组：

```bash
sacct -X -j <ARRAY_JOBID> -n -P \
  --format=JobIDRaw,State,ExitCode,Elapsed,MaxRSS
```

`seff <JOBID>` 若现场安装可作为摘要，但不要依赖它替代原始 `sacct`。

## 4. 常见 State

- `COMPLETED`：Slurm 认为正常结束；仍需验证科学输出完整。
- `FAILED`：batch/step 非零退出；看 ExitCode、stderr。
- `TIMEOUT`：达到 walltime；增加合理余量或 checkpoint，不只重跑。
- `OUT_OF_MEMORY`：通常 host memory/cgroup OOM；看 MaxRSS 和内核/Slurm日志。
- `CANCELLED`：用户、管理员、依赖或系统取消；详情常含 `by <uid>`/时间。
- `NODE_FAIL`：节点故障；保存证据，修复脚本幂等性并考虑 requeue。
- `PREEMPTED`：抢占；验证 checkpoint/requeue。
- `BOOT_FAIL`：节点启动失败；通常非用户代码。
- `DEADLINE`：未能在 deadline 前完成/开始。

状态名以当前 Slurm 为准。

## 5. ExitCode

Slurm 常显示：

```text
exit_status:signal
```

例如 `1:0` 是程序 exit 1；`0:9` 可能由 SIGKILL。`0:0` 不保证结果正确；应用可能捕获错误后仍返回 0。

检查 batch 与 step：

```bash
sacct -j <JOBID> --format=JobIDRaw,State,ExitCode -n
```

## 6. TIMEOUT

证据：State `TIMEOUT`，日志在固定时刻中断，接近 Timelimit。

处理：

1. 检查最后 checkpoint 是否完整；
2. 计算实际工作进度与 staging/copy-back 时长；
3. 从历史 P95 重新设 time；
4. 加 `--signal=B:USR1@300`；
5. 确保恢复不会重头覆盖；
6. 若任务 >48h，拆成 checkpoint chain，而非申请超 partition max。

不要只加到 48h 而不理解为何变慢。

## 7. Host OOM

Slurm `OUT_OF_MEMORY` 或日志 `oom-kill`。检查：

```bash
sacct -j <JOBID> --format=JobIDRaw,State,MaxRSS,ReqMem,AllocTRES
```

可能原因：

- dataloader workers 每个复制数据；
- 多进程 cache；
- `fork`/copy-on-write 变脏；
- 内存泄漏；
- 误把 `--mem` 当每 task；
- 多 task 总内存高于估计。

修复优先：profile/减少 worker/cache/batch，之后才加内存。加内存可能提高 SU。

## 8. GPU OOM

框架报 CUDA/HIP out of memory，但 Slurm state 可能只是 FAILED。处理：

- 记录每 rank 显存峰值；
- 降 batch/microbatch；
- gradient accumulation；
- activation checkpointing；
- mixed precision；
- sharding/FSDP/ZeRO；
- 修复 tensor 泄漏和缓存；
- A40 48GB/H200 141GB 或多卡策略。

不要通过增加 `--mem` 修 GPU 显存 OOM。

## 9. GPU 低利用率

检查：

- 数据是否从 HOME/拥塞共享盘逐小文件读；
- CPU worker 与 CPU allocation；
- batch size；
- CPU/GPU 同步和 `.item()`；
- checkpoint/validation 频率；
- 多卡通信；
- 是否只有 rank 0 工作；
- 请求 4 GPU 但程序只看见/使用 1 GPU。

命令：

```bash
srun --label bash -lc 'echo rank=$SLURM_PROCID cuda=$CUDA_VISIBLE_DEVICES'
nvidia-smi dmon -d 5
```

优化后比较端到端 SU/结果。

## 10. NCCL/RCCL hang

先做最小 2 GPU/2 node test。记录：

```bash
export NCCL_DEBUG=INFO
export NCCL_DEBUG_SUBSYS=INIT,NET
```

日志可能很大，诊断完成后关闭。检查：

- rank/world size 一致；
- master address/port 可达且唯一；
- 每节点 launcher 数；
- 所有 rank 到达同一 collective；
- 数据分支是否让某 rank 提前退出；
- host/container NCCL、MPI/PMI 兼容；
- filesystem load 导致某 rank 极慢。

不要无依据硬编码网络接口或禁用高性能 transport；先咨询 Delta 文档/支持。

## 11. 文件系统/配额错误

症状：`No space left on device`、`Disk quota exceeded`、`Too many files`、I/O hang。

```bash
quota
df -hT <path>
df -ih <path>
```

`df` 显示全局文件系统仍有空间，不代表用户/project quota 未满。`/tmp` 可能因同节点共享而不足。

处理：

- 停止产生更多输出；
- 保留故障证据；
- 清理/迁移可重建 cache；
- 合并小文件；
- 确认输出没有只留在 local tmp；
- 必要时申请项目扩容。

## 12. 模块/ABI/Import 错误

记录：

```bash
module list 2>&1
which python
python -VV
python -c 'import sys; print(sys.executable, sys.path)'
ldd <binary-or-so> | sort
```

常见原因：

- 登录 shell env 与 batch 不同；
- `~/.local` 盖过 Conda；
- CUDA module 与 PyTorch wheel 冲突；
- x86/ARM env 混用；
- AMD/Intel `-march=native` binary；
- 容器未加 `--nv`/`--rocm`；
- build 与 runtime compiler/libstdc++ 不同。

先构造最小 import job，不在生产大作业中反复试错。

### 12.1 主程序开始前的环境失败

如果 batch shell 在 `srun` 前执行 `module load` 就失败，Python 根本没启动。因此下列“没有出现”不能证明作业没失败：

- Python `try/except` 日志；
- 应用层 `FAILED.json`；
- 第一个 optimizer step/GPU probe；
- 训练目录中的 marker。

典型实例是 Delta RH9 上 `pytorch-conda/2.8` wrapper 因 `python/.conda-env/pytorch/2.8-cu128` hidden dependency 不可见而退出。这类故障必须归类为 `pre-application environment failure`，并保留：

```text
Slurm stdout 全文
Slurm stderr 全文
sacct allocation/.batch/.extern 行
scontrol show job -dd
source manifest 与 SHA256
login/runtime receipt（如果已来得及生成）
jobcharge 原始输出
```

修复后不要在旧 source root 原地换 module 命令并复用旧 run ID。建立新 immutable attempt identity，显式指向 parent JobID/失败产物 SHA256，并记录“此 attempt 在主程序前终止，科学步数为 0”（只有真的时候才写 0）。

更稳健的新脚本应将已冻结环境 loader 放在 `srun` 内，让 shell-level failure marker 与 Slurm step 都能被记录；但旧作业在 `srun` 前失败时，仍须依靠 stdout/stderr + `sacct` 还原。

## 13. Pending 很久

按顺序：

```bash
squeue -j <JOBID> -o '%.18i %.2t %.20R %.10M %.10l %.6D %.20P'
scontrol show job -dd <JOBID>
sprio -j <JOBID>
squeue --start -j <JOBID>
accounts
```

再看：

- 账户余额/QOS；
- 资源是否稀缺；
- time/max；
- feature constraint；
- dependency；
- GPU/account limit；
- maintenance/reservation。

不要承诺某个估计 start time，也不要通过重复提交多个副本“抢跑”。

也不要因为 pending 比预期久就自动 `scancel`、hold/release/requeue、改 partition/resource/walltime/dependency。取消会失去旧 JobID 和已积累的 queue age/位置；新 `sbatch` 会重新排队。先报告诊断与代价，继续等待，除非用户针对具体 JobID 明确授权变更。

## 14. Array 部分失败

```bash
sacct -X -j <ARRAYID> -n -P \
  --format=JobIDRaw,State,ExitCode,Elapsed,MaxRSS | \
  awk -F'|' '$2 != "COMPLETED"'
```

提取失败 indices，核实失败原因后只重跑这些。不要让重跑覆盖成功 output；加入 run/retry 标识。

## 15. Node failure / 系统问题的支持包

向 NCSA 支持提供文本，不只发截图：

```text
NCSA username（不要密码）
Project/account
JobID(s)
UTC/本地时间范围
Partition、nodes、requested resources
最小复现命令/脚本
scontrol show job -dd 输出
sacct 完整行
stdout/stderr 末尾和首个错误
module list / container path+checksum
是否可在其他节点/partition复现
数据路径与 filesystem（不要发送敏感数据）
```

生成：

```bash
bash <SKILL_ROOT>/scripts/delta-job-report.sh <JOBID> <ACCOUNT> > job-<JOBID>-report.txt
```

若怀疑系统故障，不要自行排除大量节点或无限重试。

## 16. 安全控制作业

以下都是队列 mutation，不是常规监控命令。只在用户针对已经核实的具体 JobID 明确要求，并且已经获知取消/重投会重新排队后执行：

```bash
scancel <JOBID>
scancel --signal=TERM <JOBID>
scontrol hold <JOBID>
scontrol release <JOBID>
scontrol requeue <JOBID>
```

取消 array 单项：

```bash
scancel <ARRAYID>_<TASKID>
```

取消前显示目标的 job name/account/state，避免错杀。

还必须显示 dependency 和当前 pending reason；保存 mutation 前后的 `scontrol show job -dd`。不得把 `scancel --signal=...`（只发信号）与 `scancel <JOBID>`（取消作业）混为一谈。重新提交时记录旧/新 JobID，不能声称继承原 queue age/位置。

### 16.1 前台 operator、空 wrapper output 与 duplicate FATAL

长 controller 可能继续运行在统一 exec/terminal session，而一次 wrapper wait 暂时没有新 output。空 output、无新日志或第二次 invocation 的 duplicate `FATAL` 都不等于原 controller 失败。duplicate 只证明重复调用 fail-closed；原 scope 仍须独立核实。

恢复/取消前读取 write-once ACTIVE receipt，并核对 exact PID、`/proc/<PID>/stat` starttime ticks、cmdline/script SHA、scope/attempt ID 和 launcher session；`kill -0` 或宽泛 `pgrep` 不能单独排除 PID reuse。若 exact owner 仍活着，继续等待原 session/child。只有原 child 的真实 wait exit 为 0、全部 expected receipt/manifest/hash 通过后，原 owner 才能 write-once 创建 aggregate `COMPLETE`。不同 shell 不能为非 child PID 补造 `wait`，也不能并发再次 invoke 或覆盖同一 scope。

exact PID 已死且没有可信 TERMINAL/COMPLETE 时，状态是 incomplete/unknown；保留 lock 与 partial evidence，用新的 immutable recovery identity 指向旧 scope。完整判定表见 `13-runtime-gpu-namespaces-and-single-writer-operators.md`。

## 17. 复盘指标

每类稳定工作负载维护：

```text
partition
GPU model/count
CPU/memory
input size
Elapsed P50/P90/P95
GPU utilization
peak GPU memory
MaxRSS
SU/run
success/timeout/OOM rate
queue wait
```

排队等待是用户体验指标，但不能用一次队列快照断言某 GPU 永远更快启动。
