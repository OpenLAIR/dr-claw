# Delta 交互式申请模板

先运行 `accounts`，把账户名替换成现场值。交互分区通常最多 1 小时且费率是对应生产分区的 2 倍；用于调试，不用于常规训练。退出 shell 后检查 allocation 已释放。

## CPU shell

```bash
srun -A CHANGE_ME_CPU_ACCOUNT -p cpu-interactive \
  --nodes=1 --ntasks=1 --cpus-per-task=8 --mem=16G \
  --time=00:30:00 --pty bash -l
```

## 单 GPU shell

```bash
delta_partition=CHANGE_ME_INTERACTIVE_GPU_PARTITION
srun -A CHANGE_ME_GPU_ACCOUNT -p "$delta_partition" \
  --nodes=1 --ntasks=1 --cpus-per-task=16 --gpus-per-node=1 --mem=58G \
  --time=00:30:00 --pty bash -l
```

先用 live `accounts/sinfo/scontrol` 核实 `delta_partition`，按真实显存/runtime 需求选择兼容的 interactive 分区；不要把该选择写进训练脚本，也不要为了“看看”而占用整节点。MI100 是 ROCm 而非 CUDA。

## `salloc` 方式

适合一个 allocation 中多次运行 `srun`：

```bash
delta_partition=CHANGE_ME_INTERACTIVE_GPU_PARTITION
salloc -A CHANGE_ME_GPU_ACCOUNT -p "$delta_partition" \
  --nodes=1 --ntasks=1 --cpus-per-task=16 --gpus-per-node=1 --mem=58G \
  --time=00:30:00
srun --pty bash -l
# ...调试...
exit
exit  # 退出 allocation shell
```

## 申请后核实

```bash
hostname -f
printf 'job=%s nodes=%s visible=%s\n' "$SLURM_JOB_ID" "$SLURM_JOB_NODELIST" "$CUDA_VISIBLE_DEVICES"
nvidia-smi -L 2>/dev/null || rocm-smi --showproductname
squeue -j "$SLURM_JOB_ID"
```

Jupyter 优先使用 Delta Open OnDemand，而不是在登录节点直接运行 notebook server。
