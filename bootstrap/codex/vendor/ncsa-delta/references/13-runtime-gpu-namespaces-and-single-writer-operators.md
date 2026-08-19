# Runtime GPU ordinal namespaces、Python identity 与 single-writer operator

本专题处理两类容易被误判成科学失败的问题：

1. Slurm、`CUDA_VISIBLE_DEVICES`/`nvidia-smi` 与 Torch 使用了不同的 GPU ordinal namespace，却被错误地按数字相等连接；
2. 前台长进程仍在运行，工具 wrapper 的空输出或第二次调用的 duplicate `FATAL` 却被错误地解释为原进程失败，然后并发启动重复 operator。

这些都是基础设施合同。它们可以在任何模型、数据集或 GPU 型号上复用，不得把某个 hostname、型号、UUID、PCI bus 或 JobID 写成目标身份。

## 1. 2026-08-12 Delta 实测边界

两个独立的单 GPU allocation 给出了互补证据：

| 证据 | scheduler/node-global | allocation-visible inventory | framework-local |
|---|---|---|---|
| 非零物理槽位 allocation | `GRES IDX=3`、`SLURM_JOB_GPUS=3`、`SLURM_STEP_GPUS=3` | `CUDA_VISIBLE_DEVICES=0`、allocation 内 `nvidia-smi index=0` | Torch local index `0` |
| 零物理槽位诊断 allocation | `GRES IDX=0`、`SLURM_JOB_GPUS=0`、`SLURM_STEP_GPUS=0` | `CUDA_VISIBLE_DEVICES=0`、allocation 内 `nvidia-smi index=0` | Torch local index `0` |

第一行直接证明跨 namespace 的 ordinal 可以不同；第二行证明数字偶然相同也不能推出 namespace 相同。故正确合同不是“把所有 0/3 对齐”，而是：

- 每个 namespace 内验证 cardinality、唯一性和内部一致性；
- 严禁跨域 ordinal equality；
- 跨采集工具只在同一 allocation 内用 UUID、name、PCI 等观察字段连接设备记录；
- 这些字段不与过去/未来作业的目标 identity 比较，也不用于指定型号、节点或卡。

这两份证据只支持 Delta 当前 allocation visibility 语义，不证明任何特定 GPU 永远位于某个物理槽位，也不提供模型效果证据。

## 2. 三个 ordinal namespace

### 2.1 Namespace S：scheduler/node-global ordinal

来源包括当前节点对应的：

- `scontrol show job -dd` 中 `GresDetail`/`GRES=...(IDX:...)`；
- `SLURM_JOB_GPUS`；
- `SLURM_STEP_GPUS`。

它们描述 Slurm/cgroup 分配在节点 scheduler 视图中的设备。对一个单节点 receipt，可以验证：

- 每个字段解析出的数量等于 requested/allocated GPU count；
- 每个列表无重复；
- 三个 scheduler 字段在其共同可用时表示同一组 node-global IDs。

多节点作业必须按节点分别保存和验证 scheduler receipt；不要把不同节点都可能出现的 `IDX=0` 合并成一个全作业物理 ID。

### 2.2 Namespace V：allocation-visible inventory ordinal

来源包括：

- `CUDA_VISIBLE_DEVICES` 暴露的 token 集合；
- allocation 内 `nvidia-smi --query-gpu=index,...` 显示的 visible index；
- 对 AMD allocation 的对应 ROCm inventory。

在 Delta 当前 cgroup/driver 组合中，allocation 内 `nvidia-smi` 可能只显示分给作业的设备，并从 `0` 重新编号。`CUDA_VISIBLE_DEVICES=0` 也只能作为 allocation 可见集合中的 token 解释。验证：

- token/visible row 数量等于 allocation GPU count；
- token、visible index、UUID 和 PCI 在各自字段内无重复；
- 当前 Delta NVIDIA receipt 的 visible index 是本地连续集合 `0..N-1`。

不要把 CVD token 的数值与 Namespace S 的 `IDX` 比较。CVD 也可能使用 UUID token；因此默认把 token 当 opaque string，而不是物理 index。

### 2.3 Namespace F：framework/process-local ordinal

来源包括：

- Torch `torch.cuda.device_count()`；
- `LOCAL_RANK`/`SLURM_LOCALID`；
- Torch device index/current device。

验证：

- framework accelerator 可用；
- device count 等于该进程应见的 GPU count；
- local indices 唯一且构成 `0..N-1`；
- multi-process 程序按 local rank 选择 Namespace F 中的设备。

不要把 Torch local index 与 Namespace S 的 `IDX` 比较，也不要因为它们恰好都等于 `0` 就声称找到了节点物理 GPU 0。

## 3. 同一 allocation 内的观察性 join

跨 Namespace V/F 连接一条设备记录时，记录：

```text
UUID
normalized name
PCI bus ID
nvidia-smi board-total memory
Torch usable memory
```

要求 Torch/NVML 与 visible `nvidia-smi` 对同一 allocation 的 UUID、name 和 PCI 观察一致。这个 join 用于发现 receipt 自相矛盾或错误选行，不是 identity pinning：

- 不存在 `expected_gpu_uuid`；
- 不与父作业、上一 seed、下一作业或另一节点的 UUID 做目标匹配；
- 不要求 GPU name 等于某个型号；
- 不用 PCI/UUID 构造 `--nodelist`、typed GRES、constraint 或 `CUDA_VISIBLE_DEVICES`。

如果框架公共 API 不直接暴露 UUID/PCI，可以在同一 allocation 内用 NVML/ROCm inventory 生成观察字段；receipt 必须记录字段来源。不要拿 scheduler `IDX` 当作 `nvidia-smi` 行号。

## 4. Torch usable memory 不是 board-total memory

`nvidia-smi memory.total` 是板卡/driver inventory 的总量；`torch.cuda.get_device_properties(i).total_memory` 是框架可用量，可能因 ECC、固件、driver 保留或可见资源切分而略小。正确门禁是：

```text
0 < declared_minimum_usable_bytes
declared_minimum_usable_bytes <= torch_usable_bytes <= nvidia_board_total_bytes
```

同时记录：

```text
board_minus_torch_usable_bytes = board_total_bytes - torch_usable_bytes
```

不得要求 exact equality，也不得用某型号宣传显存做隐含门禁。若项目需要 38 GB，就显式声明最小 usable bytes；不要写“必须是 A100/H200”。

## 5. Python lexical launcher 与 resolved target

下列两个路径是不同字段：

```text
lexical launcher:  /frozen/runtime/bin/python
resolved target:   /frozen/runtime/bin/python3.11
```

合法 symlink 会让它们不同。runtime continuation 应分别验证：

- current lexical launcher 对 expected/prior lexical launcher；
- current resolved target 对 frozen/prior resolved target；
- symlink chain、ownership、mode、prefix、Python version 和 import origin 仍满足 `references/12-formal-deployment-preflight-and-runtime-closure.md`。

禁止把 current resolved target 与 prior lexical launcher 比较。那会把正常 symlink 误判为 environment drift。

## 6. 可执行 runtime-contract validator

`scripts/delta-gpu-runtime-contract.py` 是 Python 3.9+、stdlib-only 的离线 validator。它读取已捕获的单节点 NVIDIA receipt，不 import Torch、不访问 GPU/数据/checkpoint/Validation/Test：

```bash
python3 <SKILL_ROOT>/scripts/delta-gpu-runtime-contract.py \
  --input <RUNTIME_CONTRACT_INPUT.json> \
  --output <WRITE_ONCE_RUNTIME_CONTRACT_REPORT.json>
```

输出存在时拒绝覆盖。正式 source 应冻结脚本 SHA256，并让 authority gate 在任何模型/optimizer mutation 前生成输入和 report。validator 的输入 schema 示例见：

```text
tests/fixtures/gpu-runtime-contract-idx3-visible0.json
tests/fixtures/gpu-runtime-contract-idx0-visible0.json
```

这不是 GPU collector。采集必须发生在实际 allocation 中，并保留原始 `scontrol`、白名单 env、`nvidia-smi`/ROCm、framework 和 Python receipt。

## 7. 必须保留的正负回归

### 正例

- scheduler `IDX=3`、`JOB_GPUS=3`、`STEP_GPUS=3`，但 CVD/nvidia/Torch 都是 local `0`：PASS；
- scheduler `IDX=0` 且 CVD/nvidia/Torch 也是 `0`：PASS，但报告仍明确未执行跨域 ordinal equality；
- lexical `/bin/python` 与 resolved `/bin/python3.11` 不同，只要 lexical-to-lexical 和 resolved-to-resolved 都匹配：PASS；
- Torch usable memory 小于 board total、但高于 declared minimum：PASS。

### 负例

- scheduler GRES/JOB/STEP count 或同域集合不一致：FAIL；
- 同一 allocation 的 Torch UUID 找不到唯一 visible UUID 行，或 UUID/name/PCI 不一致：FAIL；
- Torch accelerator unavailable：FAIL；
- requested one GPU 但 CVD、`nvidia-smi` 或 Torch 暴露 multiple visible devices：FAIL；
- Torch usable memory 低于 declared minimum 或高于 board total：FAIL；
- current resolved path 被拿去和 lexical expected 混比：测试必须显示正确的分栏比较仍可通过，错误实现不得进入 production。

回归 fixture 使用虚构 UUID，只验证合同，不注册目标设备。

## 8. 前台长进程与 wrapper 输出不是进程状态

统一 exec/terminal 工具可能先返回 session/cell ID，然后长进程继续运行；后续一次 wait/poll 也可能暂时没有新 stdout。以下都**不等于原进程失败**：

- wrapper 返回空 output；
- 没有新日志行；
- 第二个并发调用输出 duplicate `FATAL`；
- 第二个调用自身非零退出。

duplicate `FATAL` 只证明“第二个 invocation fail-closed 拒绝了相同 scope”。它既不证明原 PID 已死，也不证明 aggregate scope 未完成。

在决定恢复或取消前，必须核实原进程的 exact identity tuple：

```text
scope/attempt ID
PID
/proc/<PID>/stat field 22 starttime ticks（防 PID reuse）
/proc/<PID>/cmdline 或 script path + SHA256
launcher/session identity
write-once ACTIVE receipt
```

`kill -0 <PID>` 只能证明该数字当前存在，不能单独排除 PID reuse。不要只用宽泛的 `pgrep`、process name 或日志文件名推断身份。

## 9. single-writer、wait exit 与 aggregate COMPLETE

一个 aggregate/controller scope 只能有一个 writer：

1. launcher 以 `O_CREAT|O_EXCL`、atomic `mkdir`、hard-link create 或 shell `noclobber` 获取 scope lock；
2. write-once `ACTIVE.json` 记录 exact identity tuple、command、source/operator SHA 和开始 UTC；
3. 同一个拥有 child 的 shell/controller 执行并 `wait "$child_pid"`，记录精确 wait exit；不同 shell 不能对非 child PID 补造一个 `wait` 结果；
4. write-once `TERMINAL.json` 记录 child exit/signal 和结束 UTC；
5. 只有 child exit 0、全部 expected stage receipt/manifest/hash 通过且 scope identity 精确匹配时，才以 write-once 方式生成 aggregate `COMPLETE.json`；
6. `COMPLETE.json` 已存在时拒绝覆盖；不允许第二个 controller“补齐”或重新解释同一 scope。

推荐的状态判定：

| 观察 | 合法结论 |
|---|---|
| exact PID/starttime 仍活着，未见 TERMINAL | 原 invocation 仍运行；继续挂在原 wait/session，不启动重复进程 |
| duplicate invocation `FATAL` | duplicate 自身被拒；原 invocation 状态仍需独立核实 |
| TERMINAL exit 0，无 COMPLETE | controller 已结束，但 aggregate 尚未被验证为完整；不得宣称 complete |
| write-once COMPLETE + 全部 hash 重验 | 该 exact scope 完成 |
| exact PID 已死、无可信 TERMINAL/COMPLETE | 状态不完整/未知；保留证据并创建新的 recovery identity，不能改写旧 scope |

## 10. 取消与恢复

取消 Slurm job 仍遵守具体 JobID 用户授权；取消前后保存 `scontrol`/`sacct`。取消本地/登录节点 operator 也必须：

- 先核对 exact PID/starttime/cmdline/script SHA/scope；
- 确认它不是仍应继续 wait 的原 controller；
- 保存 mutation 前 process/receipt snapshot；
- 发出最小必要信号并记录发送结果；
- 等待或读取原 controller 的 terminal receipt；
- 不因 duplicate `FATAL` 去取消原进程；
- 不删除 stale lock、ACTIVE、TERMINAL 或 partial report；用新的 immutable recovery identity 指向旧证据。

如果前台工具 session 仍可 wait，就继续使用同一 session。只有 exact identity 证明原进程不再运行，且旧 scope 没有可信 COMPLETE 后，才能把它归为 incomplete 并设计 recovery；恢复也不得并发重用旧 scope。

## 11. 最终自检

- [ ] 三个 ordinal namespace 分栏记录，没有 scheduler-vs-visible/Torch ordinal equality。
- [ ] scheduler GRES/JOB/STEP 只在 scheduler 域内做 count/set consistency。
- [ ] CVD token 当 opaque string；visible/framework 只验证各自 cardinality/local consistency。
- [ ] UUID/name/PCI 仅作同一 allocation 观察性 join，没有跨 job identity pinning。
- [ ] Torch usable memory 只做 declared minimum 与 board-total 上下界，不做 exact equality。
- [ ] Python lexical-to-lexical、resolved-to-resolved；symlink chain 与 import origin 另行验证。
- [ ] 正例 `IDX3 -> visible0` 与 `IDX0 -> visible0` 都通过；指定负例全部 fail-closed。
- [ ] 长进程空输出或 duplicate `FATAL` 没有被当成原进程失败。
- [ ] single-writer、exact PID/starttime、真实 wait exit 和 write-once aggregate COMPLETE 全部有证据。
