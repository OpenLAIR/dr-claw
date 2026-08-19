# 硬件、GPU 与资源选择

## 1. 静态硬件概览

提交前以 `sinfo`/`scontrol show node` 为准。

| 节点 | 节点数 | CPU核 | 主机RAM | GPU | 单卡显存 | 本地盘 | 互联/说明 |
|---|---:|---:|---:|---|---:|---:|---|
| CPU | 132 | 128 | 256 GB | 无 | — | 0.74 TB | AMD EPYC 7763 |
| A40x4 | 100 | 64 | 256 GB | 4×A40 | 48 GB | 1.5 TB | PCIe；GPU 间无 A100 式 NVLink |
| A100x4 | 100 | 64 | 256 GB | 4×A100 SXM | 40 GB | 1.5 TB | 4 卡 NVLink |
| A100x8 | 6 | 128 | 2 TB | 8×A100 SXM | 40 GB | 1.5 TB | 8 卡 NVLink；稀缺 |
| H200x8 | 8 | 96 | 2 TB | 8×H200 SXM | 141 GB | 2.0 TB | Hopper/NVLink；每作业最多 1 节点 |
| MI100x8 | 1 | 128 | 2 TB | 分区暴露 8×MI100；物理另有 MI210 | 32 GB（MI100） | 1.5 TB | ROCm；唯一节点 |

A40 compute capability 8.6，A100 8.0，H200 9.0。A100 MIG 未启用；不能申请切片 GPU。

Slurm 可申请内存比物理安装量通常少 5%–10%，不要对 256 GB 节点写 `--mem=256G`。保守使用约 240 GB，2 TB 节点也应先用 `scontrol show node` 看 `RealMemory/AllocMem`。

## 2. GPU 选择决策树

### 第一步：框架兼容性

- 仅 CUDA：A40/A100/H200；
- 可 ROCm 且已测试：MI100；
- CPU-only：`cpu`，除非确实需要 2 TB 主机内存且 MI100 分区策略允许更经济地运行。

### 第二步：显存

- ≤40 GB：A100 或 H200 都能容纳，通常先 A100；
- 40–48 GB：A40 可能容纳，先测性能；
- 48–141 GB：H200 是直接选择，或采用 FSDP/ZeRO/offload/checkpointing 降显存；
- >141 GB/卡：必须模型并行、多卡或 offload，不存在单卡直接解决。

不要把模型参数大小直接等同显存需求；还包括 optimizer states、gradients、activations、KV cache、workspace 和碎片。

### 第三步：互联需求

- 单卡：GPU 间互联无意义，A40 常有良好性价比；
- 2–4 卡通信密集 DDP/FSDP：A100x4 的 NVLink 通常优于 A40 PCIe；
- 8 卡单节点：A100x8/H200x8；
- 多节点：还要考虑 Slingshot、NCCL/RCCL、数据读取和同步比例。

### 第四步：费率与稀缺度

比较：

```text
科学吞吐 / SU = 每小时有效样本或任务 / 每小时 SU
```

H200 费率约为标准 A100 的 3 倍。若 H200 吞吐只提升 1.5 倍且 A100 能容纳，H200 的 SU 效率更差；若 A100 因 OOM 根本不能跑，比较就不是纯吞吐问题。

A100x8 只有约 6 节点、H200x8 约 8 节点、MI100 只有 1 节点，排队风险通常高于 100 节点级的 A40/A100x4，但实时队列才是依据。

## 3. 按 GPU 匹配 CPU 与内存

避免触发额外计费单位：

| 类型 | 每 GPU 典型不超额 CPU | 每 GPU 典型不超额主机内存 |
|---|---:|---:|
| A40x4/A100x4 | 16 核 | 62.5 GB |
| A100x8/MI100x8 | 16 核 | 250 GB |
| H200x8 | 12 核 | 250 GB |

“典型不超额”是计费边界，不是性能最佳值。若 dataloader 真需要 24 核/GPU，可以申请，但要明确多付的 SU；不要为了省账导致 GPU 长期等数据。

### 经验起点

- 1 GPU 训练：8–16 CPU、常从 32G–58G Slurm 内存起测；
- 4 GPU A100x4：32–64 CPU、常从 128G–232G Slurm 内存起测；
- 8 GPU 节点：每 GPU 8–16 CPU，再按测量调整；
- 推理：CPU 和主机内存取决于 tokenizer、请求并发和 offload；不要沿用训练模板。

必须用 `sstat`、应用 profiler、`nvidia-smi dmon` 或框架 profiler 校准。这里的 `G` 是 GiB；58G≈62.28 decimal GB，232G≈249.11 decimal GB。不要为了卡计费边界而制造 OOM。

## 4. 请求 GPU 的正确方式：数量在脚本，型号在提交层

可移植 GPU 脚本只请求数量和真实资源下限，不把某个型号、节点或物理设备写进源文件：

单节点：

```bash
#SBATCH --nodes=1
#SBATCH --gpus-per-node=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --mem=58G
```

一任务一 GPU 模式：

```bash
#SBATCH --ntasks-per-node=4
#SBATCH --gpus-per-task=1
#SBATCH --cpus-per-task=16
```

`--gpus-per-node`、`--gpus-per-task`、`--gres=gpu:N` 都是 Slurm 资源表达方式，但一个脚本应采用清晰、一致的模式。不要同时写互相矛盾的总 GPU 数和 per-task GPU 数。

优先使用不带型号的 `--gpus-per-node=N`/`--gpus-per-task=N`。GPU `.slurm` 中不要写：

```text
#SBATCH --partition=gpuA100x4       # 型号分区写死
#SBATCH --gres=gpu:a100:1           # typed GRES 写死
#SBATCH --constraint=a100           # 型号 feature 写死
#SBATCH --nodelist=...              # 节点写死
export CUDA_VISIBLE_DEVICES=0       # 本地/物理编号写死
```

实时核实账户、队列、显存和 runtime 后，在提交层选择分区：

```bash
delta_partition='<LIVE_VERIFIED_GPU_PARTITION>'
sbatch --test-only --partition="$delta_partition" job.slurm
sbatch --parsable --partition="$delta_partition" job.slurm
```

preflight 与 actual submission 必须使用同一个 `delta_partition` 并保存原始命令/receipt。这里选择型号是调度决策，不会污染可复用脚本。

在 allocation 内检查：

```bash
srun bash -lc '
  echo CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES-}
  nvidia-smi -L 2>/dev/null || true
  rocm-smi --showproductname 2>/dev/null || true
'
```

不要在登录节点根据 `nvidia-smi` 缺失判断 CUDA 环境坏了；登录节点本来没有 GPU。

## 5. 单节点 PyTorch 模式

最简单可靠的单节点多 GPU：一个 Slurm task 启动 `torchrun`：

```bash
srun --ntasks=1 torchrun \
  --standalone \
  --nproc_per_node="$SLURM_GPUS_ON_NODE" \
  train.py ...
```

另一种是一 Slurm task/一 GPU，由应用直接读取 `SLURM_PROCID/LOCALID`。不要把两种模式混合，否则可能出现“4 个 Slurm task × 每 task 再 spawn 4 进程 = 16 进程争 4 GPU”。

## 6. 多节点训练

必须明确：

- 每节点多少 GPU；
- 每节点一个 launcher 还是每 GPU 一个 Slurm task；
- `MASTER_ADDR`、`MASTER_PORT`、`NNODES`、`NODE_RANK`；
- NCCL/RCCL 版本和接口；
- checkpoint 由 rank 0 写还是 sharded；
- 数据是否所有节点都能读到；
- `/tmp` 是每节点各自一份，不共享。

模板见 `gpu-multinode-torchrun.slurm`。先用 2 节点、短 walltime 验证正确性和 scaling，再扩大。

## 7. 使用 Slurm 可见设备，不做 GPU pinning

应用必须接受 Slurm 提供的可见设备集合。允许打印 `CUDA_VISIBLE_DEVICES`、`SLURM_LOCALID`、GPU 型号和 UUID作为观察性 receipt；不允许在脚本中设置/改写它们，也不允许以命中某个 UUID、物理 index 或节点作为启动条件。

```bash
srun --cpu-bind=cores ...
```

`--cpu-bind=cores` 只约束 CPU task placement，不选择某张 GPU。为保持同一脚本可跨 GPU 节点运行，本 skill 不生成 `--gpu-bind=map_gpu:`、固定 `cuda:N` 或自定义物理 GPU map。多进程程序使用 launcher 注入的 `LOCAL_RANK`，单进程程序使用框架默认 accelerator。

检查：

```bash
nvidia-smi topo -m
numactl --hardware
srun --label bash -lc 'echo rank=$SLURM_PROCID local=$SLURM_LOCALID cuda=$CUDA_VISIBLE_DEVICES'
```

“任何 GPU 可跑”仍受诚实的软件边界约束：CUDA-only wheel/extension 需要 NVIDIA runtime，ROCm build 需要 AMD runtime；容器或 environment loader 可在提交层按 vendor 选择，但训练入口、配置和 Slurm 资源脚本不得绑定具体 GPU 型号。

## 8. A40 的使用边界

适合：

- 单卡 40–48 GB 模型；
- 对 NVLink 不敏感的多卡数据并行；
- 推理、图形/视觉、混合精度训练；
- 成本敏感且实测吞吐可接受的 CUDA 作业。

不应仅因 A40 显存 48 GB 比 A100 40 GB 大就断言更快。A40 是 PCIe 卡，通信和某些计算特性不同。以真实工作负载测试。

## 9. H200 的使用边界

适合：

- 单卡显存需要显著超过 48 GB；
- 大 KV cache、超大 batch 或内存带宽主导任务；
- H200 特性已被框架正确使用，且总 SU/实验可接受。

警惕：

- 3 倍生产费率；
- 节点少；
- 每作业最多 1 节点，即最多 8 H200；
- 主机内存请求过大或 CPU 超过 12 核/GPU 会增加 base units。

## 10. MI100/MI210 的使用边界

- 使用 ROCm/RCCL，不是 CUDA/NCCL；
- 先检查 PyTorch/TensorFlow/JAX/自定义 extension 的 ROCm 支持；
- CUDA 专用 wheel、flash-attention build、NVIDIA-only kernel 可能不能直接用；
- 全系统只有一个此类节点，排队和可用性风险高；
- 官方硬件页提到物理第 9 张 MI210，但普通分区名 `gpuMI100x8`；以 `scontrol show node` 和 allocation 内 `rocm-smi` 为准。

它也可作为 2 TB 主机内存资源，但要现场确认账户、分区和请求 GPU 的要求。

## 11. 基准方法

每种候选 GPU 做相同短基准：

1. 相同代码 commit、容器/环境；
2. 相同数据子集和随机种子；
3. 预热后测稳定阶段；
4. 记录 wall-clock、样本/秒、GPU利用、显存、CPU、I/O；
5. 记录 `jobcharge`；
6. 对训练任务还要比较达到相同 validation 指标的总时间。

输出表：

```text
GPU | batch/card | cards | samples/s | elapsed | SU | samples/SU | peak VRAM | notes
```

不要用只跑几秒的 kernel microbenchmark 替代端到端实验。
