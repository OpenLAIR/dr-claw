---
name: ncsa-delta
description: 连接并使用 NCSA Delta（不是 DeltaAI），包括 ChatGPT 手机到 Mac Remote Control、Mac SSH ControlMaster、NCSA Kerberos + Duo、远端 Codex 安装/设备登录/Connected 验证，以及 Slurm CPU/GPU 作业的规划、验证、提交、排队保护、监控和诊断；覆盖 accounts/SU、队列和 walltime、GPU 可移植脚本、A40/A100/H200/MI100、存储、环境、checkpoint 和故障排查。用户提到 NCSA Delta、Delta SSH/Codex、Remote Control、sbatch/srun/salloc、配额、SU、排队或 Delta 文件系统时使用；不要套用于 DeltaAI 或其他集群。
---

# NCSA Delta 操作技能

本 `SKILL.md` 所在目录称为 `SKILL_ROOT`。静态资料最后核实于 **2026-08-09**。Delta 的 Slurm 配置、分区、配额、软件模块和政策可能变化；在能够登录 Delta 时，**实时只读查询优先于本技能中的静态表格**。

## 目标

把用户的研究任务转换成：

1. 可复现、资源不过量的运行方案；
2. 合理而不冒险的 walltime；
3. 符合 Delta 当前队列、账户余额和存储政策的 Slurm 脚本；
4. 提交前的成本、排队和失败风险说明；
5. 提交后的监控、复盘和下一轮优化建议。

不要只给一条 `sbatch` 命令。除非用户明确只要某一小项，否则要同时考虑账户、GPU、CPU、内存、walltime、存储、环境、日志、checkpoint、计费和排队。

## 不可违反的规则

- **先确认是 Delta，而不是 DeltaAI。** 检查 `hostname -f`、`uname -m`、`scontrol show config | grep -i ClusterName`。Delta 是本技能针对的 x86_64 系统；不要把 DeltaAI 的 ARM/Grace Hopper 做法混进来。
- **不在登录节点做生产计算。** 登录节点用于编辑、编译、数据管理和提交；没有 GPU。GPU 调试也必须申请计算节点。
- **不虚构账户名、项目代码、配额、模块版本或当前队列状态。** 用 `accounts`、`quota`、`sinfo`、`scontrol`、`module spider` 查实。
- **没有用户明确要求时，不执行有副作用的动作。** `accounts`、`quota`、`sinfo`、`squeue`、`sacct`、`scontrol show`、`sbatch --test-only` 是只读/无提交检查；`sbatch`、`scancel`、`scontrol update/hold/release/requeue`、删除文件、`rsync --delete` 是写操作。
- **不得随便中断、修改或重复提交正在排队的作业。** `PENDING` 本身不是故障。默认只读诊断并继续等待；不得为了“也许更快”而 `scancel`、hold/release、requeue、改资源/分区/依赖或另投副本。取消后原 JobID 和已积累的 queue age/位置不能带到新作业；重新 `sbatch` 会获得新 JobID 并重新排队。只有用户针对核实后的具体 JobID 明确授权，且已经获知这一后果，才允许执行队列 mutation。
- **Slurm 脚本和训练代码不得绑定 GPU 型号、物理卡、节点或固定设备编号。** GPU 脚本只表达数量和真实资源下限；不写死 GPU 型号分区、typed GRES、`--nodelist`、GPU UUID、`CUDA_VISIBLE_DEVICES`、固定 `cuda:N` 或手工 GPU map。分区在 `sbatch --partition=...` 提交层按实时账户/队列选择，应用只使用 Slurm 分配的可见设备和 local rank。设备名称/UUID可以作为只读 receipt 记录，但不得作为命中某张卡才能运行的门禁。
- **绝不默认 `--exclusive` 或 `--mem=0`。** Delta 默认共享节点；独占会按整节点资源收费。
- **不把大型数据、Conda 环境、容器缓存或训练输出放进 `$HOME`。** `$HOME` 只放小型配置、脚本和源码。
- **不把 `/tmp` 当持久盘。** 节点本地 `/tmp` 在作业结束后清除，且多节点之间不共享。
- **不把 walltime 猜得比可靠上界更短。** `--time` 是硬上限；到时 Slurm 会终止任务。短 walltime 的价值主要是更容易 backfill，不代表基础优先级必然提高。
- **不把请求 walltime 当作实际账单。** 实际收费通常基于保留资源与实际运行时长；但余额准入和 `QOSGrpBillingMinutes` 会按“请求资源 × 请求 walltime”判断能否运行。最终以 `jobcharge` 为准。
- **不在脚本、日志或共享目录写密码、MFA、私钥、访问令牌。** Delta 常规 SSH 使用 NCSA 密码和 Duo MFA。
- **严格区分三套认证。** NCSA Kerberos 密码、NCSA Duo 和 OpenAI 账号/MFA 互不替代；不要把 ACCESS 门户密码问题误判成 Duo 或 OpenAI 问题，也不要记录或转发 PIN、Duo passcode、设备登录码。
- **不把界面上的 `Connected` 当成永久保证。** 远端控制要求 Mac 在线、清醒、ChatGPT app 保持登录，SSH master 与远端 Codex 也要健康；用实时只读探针做端到端验证。
- **不把 allocation-local GPU index 当成物理设备身份，也不反向追求物理卡身份。** `CUDA_VISIBLE_DEVICES=0` 或 `torch.cuda.current_device()==0` 只表示当前 allocation 的本地第 0 张可见设备；代码应尊重这个映射，而不是把它改写为节点物理编号。
- **GPU ordinal 必须按 namespace 分栏。** `scontrol GRES/IDX`、`SLURM_JOB_GPUS`、`SLURM_STEP_GPUS` 属于 scheduler/node-global 域；CVD 与 allocation 内 `nvidia-smi` 属于 allocation-visible inventory 域；Torch/local rank 属于 framework-local 域。只在同一域内做 cardinality/consistency，严禁 scheduler-vs-visible/Torch ordinal equality。即使三处都显示 `0`，也不能据此宣称它们是同一编号。
- **Python lexical launcher 与 resolved target 必须分开核验。** current lexical 只和 expected/prior lexical 比，current resolved 只和 expected/prior resolved 比；合法的 `bin/python -> bin/python3.11` symlink 不得因两种路径字符串不同而被拒绝。
- **数值 runtime identity 与 Lmod 加载路由必须分层。** login 和 compute 可能因 module 可见性/缓存差异分别命中 `fallback` 与 `wrapper`。`load_method`、`wrapper_rc`、`module_list` 必须原样记录，但只是观测字段，不得进入 login–compute 科学/数值 parity。parity 仍必须 fail-close 核对 Python 版本、lexical/resolved executable、prefix、Torch 版本、CUDA build 与 Torch origin；任一核心字段不同都必须停止。
- **Torch usable memory 不得与 board total 做 exact equality。** 正确能力门禁是 `declared minimum <= Torch usable bytes <= nvidia-smi/ROCm board total bytes`，允许 driver/ECC/固件保留造成的合理差值；型号、UUID、PCI 只作同一 allocation 观察性 join，不作跨 job pinning。
- **前台长 operator 必须 single-writer。** 工具 wrapper 空输出或第二次调用的 duplicate `FATAL` 不等于原进程失败；恢复/取消前核实 exact PID、`/proc` starttime、cmdline/script SHA 和 scope，继续等待原 owner 的真实 exit。aggregate `COMPLETE` 只能在原 child zero exit 与所有 receipt/hash 通过后 write-once 创建，禁止并发重复 invoke 或覆盖旧 scope。
- **不把 `afterany` 当成资源释放或依赖重绑保证。** 失败 predecessor 上的 `afterok` downstream 会变成 `DependencyNeverSatisfied`；先保留旧证据并向用户说明。任何取消、replacement 或依赖重绑仍属于队列 mutation，必须获得针对具体 JobID 的明确授权。
- **每次重试都使用新的 immutable attempt identity。** 已提交的 source root、receipt 和 run root 不得原地改写；修复后建新 attempt，记录 parent JobID、旧产物 SHA256、失败原因和仅有的改动。这是区分工程恢复与科学重跑的底线。
- **formal source 一旦 seal 就绝不作为测试工作目录。** compile、unittest、F3、validator 的临时文件、pycache、mock config 和日志全部写入 attempt 专属外部目录；测试前后复核 whole-source manifest。ordinary receipt 必须保留完整日志和精确 failure/error test IDs。任何 prelaunch 失败都保留旧 identity，以新的唯一 attempt 修复，不在旧 root 原地补包、改 fixture 或覆盖 receipt。
- **sealed parent + signed overlay 必须做逐路径 mode projection。** base-only row 完整继承 sealed parent，overlay row 完整采用签名的 path/type/size/SHA256/mode；本地 writable full tree 只能做忽略 mode 的 content 等价比较，不得作 deployment-mode authority。Stage1 必须用真正只读父 mode 构造 disposable merge，publish 后从 final 重新扫描 projected rows digest。partial/incoming 一旦产生就保留；修复换新完整 execution identity，不得只换 recovery-id。
- **generated artifacts 必须使用阶段化 inventory。** pre-materialization source inventory 必须拒绝 canonical generated config；post-materialization 必须显式要求恰好一个 canonical config，并验证所有 non-generated projected rows 未变以及 config 的 exact path/type/size/SHA256/mode/schema。通用 inventory 的 excluded-artifact 默认或“忽略 config”清单不得直接充当 post-materialization authority。seal 后必须对含 config 的全树验证 exact sealed mode、保存 whole manifest，并从实际 root replay。Stage1 必须真实走 unique disposable materialize → post-inventory → seal → replay；任何 prelaunch partial 后修复都换新完整 execution identity。
- **不把 `sbatch --test-only` 输出中的 JobID 当成实际作业。** 它只是规划/估算结果；后续真正 `sbatch --parsable` 会返回另一个 actual JobID。排队监控、依赖、日志、`sacct` 和归档只能使用 actual JobID。
- **跨系统归档必须验证精确 file set。** macOS 发送 tar 时同时使用 `COPYFILE_DISABLE=1` 和 `tar --no-xattrs`；目标端不仅校验预期文件 checksum，还要拒绝任何额外文件，尤其是 AppleDouble `._*`。验证失败时只保留/隔离 incoming，不生成、覆盖或更新 final。

## 每次任务的标准流程

### 0. 建立或恢复 Remote Control 与 SSH 连接

当用户尚未连接、刚切换 ChatGPT 账号、出现 `Failed to authorize remote control`、SSH/Duo 失败、远端 Codex 未登录，或只说界面显示 `Connected` 时，先读取 `references/01-access-and-quickstart.md`，按其中的分层流程处理：

1. 手机与 Mac 使用同一个 ChatGPT 账号和 workspace，完成 OpenAI 侧授权；
2. 用一个**具体、无通配符**的 SSH alias 连接某个 Delta 登录节点，并完成 NCSA Kerberos + Duo；
3. 在 Delta 上安装并用同一 ChatGPT 账号登录 Codex，确保登录 shell 能找到 `codex`；
4. 在 ChatGPT Desktop 的 SSH 连接中选择该 alias 和已验证的远端目录；
5. 分别验证 Mac 远控、SSH control socket、远端身份、远端 Codex 和 app-server 状态。

连接和登录步骤本身允许在用户明确要求“连接/安装”时执行；但不得替用户输入、保存或回显密码、Duo 码、OpenAI MFA、PIN 或设备登录码。`ControlPersist 7d` 只是 SSH master 的最长空闲复用期，不是 NCSA 会保证七天会话不断线。Mac 重启、睡眠、网络变化、登录节点维护或服务端清理都可能要求重新输入 Kerberos 密码并完成 Duo。

### 1. 建立实时事实快照

首次使用、静态资料超过 30 天、用户说“最新”，或任何配置看起来不一致时，在 Delta 登录节点运行：

```bash
bash "<SKILL_ROOT>/scripts/delta-doctor.sh" --output "$PWD/delta-doctor-$(date +%Y%m%d-%H%M%S).txt"
```

至少读取：

```bash
accounts
quota
sinfo -a
sinfo -o '%P|%a|%l|%D|%t|%G|%m|%c|%f'
scontrol show partition
squeue -u "$USER"
printf 'WORK=%s\nSCRATCH=%s\n' "${WORK-}" "${SCRATCH-}"
[[ -n "${WORK-}" ]] && readlink -f "$WORK" 2>/dev/null || true
[[ -n "${SCRATCH-}" ]] && readlink -f "$SCRATCH" 2>/dev/null || true
```

若用户说有“500G 和 1.5TB 两块盘”，**先辨认路径，不能凭容量命名**：

- `/projects/<project>` 常见默认配额是 500 GB，持久共享、无快照；
- `/work/hdd/<project>` 默认通常是 1 TB，但项目可申请到 1.5 TB 或更大，持久共享、无快照；
- GPU 计算节点 `/tmp` 常见约 1.5 TB（H200 节点约 2 TB），只在作业期间存在、每节点独立、作业后清除。

只有 `quota`、`df -hT <path>` 和计算节点内的 `df -hT /tmp` 才能确定用户所说的 1.5 TB 是哪一种。

### 2. 询问或从代码中推断工作负载

尽量从仓库、配置和已有日志中获取，不重复问用户已经给过的信息。需要明确：

- 单进程、MPI、PyTorch DDP、任务数组还是流水线；
- 需要几张 GPU、每卡显存峰值、是否需要 GPU 间高速互联；
- CPU 数据加载线程和主机内存峰值；
- 输入数据总量、文件数量、读写模式；
- 单次预计时长、历史 `Elapsed`、是否可 checkpoint/restart；
- CUDA 还是 ROCm，是否依赖特定计算能力；
- 结果是否重要到必须实时复制回共享盘。

缺少历史数据时先做小规模基准，不要直接申请最大节点或 48 小时。

### 3. 选择账户、提交分区和可移植 GPU 资源

账户由 `accounts` 的 `Project` 列决定。一般 CPU 账户以 `-cpu` 结尾，GPU 账户以 `-gpu` 结尾。GPU 作业不得用 CPU 账户，反之亦然，除非现场配置明确允许。

若 `accounts` 只列出 GPU 账户，不得用它提交 CPU-only 作业；用代表性 `sbatch --test-only` 验证账户/分区组合。`sinfo -a` 可能显示当前账户无权使用的限制分区（例如某些 `*-long`）；看得到不等于能提交，也必须通过 `sbatch --test-only` 核实。

静态分区速查如下；提交前仍需用 `sinfo`/`scontrol show partition` 验证：

| 分区 | 最大时长 | 费率因子 | 最低资源条件下约 SU/GPU·h | 主要用途 |
|---|---:|---:|---:|---|
| `gpuA40x4` | 48h | 0.5 | 0.5 | 最便宜的 NVIDIA CUDA；单卡 48 GB，PCIe，无 A100 式 NVLink |
| `gpuA40x4-interactive` | 1h | 1.0 | 1.0 | A40 调试/Jupyter |
| `gpuA40x4-preempt` | 48h | 0.25 | 0.25 | 可 checkpoint 的低价任务 |
| `gpuA100x4` | 48h | 1.0 | 1.0 | 默认通用训练/HPC；单卡 40 GB，4 卡 NVLink |
| `gpuA100x4-interactive` | 1h | 2.0 | 2.0 | A100 调试 |
| `gpuA100x4-preempt` | 48h | 0.5 | 0.5 | 可 checkpoint 的 A100 任务 |
| `gpuA100x8` | 48h | 1.5 | 1.5 | 8 卡或 2 TB 主机内存需求；节点少，较稀缺 |
| `gpuA100x8-interactive` | 1h | 3.0 | 3.0 | 8 卡节点调试 |
| `gpuH200x8` | 48h | 3.0 | 3.0 | 单卡 141 GB 显存或 H200 明显提速的任务；每作业最多 1 节点 |
| `gpuH200x8-interactive` | 1h | 6.0 | 6.0 | H200 调试；昂贵 |
| `gpuMI100x8` | 48h | 0.25 | 0.25 | ROCm 兼容任务或便宜的 2 TB 主机内存节点；全系统只有 1 节点 |
| `gpuMI100x8-interactive` | 1h | 0.5 | 0.5 | MI100 调试 |
| `cpu` | 48h | 1.0 | 不适用 | 常规 CPU 作业 |
| `cpu-interactive` | 1h | 2.0 | 不适用 | CPU 调试 |
| `cpu-preempt` | 48h | 0.5 | 不适用 | 可 checkpoint 的 CPU 作业 |

GPU 选择原则：

- 能在 A40 上正确、高效运行且不需要 NVLink/高 FP64 时，先基准 A40；它通常每 GPU 小时最省 SU。
- 一般 CUDA 训练首选 `gpuA100x4`，不要因为 H200 新就直接用 H200。
- 只有显存超过 40/48 GB，或实测“吞吐量提升 ÷ 3 倍费率”仍划算时，才优先 H200。
- 只有真正需要 8 卡、2 TB 主机内存或整节点拓扑时才用 `gpuA100x8`。
- MI100 使用 ROCm，不是 CUDA。先做兼容性测试；分区名是 `x8`，不要假定物理第 9 张 MI210 能由普通作业申请。
- 用代表性 batch size 比较 **样本/秒、收敛到目标指标的总时间、SU/实验**，不要只比较单步速度。

详见 `references/03-hardware-and-gpu-selection.md`。

上表用于**提交时**比较成本、显存和兼容性，不允许反向写死到可移植脚本中：

- GPU `.slurm` 源文件不包含 `#SBATCH --partition=gpu...`；同一份脚本由提交命令传入实时核实的分区。
- 不指定 GPU 型号 constraint、typed GRES、节点名、UUID 或物理/local index；只请求 `--gpus-per-node=N`/`--gpus-per-task=N` 等通用数量。
- 训练代码不设置 `CUDA_VISIBLE_DEVICES`，单进程使用框架默认 accelerator，多进程按 `LOCAL_RANK`/`SLURM_LOCALID` 使用 Slurm 可见集合。
- “任何 GPU 可跑”指任何满足已声明的显存、GPU 数、数值能力和软件后端要求的 allocation。CUDA-only 扩展不能伪装成可在 ROCm 上运行；NVIDIA/AMD 可使用不同的冻结 environment loader，但业务脚本和数据流保持同一份。
- GPU 型号、UUID、driver、runtime 只记录为观察性 receipt，用于解释性能和复现环境；不得作为目标设备筛选或 fail-close 条件。

跨设备运行、恢复链和环境 receipt 见 `references/11-gpu-portability-and-recovery.md`。

### 4. 估算 SU 成本和余额占用

本技能附带的 Python 工具要求 Python 3.9+，只使用标准库。先运行 `python3 --version`；版本过旧时用 `module spider python` 选择当前可用版本，不硬编码静态模块版本。

**这个 Python 3.9+ 边界只适用于 skill 自身的 stdlib 工具。** Delta 登录节点裸 `python3` 实测为 `3.9.18`；项目代码可能使用 `dataclass(slots=True)` 等 Python 3.10+ 语义。任何会 import/执行项目代码的 semantic preflight、source validator 或配置解析都必须通过已冻结的项目 loader/runtime receipt 进入与正式作业相同的 Python `3.11.13`；不能只让正式 `srun` 走 loader，却让提交前项目预检使用裸 `python3`。

先用脚本给出近似值：

```bash
python3 "<SKILL_ROOT>/scripts/delta-cost.py" \
  --partition gpuA100x4 \
  --nodes 1 --gpus-per-node 1 --cpus-per-node 16 --mem 58G \
  --walltime 00:30:00 --elapsed 00:20:00
```

近似计费公式：

- CPU 节点：`base_SU/h = max(CPU核数, 主机内存GB / 2)`；
- GPU 节点每节点：
  `base_SU/h = max(GPU数, CPU核数/每GPU等价核数, 主机内存GB/每GPU等价内存)`；
- 总费用：`base_SU/h × 节点数 × 实际运行小时 × 分区费率因子`。

等价资源：A40x4/A100x4 每 GPU 对应 16 核或 62.5 GB；A100x8/MI100x8 每 GPU 对应 16 核或 250 GB；H200x8 每 GPU 对应 12 核或 250 GB。内存或 CPU 请求过大，即使只申请 1 GPU，也可能按多 GPU 单位收费。

**单位必须精确换算：**NCSA 的计费 GB 是十进制 `1e9 bytes`；Slurm `--mem` 的裸数字默认是 MiB，`G` 表示 GiB。于是 `--mem=60G` 约为 64.42 个十进制 GB，会略高于 A40x4/A100x4 的 62.5 GB/卡边界；`--mem=58G` 约为 62.28 个十进制 GB。模板中的 58G、232G、29G 是“靠近但不越过计费边界”的可审计起点，不是性能保证；必须按 `MaxRSS`、OOM 风险和输入峰值留足安全余量。成本脚本的 `--mem` 会精确换算 Slurm 单位；只有手头已经是十进制字节统计时才用 `--mem-gb-per-node`。

同时显示两组数：

- **预期实际费用**：按预计 `Elapsed`；
- **余额准入上界**：按请求 walltime。它解释为什么仍有余额却出现 `QOSGrpBillingMinutes`。

提交后用以下命令核实实际账单：

```bash
jobcharge -h
jobcharge -a <ACCOUNT> -d 10
jobcharge -a <ACCOUNT> -d 10 --detail
```

Delta 当前 `jobcharge` 对小于一天的某些起止窗口可能以 `range() arg 3 must not be zero` 失败。不要因此推断作业没有计费；使用覆盖 **>24 小时**的窗口（例如 `-d 2`），保留完整原始输出，然后另外按 JobID 过滤。原始输出和 JobID 过滤结果都是归档证据。

不要把 SU 换算成统一美元价格；Delta 的用户通常消费 allocation 中的 SU，美元价值取决于 allocation/采购安排，不存在本技能可以可靠给出的统一现金单价。

### 5. 制定 walltime，而不是拍脑袋

关键事实：

- `--time` 是作业 allocation 的硬运行上限；达到上限后任务会收到 SIGTERM，随后 SIGKILL。
- 时间分辨率是一分钟，秒会向上取整。
- Delta 未写 `--time` 时默认约 30 分钟，但生产脚本必须显式写。
- 更短、准确的时间通常更容易塞进 backfill 空档；它不是“时间越短，基础 priority 数值就自动越高”。
- 估计过短的代价是 `TIMEOUT`、丢失未保存进度和重新排队；估计偏长通常不按完整请求时长收费，但会占用更大的余额准入额度，也可能降低 backfill 机会。

针对“预计 15 分钟”的标准建议：

- 首次、无 checkpoint、失败代价高：请求 25–30 分钟；
- 已跑过少量样本但分布仍不稳定：请求 20–25 分钟；
- 至少 5–10 次同型成功运行后：用 P95，再加 `max(5 分钟, 15%–20%)`；
- 若 P95 已接近 20 分钟，就绝不能为了排队写 15 分钟。

用历史记录计算：

```bash
python3 "<SKILL_ROOT>/scripts/delta-time-advisor.py" \
  --job-name my-training-job --days 30 --partition gpuA100x4
```

长任务必须考虑：

```bash
#SBATCH --signal=USR1@300
#SBATCH --requeue
```

应用需在收到信号后保存原子 checkpoint，并能从头执行 batch 脚本时自动发现最新 checkpoint。`--requeue` 不等于应用天然可恢复。默认不加 `B:` 时，Slurm 把提前信号发给 job steps，适合应用进程直接处理；`B:` 只发 batch shell，只有 shell 使用后台 `srun`/可中断 `wait`、再把信号显式转发给 steps 的架构才使用。

高级可选项 `--time-min=<minimum>` 允许 backfill 调度器把分配到的 time limit 降到该下限以更早启动；只有程序能读取实际 `SLURM_JOB_END_TIME`、安全缩短工作量或 checkpoint 时才用。

详见 `references/04-walltime-queue-and-priority.md`。

### 6. 设计存储布局

默认布局：

```text
$HOME (/u/$USER, 100 GB 常见)
  .ssh/ .config/ 小脚本 小源码 Slurm模板

/projects/<PROJECT>/<USER> (个人默认根；项目配额 500 GB 常见，可申请扩容)
  code/                   受版本控制的代码
  env-locks/              environment.yml、requirements lock、容器定义
  containers/             稳定 .sif 镜像
  datasets/source/        不变的权威输入数据
  checkpoints/best/       最重要、需要长期保留的 checkpoint
  results/final/          最终结果、论文表格、可复现实验元数据

/work/hdd/<PROJECT>/<USER> (个人默认根；项目默认约 1 TB，可为 1.5 TB 或更大)
  datasets/processed/     可重建的预处理数据
  runs/                   活跃实验目录
  checkpoints/latest/     高频 checkpoint
  caches/                 HF、Torch、pip、Conda、Apptainer 缓存
  logs/                   批量日志
  tmp/                    可删除中间文件

/work/nvme/<PROJECT>/<USER> (若 quota 列出；个人高 IOPS 根)
  hot-cache/              高频随机访问 cache
  small-file-shards/      大量小文件或 metadata 密集数据
  io-intensive-tmp/       可重建的高 IOPS 中间数据

/tmp/$USER/$SLURM_JOB_ID (节点本地，GPU 多为约 1.5 TB，H200 约 2 TB)
  input/ cache/ output/   作业期间的高速小文件 I/O；结束前必须复制回共享盘
```

原则：

- `/projects` 放“权威、共享、应保留”的内容；`/work/hdd` 放“活跃、较大、可重建”的内容；已分配的 `/work/nvme` 放高 IOPS/小文件工作集；`/tmp` 放“本次作业临时加速”的内容。
- 若现场已提供 `/projects/<PROJECT>/$USER`、`/work/hdd/<PROJECT>/$USER`、`/work/nvme/<PROJECT>/$USER`，默认在这些个人根目录工作；只有明确的团队共享数据才放项目根下专门的 `shared/` 子目录。先用 `test -r/-w/-x` 核实权限，不凭路径猜测。
- `/projects` 和 `/work` 没有可依赖的备份/快照。关键结果必须通过 Globus 复制到集群外。
- `$HOME` 快照保留天数在 NCSA 不同页面出现 14/30 天冲突；快照也不是备份。运行 `ls ~/.snapshot/` 看当前可用快照，绝不依赖一个固定保留数字。
- 留至少约 10%–20% 空间，并同时看 inode/file count。百万小文件应考虑 tar、SquashFS、WebDataset、LMDB、HDF5/Zarr shard 等适合应用的打包方式。
- 大数据传输用 Globus；`scp`/`rsync` 只用于小到中等规模。禁止无确认使用 `rsync --delete`。
- Mac 从 Delta 接收目录时，可能因 macOS `fchmodat`/ACL 处理失败，即使 `rsync --no-perms` 也不一定能避免。Delta 到 server94 这类跨远端归档优先使用 **tar stream** 直送目标机的唯一 incoming 目录；目标端必须做 checksum + exact file-set 双重验证后才原子 rename 为最终名，在此之前不清理源副本。macOS 作为 tar 发送端时必须使用 `COPYFILE_DISABLE=1 tar --no-xattrs ...`；仅 `--no-xattrs` 仍可能让 Linux 目标出现 AppleDouble `._*`。
- 使用 `/projects` 或 `/work/hdd` 的作业应在实时 `sinfo` 确认 feature 后添加对应 filesystem constraint。当前文档表中 `/projects -> projects`，`/work/hdd -> work`；不要照搬文档里可能过时的 `scratch` 示例。

若 Mac 端用 zsh 编排传输/校验，循环变量不要命名为 `path`。zsh 的 `path` 是与 `PATH` 绑定的特殊数组；覆盖它会让后续命令集体变成 `command not found`。使用 `artifact_path`、`source_path` 等普通名称。

详见 `references/05-storage-and-data.md` 和模板 `assets/templates/stage-local-tmp.slurm`。

### 7. 构造最小但完整的 Slurm 脚本

从最接近的模板复制，不要从空白随意拼接：

- 单 GPU：`assets/templates/gpu-single.slurm`
- 单节点多 GPU：`assets/templates/gpu-multigpu.slurm`
- 多节点 PyTorch：`assets/templates/gpu-multinode-torchrun.slurm`
- CPU/OpenMP：`assets/templates/cpu.slurm`
- CPU MPI：`assets/templates/mpi-cpu.slurm`
- 作业数组：`assets/templates/job-array.slurm`
- Apptainer GPU：`assets/templates/gpu-apptainer.slurm`
- 抢占/恢复：`assets/templates/preempt-checkpoint.slurm`
- 本地盘 staging：`assets/templates/stage-local-tmp.slurm`
- 交互命令：`assets/templates/interactive-commands.md`

每个生产脚本至少显式包含：

```text
--job-name
--account
--nodes
--ntasks 或 --ntasks-per-node
--cpus-per-task
--mem 或 --mem-per-cpu
--time
GPU 作业的 --gpus-per-node/--gpus-per-task
--output/--error（目录须在提交前存在）
必要时 --constraint
```

GPU 脚本有一个有意的例外：**不在源文件写 `--partition`**。提交时必须在同一次 preflight/actual 命令中显式提供并保存分区，例如：

```bash
delta_partition='<LIVE_VERIFIED_GPU_PARTITION>'
sbatch --test-only --partition="$delta_partition" job.slurm
sbatch --parsable --partition="$delta_partition" job.slurm
```

这让 GPU 型号选择属于可审计的提交 receipt，而不是把 A40/A100/H200/MI100 固化进脚本。GPU 脚本还不得包含 typed GRES、GPU 型号 constraint、`--nodelist`、GPU UUID、`CUDA_VISIBLE_DEVICES=...`、固定 `cuda:N` 或手工 `--gpu-bind`/map。

脚本正文至少：

- `set -Eeuo pipefail`；
- 打印时间、主机、作业 ID、节点列表、Git commit、模块/容器/解释器版本；
- 设置 `OMP_NUM_THREADS` 等与资源一致的线程变量；
- 用 `srun` 启动作业步骤；
- 定期 checkpoint；
- 使用 `/tmp` 时有 staging 和 copy-back；
- 不在批脚本里执行未经保护的删除或覆盖。

命令行传给 `sbatch` 的选项会覆盖脚本中的 `#SBATCH`。最终审计必须同时查看脚本和实际提交命令。

### 8. 环境与容器

优先可复现方案：

1. 现成 NCSA module；
2. 固定版本的 Apptainer `.sif`；
3. 项目/工作盘中的明确前缀 Conda 环境；
4. 最后才是作业启动时动态 `pip install`。

现场检查：

```bash
module reset
module spider <package>
module list
command -v apptainer && apptainer --version
ls -1 /sw/external/NGC 2>/dev/null | head
```

约定：

- 大 Conda 环境不放 `$HOME`；使用 `conda create --prefix /projects/...` 或 `/work/hdd/...`。
- 将 `PIP_CACHE_DIR`、`CONDA_PKGS_DIRS`、`HF_HOME`、`TORCH_HOME`、`XDG_CACHE_HOME`、`APPTAINER_CACHEDIR` 指向 `/work/hdd/<project>/$USER/caches/...`。
- NVIDIA 容器用 `apptainer exec/run --nv`；AMD ROCm 容器在现场确认版本后使用 `--rocm`。
- `.sif` 和 lockfile 放 `/projects`；可重建 cache 放 `/work/hdd`。
- 不硬编码“当前最新模块版本”；用 `module spider` 查并把选定版本记录进日志。

NCSA 文档对自建 Conda 批作业建议从已激活环境提交并让作业继承环境。无论采用继承、`conda run -p` 还是显式初始化，都必须在作业日志打印 `which python`、`python -VV` 和环境前缀，避免交互 shell 与 batch 环境不一致。

对生产恢复作业还必须记录 module、精确 interpreter/prefix、项目 package import origin、Torch CUDA/HIP build、driver，以及 allocation 实际提供的 GPU 型号/数量；设备 UUID仅作观察性 receipt，不作 pinning。登录节点 import 成功不能替代 compute runtime receipt。完整门禁见 `references/11-gpu-portability-and-recovery.md`。

#### 已验证的 PyTorch 2.8/cu128 Lmod 故障与 fallback（2026-08-11）

这是 **NVIDIA CUDA 12.8 提交的专用 environment loader**，不是 GPU 通用模板的默认环境，也不得用于 MI100/ROCm。只有提交层已经选择兼容的 NVIDIA 分区并保存 receipt 时才使用；业务 `.slurm` 仍不绑定 GPU 型号。

`module spider pytorch-conda/2.8` 可能显示 wrapper 可直接加载，但它的 modulefile 依赖 hidden module `python/.conda-env/pytorch/2.8-cu128`；Lmod 不能在当前 MODULEPATH 中解析该依赖。把 `--ignore_cache` 只加在 wrapper 上仍可能失败。已验证 fallback 是：

```bash
module reset
module use /sw/rh9.4/user/modules/python/.conda-env
module --ignore_cache load cudatoolkit/25.3_12.8
module --ignore_cache load pytorch/2.8-cu128
```

但“这四行返回 0”仍不等于运行时通过。对该环境必须使用随技能附带的两个脚本，并在提交前把它们连同 SHA256 复制到本 attempt 的 immutable source snapshot，作业不得直接依赖会继续更新的 `~/.agents/skills` 副本：

```bash
# 登录节点：真正 load + import + origin probe，不只做 spider/lint/test-only
bash <FROZEN_SOURCE>/delta-load-pytorch-2.8-cu128.sh \
  --phase login \
  --receipt <FROZEN_PREFLIGHT>/PYTORCH_LOGIN_RUNTIME.json

# 计算节点：在同一 srun 中复核 receipt，再 exec 主程序
srun bash <FROZEN_SOURCE>/delta-load-pytorch-2.8-cu128.sh \
  --phase compute \
  --receipt <RUN_ROOT>/PYTORCH_COMPUTE_RUNTIME.json \
  --login-receipt <FROZEN_PREFLIGHT>/PYTORCH_LOGIN_RUNTIME.json \
  -- python -u train.py ...
```

任何会执行项目 Python 语义的提交前预检也必须走同一个 frozen loader：

```bash
bash <FROZEN_SOURCE>/delta-load-pytorch-2.8-cu128.sh \
  --phase login \
  --receipt <FROZEN_PREFLIGHT>/PROJECT_SEMANTIC_PREFLIGHT_RUNTIME.json \
  -- python -m <PROJECT_PREFLIGHT_MODULE> ...
```

不得先用登录节点裸 `python3` 执行项目 preflight，再只在正式 `srun` 里换成 loader。那会让 Python 3.9 预检与 Python 3.11.13 生产 runtime 拥有不同语义，并可能在 `dataclass(slots=True)` 等导入阶段就失败。Skill 自身的 `delta-cost.py`、`delta-lint.py`、`delta-time-advisor.py`、`delta-fileset-manifest.py`、`delta-gpu-runtime-contract.py`、`delta-mode-projection.py` 和 `delta-phase-inventory.py` 是另一条边界：它们刻意只用 stdlib 且支持 Python 3.9，可用裸 `python3`。

生产 loader 之外还要冻结项目依赖闭包、`PYTHONPATH` 和 import origin。venv 的 interpreter 可能合法地以 symlink 指向冻结 base Python；不得只因词法路径与 `readlink -f` 不同而拒绝。可选转换依赖、immutable hashed overlay、macOS mode normalization、sealed-source 测试、完整 ordinary receipt、F3 fixture 同步和 prelaunch identity 规则见 `references/12-formal-deployment-preflight-and-runtime-closure.md`。

allocation runtime 还必须把 scheduler、allocation-visible inventory 和 framework-local 三个 ordinal namespace 分开。可冻结 `scripts/delta-gpu-runtime-contract.py`，用 `IDX3 -> visible0` 与 `IDX0 -> visible0` 两个正例及 count/UUID/Torch/multi-visible/min-memory 负例验证门禁。Python lexical/resolved、Torch usable-vs-board memory 和前台 single-writer operator 的完整合同见 `references/13-runtime-gpu-namespaces-and-single-writer-operators.md`。

source 恢复若从 sealed parent 加 signed overlay 物化，还必须冻结 `scripts/delta-mode-projection.py`，分别生成 parent/overlay/local-content manifests，并对 Stage1 disposable merge、prepublish incoming 与 postpublish final 重新扫描。忽略 mode 的 path/type/size/SHA256 只证明科学/source-content 等价；完整 projected rows 才是 deployment-mode authority。若物化过程中生成 canonical JSON config，还必须同时冻结 `scripts/delta-phase-inventory.py`：pre 阶段拒绝 config，post-materialization 精确验证唯一 config 与未变的 non-generated projected rows，post-seal 对含 config 全树生成并 replay manifest。流程、digest 和必须回归见 `references/14-sealed-parent-overlay-mode-projection.md`。

两阶段都必须精确验证：Python `3.11.13`、Torch `2.8.0+cu128`、Torch CUDA build `12.8`、Python lexical/resolved executable、prefix 和 `torch.__file__` 均来自 `/sw/rh9.4/user/python/conda-env/pytorch-2.8-cu128`；compute receipt 还必须证明 CUDA 可用，与 login receipt 的这些核心字段一致。login 使用 fallback、compute 使用 wrapper（或反过来）不应单独造成 exit 3；`load_method`、`wrapper_rc`、`module_list` 仍写入 receipt，并在 `observations_differing_from_login` 中显示路由差异，但不参与 `passed`。

这个 fallback 只在上述数值 runtime 完全匹配时，才可以被视为“同一预定环境的加载路由修复”。receipt 不匹配时必须停止，不得把 retry 当成 matched scientific result。即使 receipt 匹配，它也不证明 bitwise determinism；论文级结论仍需代码、数据、随机性和数值结果的独立验证。

### 9. 提交前检查

先静态检查。GPU 脚本把已实时核实的分区作为 linter 的提交上下文，而不是写进源文件：

```bash
delta_partition='<LIVE_VERIFIED_GPU_PARTITION>'
python3 "<SKILL_ROOT>/scripts/delta-lint.py" \
  --submission-partition "$delta_partition" path/to/job.slurm
```

然后在 Delta 上做无提交验证：

```bash
sbatch --test-only --partition="$delta_partition" path/to/job.slurm
```

`--test-only` 若当前 Slurm 支持，会验证脚本并给出当前队列下的预计调度时间，不会真正提交。它的时间只是估计。

`--test-only` 输出中可能出现一个 **planning JobID**，但它不是可监控的作业。后续真正 `sbatch --parsable` 会分配不同的 **actual JobID**。两份证据必须分开保存：

```bash
# 只保存为预检原文；不从中提取监控 ID。
sbatch --test-only --partition="$delta_partition" path/to/job.slurm \
  > <PREFLIGHT>/SBATCH_TEST_ONLY.txt 2>&1

# 仅在用户已明确授权提交后执行。
actual_submission=$(sbatch --parsable --partition="$delta_partition" path/to/job.slurm)
printf '%s\n' "$actual_submission" > <PREFLIGHT>/SBATCH_ACTUAL_PARSABLE.txt
actual_job_id=${actual_submission%%;*}
[[ "$actual_job_id" =~ ^[0-9]+$ ]] || {
  printf 'invalid actual sbatch id: %s\n' "$actual_submission" >&2
  exit 2
}
printf '%s\n' "$actual_job_id" > <PREFLIGHT>/ACTUAL_JOB_ID.txt
```

之后的 `squeue`、`scontrol`、`sacct`、dependency、stdout/stderr 定位、jobcharge 和归档全部从 `ACTUAL_JOB_ID.txt` 取值。不得监控或归档 `SBATCH_TEST_ONLY.txt` 中的 planning JobID。

`module spider`、`delta-lint.py` 和 `sbatch --test-only` **都不会执行作业正文的 module load/import**，因此不能代替登录节点实际环境探针。对有明确 Python/Torch/CUDA 合同的作业，顺序必须是：

1. 冻结 source snapshot 与环境探针的 SHA256；
2. 在登录节点完整 module load + import + version/origin probe；
3. `delta-lint.py`；
4. `sbatch --test-only`；
5. 再次确认 source manifest 未漂移；
6. 获得授权后才 `sbatch`；
7. 作业内用 compute receipt 确认数值 runtime。

提交前向用户明确汇报：

- 使用的账户和当前余额；
- 提交层选择的分区、GPU/CPU/内存、节点数；
- 选择该 GPU 而非其他 GPU 的理由；
- 脚本未绑定 GPU 型号/节点/UUID/设备编号，以及当前 runtime 的 CUDA/ROCm 兼容边界；
- 请求 walltime、历史 P95/安全余量；
- 预计实际 SU 和按 walltime 的余额准入上界；
- 输入/输出/临时盘路径；
- checkpoint 和失败恢复方式；
- 任何仍未验证的假设。

只有用户明确要求提交时执行：

```bash
mkdir -p <log-directory>
actual_submission=$(sbatch --parsable --partition="$delta_partition" path/to/job.slurm)
actual_job_id=${actual_submission%%;*}
```

保存 parsable 原文和规范化 actual JobID。不要通过脆弱的自然语言截取，也不要从早先 `--test-only` 原文中复制 planning JobID。

### 10. 排队、监控与诊断

常用命令：

```bash
squeue -u "$USER" -o '%.18i %.16P %.24j %.2t %.10M %.10L %.6D %.20R'
squeue --start -j <JOBID>
scontrol show job -dd <JOBID>
sprio -j <JOBID>
sinfo -a
sacct -X -j <JOBID> --format=JobIDRaw,JobName,Partition,Account,State,ExitCode,Elapsed,Timelimit,AllocTRES,ReqTRES,MaxRSS,TotalCPU
sstat -j <JOBID>.batch --format=JobID,AveCPU,AveRSS,MaxRSS,MaxVMSize
```

生成综合报告：

```bash
bash "<SKILL_ROOT>/scripts/delta-job-report.sh" <JOBID> [ACCOUNT]
```

GPU 作业只读记录 allocation 实际得到的 GPU 型号、数量、driver/runtime 和可见设备集合，用于性能解释；不检查是否命中预定 UUID/物理 index，也不为命中某张卡而指定节点。失败 recovery 或 chained analyzer 读取 `references/11-gpu-portability-and-recovery.md` 并保留 dependency、runtime 和产物证据。

排队原因重点解释：

- `Priority`：前面有更高优先级作业；看 `sprio`，不要承诺开始时间。
- `Resources`：符合条件的节点/GPU 尚不可用；减少不必要资源、准确 walltime 可能更易 backfill。
- `QOSGrpBillingMinutes`：账户按请求资源与请求 walltime计算的可用余额不足，或同项目其他 pending 作业占用了同一额度。
- `MaxGRESPerAccount`：用户/项目在该分区的 GPU/核心上限已达到。
- `Dependency`：前置作业条件未满足。
- `ReqNodeNotAvail`/维护预约：查看 `scontrol show job` 和系统公告。
- `PartitionTimeLimit`/超最大时长：修正 `--time` 或分区。

排队保护的默认动作是“解释原因并等待”，不是“改一下再投”。尤其禁止为了缩短等待而自动取消/重投、切换分区、改 walltime/资源、hold/release/requeue 或提交同一工作的第二份副本。即便诊断发现配置可能不理想，也先把具体 JobID、当前 state/reason、已经等待的时间和建议代价报告给用户；只有用户明确选择放弃当前排队位置后才执行 mutation。

只有用户明确授权具体 JobID 后，才把下列命令当作控制动作使用：

```bash
scancel <JOBID>
scontrol hold <JOBID>
scontrol release <JOBID>
scontrol requeue <JOBID>
```

执行前再次显示 JobID、job name、account、state 和 dependency，并明确：取消后若重投会获得新 JobID、重新进入队列，原 queue age/位置不会继承。

环境错误可能发生在 batch shell 还没有进入 `srun` 时，例如 `module load pytorch-conda/2.8` 因 hidden dependency 失败。这时 Python 程序的 failure trap/JSON marker 根本不会运行。必须保存 Slurm stdout、stderr、`sacct` 和 source manifest，将它归类为 **pre-application environment failure**；修复必须使用新 immutable attempt identity，不得在已提交的 source root 原地修补后复用旧 identity。

不要频繁轮询整个集群。监控自己作业即可；远程长作业优先根据 `squeue --start`、`scontrol EndTime`、历史吞吐和最近的前置/guard/checkpoint 事件估计下一次有意义的检查时间，然后挂在对应长 `sleep` 上。醒来只取一次快照；若仍未完成，重新估计并再次长 sleep，不要固定频率忙轮询。

若长 controller/operator 运行在前台统一 exec session，wrapper 暂时无新 output 时继续等待同一 session，不得并发再次调用。duplicate `FATAL` 只描述重复调用自身；原 scope 是否完成只能由 exact PID/starttime、真实 wait exit、write-once TERMINAL/COMPLETE 和 required receipt/hash 判定。恢复与取消细节见 `references/13-runtime-gpu-namespaces-and-single-writer-operators.md`。

### 11. 作业结束后复盘

无论成功失败，都读取 `sacct`、stdout/stderr 和实际 charge。报告：

- `State`、`ExitCode`、`Elapsed/Timelimit`；
- CPU 利用、MaxRSS、GPU 利用与显存峰值；
- 实际 SU；
- 是否因 walltime、主机 OOM、GPU OOM、节点故障、程序异常、文件系统/配额失败；
- 下一次应调整的 GPU、CPU、内存、walltime、并发度或数据布局。

优化顺序：先修正确性与恢复能力，再减少空闲 GPU/CPU/内存，最后才压缩 walltime。不要因一次短跑就大幅降低时间上限。

## 专题读取索引

只加载与当前问题相关的参考文件，以免无谓占用上下文：

- Remote Control、SSH/Codex 登录、持续连接、恢复与全面入门：`references/01-access-and-quickstart.md`
- 账户、余额与精确计费：`references/02-accounts-and-accounting.md`
- 节点硬件和 GPU 选择：`references/03-hardware-and-gpu-selection.md`
- walltime、backfill、priority、interactive、preempt：`references/04-walltime-queue-and-priority.md`
- 500G/1.5T、目录布局、staging、传输：`references/05-storage-and-data.md`
- Slurm 模式、数组、依赖、MPI/DDP：`references/06-slurm-recipes.md`
- Modules、Conda、Apptainer、Jupyter：`references/07-software-and-reproducibility.md`
- 监控、状态、故障排查、支持工单：`references/08-monitoring-and-troubleshooting.md`
- 更新本技能及处理文档冲突：`references/09-maintenance-and-live-verification.md`
- 官方来源和核实日期：`references/10-official-sources.md`
- GPU 无绑定可移植性、恢复/依赖链、环境/传输/时间可移植性：`references/11-gpu-portability-and-recovery.md`
- formal deployment preflight、runtime/依赖闭包、只读源码测试、完整 unittest receipt 和 F3 fixture 同步：`references/12-formal-deployment-preflight-and-runtime-closure.md`
- runtime GPU 三域 ordinal、Python lexical/resolved、Torch usable memory 和 single-writer operator：`references/13-runtime-gpu-namespaces-and-single-writer-operators.md`
- sealed parent + signed overlay 逐路径 mode projection、generated-config 阶段化 inventory、Stage1 真实 materialize/post-inventory/seal/replay、postpublish/whole-tree digest 和完整重试 identity：`references/14-sealed-parent-overlay-mode-projection.md`
- 机器可读静态快照：`references/data/delta-static-facts-2026-08-09.json`

## 输出质量标准

当用户让你“帮我跑/改/提交 Delta 任务”时，最终输出应包含：

1. **决策摘要**：硬件、分区、资源、walltime、存储；
2. **核实证据**：来自实时 `accounts/quota/sinfo/scontrol/sacct` 的关键值；
3. **成本与排队风险**：实际费用估计、准入上界、backfill 逻辑；
4. **完整脚本或补丁**；
5. **提交/监控命令**；
6. **失败恢复与下一轮复盘方法**。
7. **可移植性与污染边界**：证明脚本未绑定 GPU 型号/节点/UUID/设备编号；若涉及 continuation，给出 runtime/import-origin、依赖变更授权和 pre/post-mutation 证据。

对无法现场核实的内容明确标为“静态参考”或“待在 Delta 上验证”，不要用确定语气伪装。
