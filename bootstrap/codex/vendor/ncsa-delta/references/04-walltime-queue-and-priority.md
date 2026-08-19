# Walltime、队列、Backfill、Priority 与抢占

## 1. `--time` 的精确定义

```bash
#SBATCH --time=HH:MM:SS
```

这是整个 job allocation 的运行上限，不只是 Python 主程序时间。包括：

- 环境初始化；
- 数据 staging；
- 主程序；
- checkpoint/copy-back；
- 作业步骤的收尾。

达到上限时 Slurm 对作业步骤发送 SIGTERM，随后在集群 `KillWait` 后发送 SIGKILL。秒级字段会向上舍入到分钟分辨率。不要依赖可能存在的 `OverTimeLimit` 宽限；按硬上限设计。

Delta 分区静态最大值：生产和 preempt 多为 48 小时；interactive 多为 1 小时。未显式写 time 的默认约 30 分钟，但所有生产脚本都必须写。

## 2. 15 分钟估计的正确处理

假设用户说“估计 15 分钟”：

- 写 `--time=00:15:00`，实际到 20 分钟时会被终止；
- 写 `--time=00:30:00`，实际 20 分钟结束，通常按约 20 分钟的保留资源计费，而不是强制按 30 分钟；
- 但 scheduler 和余额准入会看到 30 分钟上限，可能影响 backfill 和 `QOSGrpBillingMinutes`。

决策不是“越短越好”，而是最小化：

```text
等待成本 + 超时重跑成本 + 余额占用 + 科学失败风险
```

首次无历史时，15 分钟估计通常请求 25–30 分钟；有 checkpoint 且重跑便宜可以更激进；稳定历史后用 P95+margin。

## 3. 用历史数据估计

获取成功作业：

```bash
sacct -X -S now-30days -u "$USER" --name <JOB_NAME> \
  --state=COMPLETED \
  --format=JobIDRaw,JobName,Partition,State,ElapsedRaw,Elapsed,Timelimit -n -P
```

建议：

- 至少 5 次同型成功记录；
- 按数据规模、GPU 类型、GPU 数、batch size 分组；
- 排除因 early stop、空数据、cache warm/cold 差异而不具代表性的 run；
- 计算 median、P90、P95、max；
- 短作业 margin 取 `max(5分钟, 20%×P95)`；
- 长作业 margin 取 `max(10分钟, 15%×P95)`，再覆盖 checkpoint/copy-back。

工具：

```bash
python3 <SKILL_ROOT>/scripts/delta-time-advisor.py \
  --job-name <JOB_NAME> --days 30 --partition <PARTITION>
```

若输入规模线性变化，可先用单位数据时长拟合，但必须预留初始化、验证和 checkpoint 的固定开销。

## 4. Backfill 不是简单“短任务优先级更高”

Slurm 通常先按 priority 考虑 pending 作业。backfill 调度器可以提前启动较低优先级作业，前提是不延迟已经为更高优先级作业预测的开始时间。

因此：

- 准确较短的 walltime 更容易匹配空档；
- 少节点、少 GPU 的请求更容易匹配；
- walltime 本身不一定出现在 `sprio` 的基础 priority 因子中；
- 高 priority 大作业仍可能因资源不足等待，低 priority 小作业反而 backfill 先运行；
- 预计开始时间会随队列和实际完成时间变化，不是承诺。

查看：

```bash
squeue --start -j <JOBID>
sprio -j <JOBID>
scontrol show job -dd <JOBID>
```

## 5. Priority 的组成

现场 `sprio -w` 查看权重，`sprio -j` 查看作业分解。常见因素可能包括：

- age；
- fairshare；
- job size；
- partition/QOS；
- association；
- nice。

不要从其他集群复制 priority 公式；Delta 当前配置才是事实。不得为了“刷优先级”或尝试更快启动而自动 cancel/re-submit：取消会丢失原 JobID 和已经积累的 queue age/位置，重新 `sbatch` 会得到新 JobID 并从新的队列状态开始。

## 6. 常见 pending reason

### `Priority`

作业符合条件，但前方有更高 priority 作业。检查 `sprio` 和 `squeue --start`。保持准确资源，不要盲目加 GPU。

### `Resources`

当前没有满足 GPU/CPU/内存/feature 的资源。可评估：

- 是否不必要地请求过多 GPU/节点；
- 内存是否把节点选择压得过窄；
- 是否可用 A40/A100 另一种硬件；
- 是否可缩短但仍安全的 walltime；
- filesystem constraint 是否正确。

### `QOSGrpBillingMinutes`

请求资源×请求 walltime 对账户余额过大，或项目其他 pending 作业占用同一额度。查看 `accounts`、项目队列和 jobcharge；减少实际不需要的资源/time，或由 PI 申请 supplement。

### `MaxGRESPerAccount`

达到用户/项目在分区上的 GPU 或核心限制。查看同账户正在运行/排队的作业；不通过换名字绕过政策。

### `Dependency`

前置条件未满足。检查：

```bash
scontrol show job <JOBID> | grep -E 'Dependency|Reason'
```

`afterok` 前置失败会使后续长期不运行/DependencyNeverSatisfied。先报告具体 JobID 和 dependency；只有用户在获知取消会放弃当前队列对象后明确授权，才人工 cancel/re-submit。

### `JobHeldUser`

作业被用户 hold：

```bash
scontrol release <JOBID>   # 只有用户明确要求
```

### `PartitionTimeLimit`

请求超过分区 max；修正分区或 time。不要让作业无限 pending。

### `ReqNodeNotAvail` / reservation / maintenance

看 `scontrol show job`、`sinfo -R`、系统公告。不要自动排除大量节点。

## 7. interactive 分区

特点：

- 最大 1 小时；
- 费率通常是对应生产分区 2 倍；
- 每个 interactive partition 每用户最多约 2 个 queued、1 个 running（可表现为 2 queued，或 1 running + 1 queued）；
- 用于调试、Jupyter、短编译，不用于常规生产。

单次 shell：

```bash
srun -A <GPU_ACCOUNT> -p gpuA100x4-interactive \
  --nodes=1 --ntasks=1 --cpus-per-task=8 \
  --gpus-per-node=1 --mem=29G --time=00:30:00 \
  --pty bash -l
```

需要在 allocation 内多次 `srun`，尤其 MPI：

```bash
salloc -A <ACCOUNT> -p <interactive-partition> ...
srun <command>
exit
```

由 `srun --pty` 创建的 interactive shell 本身已是一个 srun step，不适合再嵌套某些 `srun`/MPI 模式；此时用 `salloc`。

## 8. `--time-min`

```bash
#SBATCH --time=02:00:00
#SBATCH --time-min=01:15:00
```

backfill 可把最终 allocation time limit 降到 1:15–2:00 之间以更早启动。仅适合：

- 应用可以在实际分配时长内完成可缩减工作；
- 会读取 `scontrol show job` 或 `SLURM_JOB_END_TIME`；
- 有 checkpoint；
- 结果不会因提前停止而悄悄不完整。

作业启动后 time limit 不再因此改变。不要给固定 2 小时不可切分训练随意加 `--time-min=30m`。

## 9. 提前信号与 checkpoint

```bash
#SBATCH --signal=B:USR1@300
```

表示接近 end time 时向 batch shell 发 USR1。Slurm 事件分辨率使信号可能比指定时间再早最多约 60 秒。`B:` 只给 batch shell；默认不加 `B:` 时则信号所有 job steps 而不含 batch shell。许多 shell 在等待前台子进程时会延后执行 trap，因此不能写一个前台 `srun` 后就假定 `B:` trap 一定及时运行。应用能直接处理信号时优先 `--signal=USR1@300`；需要 shell 协调 staging/copy-back 时，应让 `srun` 后台运行、用可中断的 `wait`，并把信号显式转发给 steps，且实测。

稳健模式：

1. shell trap 接收 USR1/TERM；
2. 将信号转发给训练进程；
3. 训练进程原子写 `checkpoint.tmp`，`fsync`/关闭后 rename 为正式文件；
4. rank 0 更新 `latest` 指针；
5. 下一次从最新完整 checkpoint 恢复；
6. copy-back 留出明确时间。

不要在信号到达后才第一次初始化大型 checkpoint 库。

## 10. preempt 分区

Delta 的 preempt 作业静态规则：

- 至少运行约 10 分钟后才可被抢占；
- 收到 SIGTERM/SIGCONT 后，若程序处理信号，约有 5 分钟 GraceTime；
- 最终 SIGKILL 无法捕获；
- 只适合 checkpointable 任务；
- 分区费率低，但总完成时间和重跑次数不确定。

必须：

```bash
#SBATCH --requeue
#SBATCH --signal=USR1@300
```

并验证重启。这里假定应用进程直接处理 USR1；若改用 `B:`，必须采用经过测试的 shell 转发架构。Delta 默认不自动 requeue；`--requeue` 使 Slurm 在支持的事件上从 batch 脚本开头重跑。脚本必须幂等，不覆盖已有结果，不重复不可逆操作。

不适合 preempt：

- 无 checkpoint 的长训练；
- 外部系统事务；
- 单次昂贵写入无法恢复；
- 截止时间严格且重启代价很大。

## 11. 保护 pending 作业，不默认修改

`PENDING` 是正常调度状态，不是需要“修复”的故障。默认动作只有只读检查、解释 reason、估计下一次有意义的检查时间并继续等待。不得自动：

- `scancel` 后重投；
- hold/release/requeue；
- 改 partition、resource、walltime、feature 或 dependency；
- 提交同一工作的第二个副本抢跑。

即使发现一个可能更好的资源配置，也先显示 JobID、job name、account、state/reason、已等待时间和变更代价。只有用户针对该 JobID 明确授权并接受可能丢失 queue age/位置后，才可执行：

```bash
scontrol hold <JOBID>
scontrol release <JOBID>
scontrol update JobId=<JOBID> TimeLimit=00:30:00
scontrol update JobId=<JOBID> Features='projects&work'
```

是否允许、哪些字段可改取决于状态和配置。修改前后都必须保存 `scontrol show job -dd`。如果需要取消并重新 `sbatch`，必须明确记录旧/新 JobID；新作业重新排队，不能声称继承了旧作业位置。已运行作业增加 time limit通常受权限/partition limit约束，不能依赖。

## 12. 队列礼仪

- 不每秒执行全局 `squeue -a`；
- 大量 Python 作业用 array throttle 或 dependency stagger；
- 不提交成千上万个无并发上限的小作业；
- 不指定具体节点，除非诊断硬件问题；
- 不靠多分区重复提交同一工作造成重复运行；
- 不因 pending 时间比预期长就自动 cancel/re-submit；
- 用 `--parsable` 捕获 JobID；
- 失败后先诊断，不无限自动重试。
