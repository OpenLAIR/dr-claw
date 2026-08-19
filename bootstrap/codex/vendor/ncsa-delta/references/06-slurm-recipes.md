# Slurm 作业模式与可靠配方

## 1. `sbatch`、`srun`、`salloc` 的职责

- `sbatch script.slurm`：提交非交互 batch 作业；适合已调试的生产任务。
- `srun command`：申请并直接运行命令，或在已有 allocation 中创建 job step。
- `salloc ...`：先申请 allocation，shell 仍在登录节点；随后用一个或多个 `srun` 在计算节点执行。

典型原则：

- 一次性交互 shell：`srun --pty bash -l`；
- 真正交互 MPI/多次 job step：`salloc` 后 `srun`；
- 生产训练：`sbatch`，脚本内用 `srun` 启动程序。

命令行传给 `sbatch` 的选项覆盖脚本中的 `#SBATCH`。审计时同时查看两者。

## 2. 资源字段的含义

```bash
#SBATCH --nodes=2
#SBATCH --ntasks-per-node=4
#SBATCH --cpus-per-task=8
```

表示 2 节点、每节点最多 4 个 task、每 task 8 CPU，即总计最多 64 CPU。`sbatch` 只创建 allocation，不会因 `--ntasks=8` 自动启动 8 份程序；程序必须用 `srun`/MPI launcher 启动。

GPU：

```bash
#SBATCH --gpus-per-node=4
```

或一 task 一 GPU：

```bash
#SBATCH --ntasks-per-node=4
#SBATCH --gpus-per-task=1
```

不要让 `--ntasks-per-node × --gpus-per-task` 大于 `--gpus-per-node`，也不要误把 `--cpus-per-task` 当总 CPU。

## 3. 内存

- `--mem=58G`：每节点总内存；Slurm 的 `G` 是 GiB，58G≈62.28 个十进制 GB；
- 裸数字默认是 MiB；`--mem=60000` 不是 60000 bytes；
- `--mem-per-cpu=4G`：每个分配 CPU 的内存；
- `--mem` 与 `--mem-per-cpu` 不要同时使用；
- `--mem=0` 表示申请节点全部可用内存，容易触发整节点级费用；
- 物理 256 GB 节点可申请值低于 256 GB，需给 OS 留空间；
- NCSA 计费 GB 是十进制 1e9 bytes，计费估算前必须把 Slurm 二进制单位换算。

GPU 显存不由 `--mem` 控制。GPU OOM 与 host OOM 是不同故障。

## 4. 一个稳健 batch 脚本的骨架

下面的 `<PARTITION>` 适合 CPU/通用说明。**GPU 可移植脚本应省略 `#SBATCH --partition`**，并由提交命令用 `--partition=<LIVE_VERIFIED_GPU_PARTITION>` 传入，避免把 GPU 型号固化到源文件。

```bash
#!/usr/bin/env bash
#SBATCH --job-name=myjob
#SBATCH --account=<ACCOUNT>
#SBATCH --partition=<PARTITION>
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=14G
#SBATCH --time=00:30:00
#SBATCH --output=/work/hdd/<P>/%u/logs/%x-%j.out
#SBATCH --error=/work/hdd/<P>/%u/logs/%x-%j.err

set -Eeuo pipefail
umask 027

printf 'start=%s\n' "$(date -Is)"
printf 'job=%s host=%s nodes=%s submit=%s\n' \
  "$SLURM_JOB_ID" "$(hostname -f)" "$SLURM_JOB_NODELIST" "$SLURM_SUBMIT_DIR"

module reset
# module load exact/versioned modules after `module spider`
module list 2>&1

export OMP_NUM_THREADS="$SLURM_CPUS_PER_TASK"
export PYTHONUNBUFFERED=1

srun --cpu-bind=cores python -u main.py

printf 'end=%s\n' "$(date -Is)"
```

Slurm 在打开 stdout/stderr 之前不会执行脚本正文，所以日志目录必须在 `sbatch` 前创建。

## 5. 当前工作目录与代码版本

batch 默认从提交目录运行；不要假定是 `$HOME`。显式：

```bash
#SBATCH --chdir=/projects/<P>/<USER>/code/myrepo
```

或正文：

```bash
cd "$SLURM_SUBMIT_DIR"
```

记录：

```bash
git rev-parse HEAD 2>/dev/null || true
git status --short 2>/dev/null || true
git diff --stat 2>/dev/null || true
```

生产实验最好从 clean commit 或不可变 source snapshot 运行。不要在运行中的共享工作树上让另一个进程 `git checkout`。

## 6. 环境变量导出

默认 `sbatch` 会导出许多提交 shell 环境变量。优点是方便，缺点是不可复现。可用：

```bash
#SBATCH --export=ALL
```

或更严格：

```bash
#SBATCH --export=NONE
```

但 `--export=NONE` 可能影响 site 环境、module 和用户变量，必须在 Delta 上测试。折中方案是在脚本内显式设置关键变量并打印环境 manifest，不把整个偶然交互环境当依赖。

敏感 token 不应出现在 `#SBATCH`、命令行、`env` 全量日志或 Git。使用权限为 600 的 secret file或项目批准的凭据方式，并避免 stdout 回显。

## 7. CPU 串行/多线程

```bash
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=59G

export OMP_NUM_THREADS=$SLURM_CPUS_PER_TASK
export MKL_NUM_THREADS=$SLURM_CPUS_PER_TASK
srun --cpu-bind=cores ./my_openmp_program
```

如果程序单线程，申请 32 CPU 不会自动变多线程；只会浪费并收费。

## 8. MPI

```bash
#SBATCH --nodes=2
#SBATCH --ntasks-per-node=8
#SBATCH --cpus-per-task=2
#SBATCH --mem=29G

export OMP_NUM_THREADS=$SLURM_CPUS_PER_TASK
srun --cpu-bind=cores ./my_mpi_program
```

优先使用 Delta module 提供、与编译器/网络匹配的 MPI，通过 `srun` 启动。不要随意混用系统 MPI、Conda MPI、容器 MPI 和 host PMI。先跑短的 hello/collective test。

interactive MPI：

```bash
salloc -A <CPU_ACCOUNT> -p cpu-interactive \
  --nodes=2 --ntasks-per-node=4 --cpus-per-task=2 \
  --mem=14G --time=00:30:00
srun ./my_mpi_program
exit
```

## 9. 单节点多 GPU PyTorch

一种 launcher per node：

```bash
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --gpus-per-node=4
#SBATCH --cpus-per-task=64
#SBATCH --mem=232G

srun --ntasks=1 torchrun \
  --standalone \
  --nproc_per_node=4 \
  train.py
```

不要再设 `--ntasks-per-node=4` 后让每个 task 启动 `torchrun --nproc_per_node=4`。

不要在脚本里设置 `CUDA_VISIBLE_DEVICES`、固定 `cuda:N`、typed GRES、节点名或 GPU 型号分区。launcher/训练代码只使用 Slurm 可见集合与 local rank。

## 10. 多节点 PyTorch `torchrun`

```bash
MASTER_ADDR=$(scontrol show hostnames "$SLURM_JOB_NODELIST" | head -n1)
MASTER_PORT=$((20000 + SLURM_JOB_ID % 20000))
export MASTER_ADDR MASTER_PORT

srun --ntasks="$SLURM_NNODES" --ntasks-per-node=1 bash -c '
  torchrun \
    --nnodes="$SLURM_NNODES" \
    --nproc_per_node="$SLURM_GPUS_ON_NODE" \
    --node_rank="$SLURM_NODEID" \
    --master_addr="$MASTER_ADDR" \
    --master_port="$MASTER_PORT" \
    train.py
'
```

在小作业中先打印每 rank 的 hostname、rank、local rank、visible GPUs。端口选择仍可能冲突；作业内通过唯一 job ID 降低概率，并让框架失败时清晰退出。

## 11. 作业数组

```bash
#SBATCH --array=0-99%8
#SBATCH --output=/work/hdd/<P>/%u/logs/%x-%A_%a.out
```

`%8` 限制同时运行 8 个 array task，避免瞬间占满 allocation、I/O 或账户上限。

参数文件：

```bash
PARAM=$(sed -n "$((SLURM_ARRAY_TASK_ID + 1))p" params.txt)
[[ -n "$PARAM" ]] || { echo "missing param" >&2; exit 2; }
srun python run_one.py --config "$PARAM"
```

注意：

- 参数行数必须覆盖 index；
- 每 task 输出路径唯一；
- 共享 cache/checkpoint 需锁或按 task 分目录；
- 先用 `--array=0-2%1` 小测；
- `MaxArraySize` 与用户/项目限制用 live config 检查；
- 单个 task 重跑：`sbatch --array=<index> script.slurm`，不要重跑整个成功数组。

NCSA 页面支持标准 Slurm arrays，但某些旧页面措辞可能不一致。现场小测是最终依据。

## 12. 依赖与流水线

提交并捕获 JobID：

```bash
prep=$(sbatch --parsable preprocess.slurm)
train=$(sbatch --parsable --dependency=afterok:"$prep" train.slurm)
eval=$(sbatch --parsable --dependency=afterok:"$train" eval.slurm)
echo "prep=$prep train=$train eval=$eval"
```

依赖类型：

- `afterok:<id>`：前置成功；
- `afterany:<id>`：无论成功失败；
- `afternotok:<id>`：前置失败；
- `after:<id>[+minutes]`：前置开始/取消后延迟；
- `singleton`：同用户同 job name 仅一个运行。

用 `afterok` 防止失败数据继续训练；用 `afterany` 做日志/清理，但清理脚本必须保留诊断证据。

NCSA 建议大量 Python 作业错开启动，至少 3 分钟，5 分钟更保守。依赖 stagger 示例：

```bash
prev=""
for cfg in configs/*.yaml; do
  if [[ -z "$prev" ]]; then
    jid=$(sbatch --parsable --export=ALL,CFG="$cfg" train.slurm)
  else
    jid=$(sbatch --parsable --dependency=after:"$prev"+5 --export=ALL,CFG="$cfg" train.slurm)
  fi
  prev=$jid
  echo "$jid $cfg"
done
```

对独立任务，array throttle 通常比链式串行更高效。

## 13. JobID 与日志命名

Slurm 替换符：

- `%j`：JobID；
- `%x`：JobName；
- `%A`：array master JobID；
- `%a`：array task index；
- `%N`：节点名（多文件输出时谨慎）。

推荐：

```bash
#SBATCH --output=/work/hdd/<P>/%u/logs/%x-%j.out
#SBATCH --error=/work/hdd/<P>/%u/logs/%x-%j.err
```

数组使用 `%A_%a`。不要让多个作业写同一个固定 `train.log`。

## 14. 邮件通知

若 Delta mail 配置和用户邮箱有效：

```bash
#SBATCH --mail-type=BEGIN,END,FAIL,TIME_LIMIT
#SBATCH --mail-user=<EMAIL>
```

不要给超大 array 的每个 task 开所有邮件，避免邮件风暴。可以只给 master/关键生产作业使用。

## 15. 文件系统依赖

脚本使用 `/projects`/`/work/hdd` 时，在 live feature 确认后：

```bash
#SBATCH --constraint="projects&work"
```

提交后：

```bash
scontrol show job <JOBID> | grep -E 'Features|Constraints'
```

## 16. `--test-only` 和提交

```bash
python3 <SKILL_ROOT>/scripts/delta-lint.py job.slurm
sbatch --test-only job.slurm > preflight/SBATCH_TEST_ONLY.txt 2>&1
```

`--test-only` 不提交，但预计时间会变化。它的原文可能显示一个 planning JobID，该 ID 不是真实队列对象，不能用于 `squeue`、`sacct`、dependency、日志命名或归档。

GPU 脚本先把实时核实的分区作为提交上下文传给 lint/test-only；源文件本身不写 GPU 型号分区：

```bash
delta_partition='<LIVE_VERIFIED_GPU_PARTITION>'
python3 <SKILL_ROOT>/scripts/delta-lint.py \
  --submission-partition "$delta_partition" job.slurm
sbatch --test-only --partition="$delta_partition" job.slurm \
  > preflight/SBATCH_TEST_ONLY.txt 2>&1
```

真正提交只能在用户明确要求后进行，并分开保存 actual parsable 原文和规范化 JobID：

```bash
actual_submission=$(sbatch --parsable --partition="$delta_partition" job.slurm)
printf '%s\n' "$actual_submission" > preflight/SBATCH_ACTUAL_PARSABLE.txt
actual_job_id=${actual_submission%%;*}
[[ "$actual_job_id" =~ ^[0-9]+$ ]] || {
  printf 'invalid actual JobID: %s\n' "$actual_submission" >&2
  exit 2
}
printf '%s\n' "$actual_job_id" > preflight/ACTUAL_JOB_ID.txt
```

Slurm 每次真实提交时才分配 actual JobID，所以 `SBATCH_TEST_ONLY.txt` 与 `ACTUAL_JOB_ID.txt` 中的数字不同是正常现象。后续所有监控与归档从 `ACTUAL_JOB_ID.txt` 取值。

## 17. 幂等和 requeue

能 requeue 的脚本必须做到：

- `mkdir -p` 而非假设目录不存在；
- 不覆盖完整结果；
- checkpoint 有完成 marker；
- 恢复时验证配置/模型兼容；
- 数据预处理有 `_SUCCESS` 标志；
- 临时输出写到 JobID 目录；
- 外部服务调用有 idempotency key；
- 重启不会重复记账/发送重复通知。

`#SBATCH --requeue` 只允许 Slurm 重新从脚本开头执行，不会自动保存 Python 状态。

## 18. 分区只属于提交层

GPU `.slurm` 不包含单个或多个型号分区。根据 live `accounts/sinfo/scontrol`、显存下限、CUDA/ROCm runtime、成本和 walltime，在每次提交时选择一个已核实分区：

```bash
delta_partition='<LIVE_VERIFIED_GPU_PARTITION>'
actual_submission=$(sbatch --parsable --partition="$delta_partition" job.slurm)
```

不要为“抢跑”同时向多个分区提交同一工作；这会制造重复运行，也可能迫使后续取消其中一个排队作业。若确需跨型号基准，每个候选都是独立、明确命名且用户授权的实验，不是同一工作的冗余副本。

## 19. Reservations/QOS

只有项目获得 reservation/QOS 且 `scontrol show reservation`/项目说明确认时才添加：

```bash
#SBATCH --reservation=<NAME>
#SBATCH --qos=<NAME>
```

不要猜 QOS。无权限值会让作业拒绝或无限 pending。
