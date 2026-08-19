# 账户、余额、SU 与成本

## 1. `accounts`：查看可用 charge account 与余额

```bash
accounts
```

典型输出包含：

- `Project`：提交时传给 `--account` 的本地账户名；
- `Balance (Hours)`：剩余可用额度；
- `Deposited (Hours)`：最初或累计存入额度。

CPU 和 GPU 通常分成不同账户，例如：

```text
abcd-delta-cpu
abcd-delta-gpu
```

不可把四字符项目代码 `abcd` 直接当作 `--account`，也不可只因名字以 `-gpu` 结尾就假定余额充足。

## 2. Delta 的 SU 基础定义

Delta 的 charge unit 是 Service Unit (SU)。收费按**作业保留的资源**，不是按实际利用率；CPU 与主机内存取较大者，GPU 节点还会与 GPU 数取较大者。

### CPU 节点

```text
base SU/hour = max(申请 CPU 核数, 申请主机内存 GB / 2)
```

### Slurm 内存单位与 NCSA 计费单位

这里有一个会改变计费单位的陷阱：

- NCSA 计费公式中的 1 GB 是十进制 `1,000,000,000 bytes`；
- Slurm `--mem` 的裸数字默认按 MiB，后缀 `G` 是 GiB，即 `2^30 bytes`；
- 所以 `--mem=60G` 是约 **64.4245 decimal GB**，不是 60 GB。

计费边界附近可用下表审计：

| 场景 | 十进制计费边界 | 不越界的整 GiB 起点 | 下一整 GiB |
|---|---:|---:|---:|
| A40x4/A100x4，1 GPU | 62.5 GB | `58G` = 62.2770 GB | `59G` = 63.3507 GB，越界 |
| A40x4/A100x4，4 GPU | 250 GB | `232G` = 249.1081 GB | `233G` = 250.1818 GB，越界 |
| CPU，16 核 | 32 GB | `29G` = 31.1385 GB | `30G` = 32.2123 GB，越界 |

这些只是**计费边界**，绝不是“应该把内存压到这里”的性能建议。真实峰值接近边界时，宁可多付 SU，也不要因 OOM 重跑。用 `sacct`/`sstat` 的 `MaxRSS` 和应用峰值决定安全余量。物理内存也不等于 Slurm 可申请内存，OS 会占用一部分。

成本脚本推荐直接传 Slurm 写法：

```bash
python3 <SKILL_ROOT>/scripts/delta-cost.py --partition gpuA100x4 \
  --nodes 1 --gpus-per-node 1 --cpus-per-node 16 --mem 58G \
  --elapsed 20m --walltime 30m
```

只有输入本身已经是十进制 GB 时才使用 `--mem-gb-per-node`。最终收费仍以 `jobcharge` 为准。

### GPU 节点

每节点：

```text
base GPU units/hour = max(
  申请 GPU 数,
  申请 CPU 核数 / 每GPU等价核数,
  申请主机内存GB / 每GPU等价内存GB
)
```

然后：

```text
SU = base units/hour × 节点数 × 实际运行小时 × partition charge factor
```

等价表：

| 节点类型 | 每 GPU 等价 CPU | 每 GPU 等价主机内存 |
|---|---:|---:|
| A40x4 | 16 核 | 62.5 GB |
| A100x4 | 16 核 | 62.5 GB |
| A100x8 | 16 核 | 250 GB |
| H200x8 | 12 核 | 250 GB |
| MI100x8 | 16 核 | 250 GB |

这意味着“只申请一张 GPU”不保证只付一 GPU 单位：例如 A100x4 上申请 1 GPU、32 CPU、120 GB，基础单位约为 `max(1,2,1.92)=2`。

## 3. 当前静态费率因子与最低条件下的 GPU 小时

| Partition | Factor | 约 SU/GPU·h | 整节点约 SU/h |
|---|---:|---:|---:|
| `gpuA40x4-preempt` | 0.25 | 0.25 | 1 |
| `gpuA40x4` | 0.5 | 0.5 | 2 |
| `gpuA40x4-interactive` | 1.0 | 1.0 | 4 |
| `gpuA100x4-preempt` | 0.5 | 0.5 | 2 |
| `gpuA100x4` | 1.0 | 1.0 | 4 |
| `gpuA100x4-interactive` | 2.0 | 2.0 | 8 |
| `gpuA100x8` | 1.5 | 1.5 | 12 |
| `gpuA100x8-interactive` | 3.0 | 3.0 | 24 |
| `gpuH200x8` | 3.0 | 3.0 | 24 |
| `gpuH200x8-interactive` | 6.0 | 6.0 | 48 |
| `gpuMI100x8` | 0.25 | 0.25 | 2（按分区 x8） |
| `gpuMI100x8-interactive` | 0.5 | 0.5 | 4（按分区 x8） |

CPU 整节点 128 核：生产约 128 SU/h，interactive 约 256 SU/h，preempt 约 64 SU/h。静态表在提交前用 `scontrol show partition` 核实。

## 4. 计算示例

### 示例 A：A100x4，1 GPU，16 CPU，`--mem=58G`，20 分钟

```text
58 GiB = 62.2770 decimal GB
base = max(1, 16/16, 62.2770/62.5) = 1
factor = 1
elapsed = 1/3 hour
charge ≈ 0.333 SU
```

若 walltime 请求 30 分钟，实际只跑 20 分钟，预期账单约 0.333 SU；但余额准入可能按 0.5 SU 检查。

### 示例 B：A100x4，1 GPU，32 CPU，约 120 decimal GB，20 分钟

```text
base = max(1, 32/16, 120/62.5) = 2
charge ≈ 2 × 1/3 = 0.667 SU
```

CPU 请求翻倍使费用翻倍，即使 GPU 仍为一张。

### 示例 C：H200，1 GPU，12 CPU，200 GB，30 分钟

```text
base = max(1, 12/12, 200/250) = 1
factor = 3
charge ≈ 1 × 3 × 0.5 = 1.5 SU
```

### 示例 D：A40 preempt，4 GPU，64 CPU，`--mem=232G`，1 小时

```text
232 GiB = 249.1081 decimal GB
base = max(4, 64/16, 249.1081/62.5) = 4
factor = 0.25
charge ≈ 1 SU
```

便宜，但作业必须能处理抢占。

### 示例 E：CPU，8 核，64 GB，2 小时

```text
base = max(8, 64/2) = 32 SU/h
charge ≈ 64 SU
```

这是典型“内存主导”作业。改申请 8 核并不使它便宜；需要减少内存或选择适合的大内存 GPU 节点并重新计算。

## 5. 实际时长、请求时长和余额准入

三个概念必须分开：

1. **Timelimit**：用户请求的硬上限；
2. **Elapsed**：实际占用 allocation 的时长；
3. **Charge**：按保留资源、Elapsed 和费率因子得出的最终 SU。

通常多申请 walltime 不会把实际账单直接按完整 Timelimit 收满；但 Delta 会用请求资源和请求 walltime 判断 allocation 是否足以让作业完成。请求过大时可能出现：

```text
(QOSGrpBillingMinutes)
```

同项目的其他 pending 作业也可能共同占住这类额度。不能仅看 `accounts` 的余额数字就断言某任务能启动。

## 6. 查看实际费用

先读取现场 CLI 帮助；当前 Delta RH9 上账户必须通过 `-a/--account` 传入，不能把账户名作为裸位置参数：

```bash
jobcharge -h
jobcharge -a <ACCOUNT> -d 10
jobcharge -a <ACCOUNT> -d 10 --detail
```

其他范围：

```bash
jobcharge -a <ACCOUNT> -m 8 -y 2026
jobcharge -a <ACCOUNT> -s 2026-08-01 -e 2026-08-10 --detail
```

`jobcharge -h` 查看现场参数。用 `accounts` 列出的完整账户名。

### 6.1 小于一天的窗口故障

2026-08-11 实际遇到：`jobcharge` 在某些 **<24 小时**的 start/end 窗口上可能报：

```text
range() arg 3 must not be zero
```

这是 CLI/reporting 窗口故障，不是“没有计费”的证据。可审计做法：

```bash
readonly ACCOUNT=<ACCOUNT>
readonly JOB_ID=<JOBID>
readonly EVIDENCE_DIR=<ATTEMPT_EVIDENCE_DIR>
mkdir -p "$EVIDENCE_DIR"

# 使用 >24h 的窗口；不要为了只看一个短作业把窗口压成几小时。
jobcharge -a "$ACCOUNT" -d 2 --detail \
  | tee "$EVIDENCE_DIR/jobcharge.raw.txt"

# 按 JobID 生成便于阅读的子视图，但原始输出必须保留。
grep -F "$JOB_ID" "$EVIDENCE_DIR/jobcharge.raw.txt" \
  > "$EVIDENCE_DIR/jobcharge.job-${JOB_ID}.txt" || true
```

不要只归档 `grep` 结果；如果输出格式变更、JobID 只出现在关联行或 charge 尚未入账，过滤结果可以为空。完整 raw 文本才能事后重新解析。

Slurm 资源记录：

```bash
sacct -X -j <JOBID> \
  --format=JobIDRaw,JobName,Partition,Account,State,ExitCode,Elapsed,Timelimit,AllocTRES,ReqTRES,Billing
```

`Billing`/TRES 是理解计费的重要线索，但最终项目余额以 NCSA `jobcharge`/`accounts` 为准。

## 7. 失败、超时和空闲资源也可能收费

- 程序 2 分钟后崩溃：通常仍消耗这 2 分钟的保留资源；
- GPU 0% 利用但 allocation 运行 1 小时：仍按保留 GPU/CPU/内存收费；
- interactive shell 发到节点后忘记退出：空闲时间仍计入 Elapsed；
- `TIMEOUT`：到 walltime 前的运行时长仍消耗 SU；
- `--exclusive`：按整节点资源收费，即使应用只用一部分。

不能把失败作业理解为“免费”。系统性故障可收集证据向 NCSA 支持询问，但不要承诺自动退款。

## 8. 预算规划

对实验计划建立表格：

```text
实验数 × 每实验 GPU 数 × 预计小时 × factor
```

再乘 1.1–1.3 的失败/调参余量。更准确的方法是用本 skill 的成本脚本逐个配置计算，并从 `jobcharge --detail` 校准。

```bash
python3 <SKILL_ROOT>/scripts/delta-cost.py \
  --partition gpuA40x4 \
  --nodes 1 --gpus-per-node 1 --cpus-per-node 8 --mem 29G \
  --elapsed 02:00:00 --walltime 02:30:00
```

## 9. 降低成本的优先级

1. 不申请用不到的 GPU；
2. 不默认独占；
3. 让 CPU/内存与每 GPU 等价资源匹配；
4. 结束 idle interactive allocation；
5. 对可恢复任务使用 preempt；
6. 用 A40/MI100 前先验证正确性和吞吐/SU；
7. 降低 I/O 等待、提高 GPU 利用率；
8. 避免盲目把 walltime 压短造成重跑。

最优指标是“达到目标科学结果所需总 SU”，不是单个 step 的最低费率。
