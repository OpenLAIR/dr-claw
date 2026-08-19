# GPU 无绑定可移植性、恢复链与跨环境证据

本参考规定 Delta GPU 作业的默认边界：**同一份业务脚本可以在任何满足资源和软件合同的 GPU allocation 上运行，但绝不指定 GPU 型号、物理卡、节点、UUID 或固定设备编号。** GPU 型号/分区属于每次提交的调度选择，不属于训练脚本。

这里的“任何 GPU”不是忽略真实兼容性。CUDA-only 扩展需要 NVIDIA runtime，ROCm build 需要 AMD runtime；模型也可能有最低显存、精度或 kernel 能力要求。正确做法是在提交层选择兼容环境，并在 allocation 内验证能力，而不是绑定某张卡。

## 1. 三层职责必须分开

### 业务代码

业务代码负责模型、数据和训练逻辑：

- 单进程使用框架的默认 accelerator；
- 多进程使用 launcher 提供的 `LOCAL_RANK`/`SLURM_LOCALID`；
- 不设置 `CUDA_VISIBLE_DEVICES`；
- 不写固定 `cuda:0`/`cuda:1` 设备拓扑；
- 不比较目标 UUID、物理 index、PCI bus 或 hostname；
- 只声明必要能力，例如最小显存、BF16/FP64、GPU 数或跨卡通信需求。

PyTorch 在 ROCm build 中仍使用 `torch.cuda` API 名称，所以不能仅凭 API 名叫 `cuda` 就判断 vendor；应读取 `torch.version.cuda` 与 `torch.version.hip`。

### Slurm 脚本

GPU `.slurm` 负责通用资源形状：

```bash
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --gpus-per-node=1
#SBATCH --mem=58G
#SBATCH --time=00:30:00
```

源文件不得包含：

```text
#SBATCH --partition=gpuA100x4
#SBATCH --gres=gpu:a100:1
#SBATCH --constraint=a100
#SBATCH --nodelist=...
#SBATCH --gpu-bind=map_gpu:...
export CUDA_VISIBLE_DEVICES=...
target_uuid=GPU-...
```

filesystem feature（例如经 live 验证的 `projects&work`）不是 GPU 型号绑定，可以按实际存储依赖保留。

### 提交层

提交层根据实时事实选择账户、分区和 runtime：

```bash
delta_partition='<LIVE_VERIFIED_GPU_PARTITION>'

python3 <SKILL_ROOT>/scripts/delta-lint.py \
  --submission-partition "$delta_partition" job.slurm

sbatch --test-only --partition="$delta_partition" job.slurm \
  > preflight/SBATCH_TEST_ONLY.txt 2>&1

# 仅在用户明确授权提交后：
actual_submission=$(sbatch --parsable --partition="$delta_partition" job.slurm)
printf '%s\n' "$actual_submission" > preflight/SBATCH_ACTUAL_PARSABLE.txt
actual_job_id=${actual_submission%%;*}
printf '%s\n' "$actual_job_id" > preflight/ACTUAL_JOB_ID.txt
```

preflight 与 actual submission 必须使用同一分区值并保存原始 receipt。`SBATCH_TEST_ONLY.txt` 中可能出现的 planning JobID 不是实际队列对象；所有监控、依赖和归档只使用 actual JobID。

## 2. 分区和 environment loader 可以变化，业务脚本不变

选择分区时核实：

- 账户是否允许；
- GPU 数和单卡显存是否满足；
- CUDA/ROCm vendor 与项目依赖是否兼容；
- 需要的精度、custom extension、互联是否可用；
- CPU、主机内存、walltime 和 filesystem feature 是否满足；
- 预计 SU 与当前排队风险。

运行环境可由提交 receipt 指向冻结 loader，例如 NVIDIA 与 AMD 各有一个经过验证的 loader。loader 的职责是加载正确 module/container 并 exec 同一个训练入口；它不应把 GPU 型号或 UUID传给业务代码。

不要在 `.slurm` 中自动猜一个“最新”环境。允许在 allocation 内识别 vendor 后选择 `apptainer --nv` 或 `--rocm`，但镜像本身必须真实支持该后端；检测 flag 不能把 CUDA-only 镜像变成 ROCm 镜像。

## 3. GPU 身份只作观察性 receipt

Slurm 可能通过 `CUDA_VISIBLE_DEVICES` 重映射 allocation 内设备。`0` 表示“当前进程可见集合中的第 0 张”，不是节点物理 GPU 0。代码应尊重这个映射，不要改写它。

更严格地说，至少有三个 ordinal namespace：

1. scheduler/node-global：`scontrol GRES/IDX`、`SLURM_JOB_GPUS`、`SLURM_STEP_GPUS`；
2. allocation-visible inventory：CVD token 与 allocation 内 `nvidia-smi`/ROCm visible index；
3. framework/process-local：Torch device index、local rank/current device。

只在同域内验证 cardinality、唯一性和一致性。Delta 实测既出现过 scheduler `IDX=3` 而 CVD/nvidia/Torch 都为 local `0`，也出现过三个域数字都恰好为 `0`；前者证明跨域数字可不同，后者不授权把偶然相同解释成同一 namespace。完整合同、回归 fixture 和 validator 见 `13-runtime-gpu-namespaces-and-single-writer-operators.md`。

可以记录以下信息解释性能和环境：

```bash
printf 'job=%s node=%s localid=%s visible=%s\n' \
  "${SLURM_JOB_ID-}" "$(hostname -f)" "${SLURM_LOCALID-}" \
  "${CUDA_VISIBLE_DEVICES-}"

if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,uuid,pci.bus_id,driver_version,memory.total \
    --format=csv,noheader
elif command -v rocm-smi >/dev/null 2>&1; then
  rocm-smi --showproductname --showuniqueid --showdriverversion --showmeminfo vram
else
  printf 'no supported GPU inventory tool found\n' >&2
  exit 2
fi
```

这份 receipt 是**观测**，不是筛选：

- 不要求命中预注册 UUID；
- 不以 hostname/PCI/index 不同为失败原因；
- 不为命中某张卡指定 node 或申请整组 GPU；
- 不建立 holder/guard 作业去占住其他卡；
- 不把 `GresDetail/IDX` 变成物理卡 pinning 逻辑。

科学可复现性应依靠 source、数据、配置、随机性、runtime 和数值容差，而不是把某块物理 GPU 当作实验身份。

## 4. allocation 内只验证能力，不验证身份

在任何训练 mutation 前执行通用能力检查：

```bash
python - <<'PY'
import json
import torch

if not torch.cuda.is_available():
    raise SystemExit("FATAL: no accelerator visible to framework")

records = []
for index in range(torch.cuda.device_count()):
    props = torch.cuda.get_device_properties(index)
    records.append({
        "local_index": index,
        "name": props.name,
        "total_memory": props.total_memory,
        "major": getattr(props, "major", None),
        "minor": getattr(props, "minor", None),
    })

print(json.dumps({
    "torch": torch.__version__,
    "cuda_build": torch.version.cuda,
    "hip_build": getattr(torch.version, "hip", None),
    "device_count": torch.cuda.device_count(),
    "devices": records,
}, sort_keys=True, indent=2))
PY
```

项目可以检查“至少 N 张设备”“每张至少 M bytes 显存”“所需 dtype/op 的短自检通过”。不得检查“必须叫 A100/H200”“必须是 UUID X”“必须在 node Y”。如果一个算子只支持某架构，把它作为明确的软件能力边界并在提交前选择兼容分区；不要把整个通用脚本改成设备专用。

显存门禁使用框架真正报告的 usable bytes：`declared minimum <= Torch usable <= inventory board total`。`torch.cuda.get_device_properties(i).total_memory` 合理地可能小于 `nvidia-smi memory.total`；记录差值但不得要求 exact equality。UUID/name/PCI 可用于同一 allocation 内连接 Torch/NVML 与 inventory 行，不能成为跨 job 的目标 identity。

## 5. 排队作业默认保持不动

`PENDING` 是正常状态。长时间等待时先只读检查：

```bash
squeue -j <JOBID> -o '%.18i %.2t %.20R %.10M %.10l %.6D %.20P'
squeue --start -j <JOBID>
scontrol show job -dd <JOBID>
sprio -j <JOBID>
```

不得为了尝试另一个 GPU、分区或 walltime 而自动：

- `scancel` 当前作业；
- hold/release/requeue；
- 原地修改 partition/resource/dependency；
- 向另一个分区提交同一工作的副本。

取消后旧 JobID 和已经积累的 queue age/位置不会转移；新 `sbatch` 会获得新 JobID 并重新排队。即使诊断显示另一配置可能更快，也先向用户报告具体 JobID、state/reason、等待时间、成本和风险。只有用户针对该 JobID 明确授权并接受重新排队后果，才执行 mutation。

依赖原则：

- `afterok`：科学流水线默认；前置失败就不消费产物；
- `afterany`：归档日志或无论成败都运行的诊断；
- `afternotok`：只在失败时运行的诊断；
- replacement 不会自动重绑旧 downstream；任何取消、重投或 dependency update 都需要明确授权和旧/新 JobID receipt。

`DependencyNeverSatisfied` 也不授权自动取消。先保留 predecessor/downstream 的 `scontrol`、`sacct` 和日志，再请用户决定是否放弃旧队列对象。

## 6. 失败证据与科学污染边界

“Slurm FAILED”不自动等于“科学实验污染”；“只跑了几秒”也不自动证明无污染。按写入证据分类。

可归为 **pre-mutation engineering failure** 的必要证据通常包括：

- runtime/权限/能力 guard 在 launcher 或 optimizer step 前退出；
- 没有新的 branch checkpoint；
- 没有新的 WAL/transaction complete marker；
- 没有新的训练 telemetry/optimizer age；
- 没有 evaluation/Validation/Test 访问或结果；
- 原有 checkpoint checksum/mtime 未改变；
- stdout/stderr 能定位首次失败点。

这种失败不提供模型效果证据，但也不应污染上一份已验证 checkpoint。保留 stdout/stderr、`sacct`/`scontrol`、source/operator/config hash、failure receipt 和 pre/post file manifest。

如果已经出现 optimizer step、checkpoint/WAL、telemetry 或评估访问，把它视为单独 aborted/invalid attempt。replacement 使用新的 immutable attempt identity，不覆盖失败目录，不把部分产物静默并入新 attempt。

## 7. login + compute 双重 runtime receipt

`module spider`、lint 和 `sbatch --test-only` 都不执行项目 import；登录节点也没有 GPU。最低证据分两层：

登录层记录：

```bash
module -t list 2>&1
command -v python
readlink -f "$(command -v python)"
python -VV
python - <<'PY'
import importlib.util
import platform
import sys

print('executable=', sys.executable)
print('prefix=', sys.prefix)
print('python=', sys.version)
print('platform=', platform.platform())
for name in ('torch', '<PROJECT_PACKAGE>'):
    spec = importlib.util.find_spec(name)
    print(f'{name}.origin=', None if spec is None else spec.origin)
PY
```

compute 层再记录 framework build、CUDA/HIP backend、driver、设备数量/名称/显存和项目 import origin。门禁验证预定环境和必要能力，不验证 GPU 型号/UUID/节点身份。

Lmod 加载路由不是数值 runtime identity。login 和 compute 可能分别走 `fallback`/`wrapper`（或反过来），因为两类节点所见 module tree 或 cache 状态不同。receipt 仍必须记录 `load_method`、`wrapper_rc`、`module_list` 与它们相对 login 的差异，但这些字段不参与 login–compute `passed`。不能为避免假拒绝而放松真正的核心 runtime 门禁。

共同要求：

- Python executable/prefix 来自预定 env；
- lexical launcher 与 resolved target 分栏记录；current lexical 只对 prior/expected lexical，current resolved 只对 prior/expected resolved，禁止 resolved-to-lexical 混比；
- 自有 package import origin 位于冻结 source root；
- framework build 与当前 vendor/driver兼容；
- compute receipt 证明 accelerator 可用；
- login/compute 的核心字段一致：Python 版本、lexical/resolved executable、prefix、framework 版本、CUDA/HIP build 和 framework import origin；
- `load_method`、`wrapper_rc`、`module_list` 只作观测字段，不作科学/数值 parity；
- 不全量 dump `env`，只记录白名单变量；
- 环境不一致时在 mutation 前退出，并用新 immutable attempt identity 修复。

## 8. macOS `rsync` 兼容性

macOS 系统旧 `rsync` 可能不支持较新选项。先检查双方版本：

```bash
rsync --version | head -1
ssh delta-codex 'rsync --version | head -1'
```

对小型脚本/配置使用两端都支持的保守流程：先创建精确目标目录，再 `rsync -a --partial`，最后只对显式文件 `chmod` 并核实。禁止 `--delete` 和宽泛 `chmod -R 777`。

跨系统目录归档遵循 tar-stream + checksum + exact file-set + atomic rename。macOS 发送 tar 时同时使用 `COPYFILE_DISABLE=1` 与 `tar --no-xattrs`；目标端用 `delta-fileset-manifest.py` 拒绝额外 AppleDouble `._*`。

## 9. 时间与低频监控

同时记录 cluster local、操作者本地和 UTC：

```bash
printf 'cluster_local=%s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z %Z')"
printf 'utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
```

正式 receipt 以 UTC 和 epoch seconds 为规范字段。不要手算跨夏令时时差。

监控先取一次 `squeue --start` 和 `scontrol show job -dd`。RUNNING 时按 `EndTime`、当前进度和历史吞吐估计下一个有意义事件；PENDING 时给动态估计更大余量。然后在操作者/监控进程中长 `sleep`，醒来只取一次快照；若未完成，重新估计再 sleep。不要在昂贵 GPU allocation 内 sleep，也不要忙轮询。

## 10. 三层持久空间

| 层 | 角色 | 应放内容 | 不应作为唯一权威的内容 |
|---|---|---|---|
| `/projects/<PROJECT>/<USER>` | 权威、共享、长期保留 | immutable source、operator、protocol、environment lock、manifest、receipt、最终报告/校验和 | 高频临时 checkpoint、可重建 cache |
| `/work/hdd/<PROJECT>/<USER>` | 活跃、较大、持久工作区 | run root、checkpoint、WAL、telemetry、stdout/stderr、staging、中间分析 | 唯一 source/protocol/最终 receipt |
| `/work/nvme/<PROJECT>/<USER>` | 高 IOPS、可重建数据层 | processed dataset cache、小文件 shard、hot cache | 唯一原始数据、唯一 checkpoint、唯一正式结果 |

运行从 `/projects` 的冻结 source/operator 启动，活跃 campaign 写 `/work/hdd`，`/work/nvme` 只作可重建加速副本。最终 receipt 回写 `/projects` 并做 SHA256/exact file-set 验证；关键成果仍需集群外备份。

## 11. 自检清单

### 提交前

- [ ] GPU 脚本没有型号分区、typed GRES、GPU 型号 constraint、node、UUID、固定 device index 或 GPU map。
- [ ] 业务代码不设置 `CUDA_VISIBLE_DEVICES`，多进程按 local rank 使用 Slurm 可见集合。
- [ ] live 核实账户、分区、显存、GPU 数、CUDA/ROCm、walltime、成本和 filesystem feature。
- [ ] lint/test-only/actual submission 使用同一个外部 `delta_partition`；planning 与 actual JobID 分离。
- [ ] source/config/runtime loader 已冻结并有 SHA256；stdout/stderr 目录已存在。
- [ ] 若已有 pending 作业，不取消、不修改、不重复提交，除非用户针对具体 JobID 明确授权。

### allocation 内、mutation 前

- [ ] framework accelerator 可用，设备数量和通用能力满足要求。
- [ ] scheduler、allocation-visible inventory、framework-local 三个 ordinal namespace 分栏；没有跨域 ordinal equality。
- [ ] Torch usable memory 达到 declared minimum 且不高于 board total；没有 exact-equality 或型号门禁。
- [ ] Python executable/prefix、项目 import origin、framework CUDA/HIP/driver 合同一致。
- [ ] GPU 型号/UUID只写观察性 receipt，没有 identity pinning/fail-close。
- [ ] checkpoint checksum、step 和 transaction chain 通过。

### 失败后

- [ ] 保存 `scontrol`、`sacct`、stdout/stderr、runtime receipt 和所有 hash。
- [ ] 用文件集和时间证据判定 pre/post-mutation，不凭运行秒数猜。
- [ ] 失败目录不删除、不覆盖；replacement 使用新 identity。
- [ ] dependency 修复不自动取消或重投，先取得具体 JobID 授权。
- [ ] 根据下一有意义事件长 sleep，不忙轮询。
- [ ] 前台长 operator 核实 exact PID/starttime 与原 wait/session；空 wrapper output 或 duplicate `FATAL` 未被误判为原进程失败。

## 12. 决策底线

- GPU 型号/分区是提交层的动态选择，不进入可移植 `.slurm` 或训练代码。
- 不指定具体节点、物理 GPU、UUID、PCI/index、固定 local device 或手工 GPU map。
- 记录设备信息是为了复现和性能解释，不是为了要求再次命中同一设备。
- CUDA/ROCm、显存、精度和 custom kernel 是真实能力边界，必须诚实验证。
- pending 作业默认保持不动；取消/修改/重投必须由用户针对具体 JobID 明确授权。
- recovery 是否有效由 source、runtime、checkpoint、依赖和 pre/post-mutation 证据决定，不由物理 GPU 身份决定。
