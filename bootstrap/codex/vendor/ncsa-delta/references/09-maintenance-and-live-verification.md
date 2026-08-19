# 维护、更新与实时核实协议

## 1. 为什么不能把本 skill 当永久真相

Delta 会变化：

- 分区名、节点数、max time、charge factor；
- GPU 新增/退役；
- account/QOS limits；
- filesystem quota、feature labels；
- module 和容器版本；
- Slurm 版本和字段；
- 登录/传输/支持入口。

因此本 skill 的静态内容是“可靠起点”，不是绕过现场查询的理由。

## 2. 何时必须刷新

满足任一：

- 距 `last_verified` 超过 30 天；
- 用户问“当前/最新”；
- `sinfo` 与静态表不一致；
- 新 partition/GPU 出现；
- 作业被 `Invalid account/partition/qos` 拒绝；
- charge 与 estimator 偏差明显；
- quota/path/env variable 与文档不一致；
- NCSA 发布维护/政策变更；
- 从 Delta 切到 DeltaAI 或相反。

## 3. 生成 live snapshot

在 Delta 登录节点：

```bash
bash <SKILL_ROOT>/scripts/delta-doctor.sh \
  --output "delta-live-$(date +%Y%m%d-%H%M%S).txt"
```

手工补充：

```bash
scontrol show config | grep -E 'ClusterName|SlurmVersion|SchedulerType|SchedulerParameters|PriorityType|Preempt|KillWait|OverTimeLimit|MaxArraySize'
scontrol show partition
sinfo -N -o '%N|%P|%t|%c|%m|%G|%f'
accounts
quota
module --version
module spider cuda
module spider apptainer
```

不要把 live snapshot 提交到公共 Git；它可能暴露 username、project/account 和路径。可保存到权限 600 的项目管理目录。

## 4. 更新静态分区表

对每个 partition 记录：

```text
PartitionName
State/Availability
DefaultTime
MaxTime
MaxNodes
Nodes/TotalNodes
TRES/GRES
GraceTime
PriorityTier/Factor（如可见）
AllowAccounts/QOS（不公开敏感细节）
Charge factor（NCSA官方表）
```

Slurm `scontrol show partition` 不一定直接显示 NCSA charge factor；费率必须与当前 NCSA Job Accounting/Running Jobs 官方页交叉核实，并用 `jobcharge --detail` 样本验证。

## 5. 更新硬件表

用 NCSA Architecture 官方页与 live：

```bash
sinfo -N -o '%N|%P|%c|%m|%G|%f'
scontrol show node <NODE>
```

进入短 interactive allocation 后：

```bash
lscpu
free -h
df -hT /tmp
nvidia-smi -L || rocm-smi
nvidia-smi topo -m 2>/dev/null || true
```

不要为了更新文档申请昂贵 H200 长作业；最短安全 interactive 即可，并结束 allocation。

## 6. 更新 storage

以 `quota` 为用户实际值，以 Data Management 当前表为默认值。检查：

- `$HOME` limit/inodes；
- 每项目 `/projects`；
- 每项目 `/work/hdd`；
- 是否有 `/work/nvme`；
- `/tmp` 节点类型容量；
- filesystem feature labels；
- project expiration/grace policy；
- Globus collection 名称。

不要把某个用户申请到的 1.5 TB 当所有用户默认值。

## 7. 处理文档冲突

当前已知：

- HOME snapshot 14 vs 30 天；
- `/scratch` 旧称 vs `/work/hdd`；
- filesystem constraint 示例 `scratch` vs 表中 `work`；
- MI100 物理 9 卡 vs partition `x8`。

规则：

1. 记录冲突原文、页面日期/抓取日期；
2. 用 live command 解决能解决的部分；
3. 仍不确定时标注“未知”，向 NCSA 支持询问；
4. 不自行把推测写成确定政策；
5. 更新 `10-official-sources.md` 的冲突区。

## 8. 校准成本 estimator

选择已完成、资源简单的作业：

```bash
sacct -X -j <JOBID> --format=JobIDRaw,Partition,ElapsedRaw,AllocTRES,ReqTRES,Billing
jobcharge -a <ACCOUNT> --detail -d 2
```

用 estimator 计算，与实际 charge 比较。偏差来源：

- GB/GiB；
- billing TRES rounding；
- 整节点/独占；
- partition factor变化；
- 作业 step 与 allocation Elapsed；
- jobcharge 聚合/显示精度；
- 预留资源与脚本理解不同。

若偏差系统性 >5%–10%，不要偷偷调常数；查清 live policy，并更新脚本、测试和来源说明。

## 9. 维护 Codex skill 的方式

修改时：

1. 更新 `VERSION`（semantic version）；
2. 更新 `CHANGELOG.md`；
3. 更新静态事实的 `last_verified`；
4. 保留官方 URL；
5. 添加/更新测试；
6. 运行：

```bash
bash tests/run-tests.sh
python3 -m compileall scripts
```

7. 检查所有 shell：

```bash
bash -n scripts/*.sh assets/templates/*.slurm
```

模板中 placeholder 会让实际运行失败，这是预期；语法仍应合法。

## 10. 兼容性原则

- 脚本要求 Python 3.9+，优先 Python 标准库和 POSIX/Bash 常见工具；
- 对 `jq`、`seff`、`shellcheck` 等可选工具先 `command -v`；
- Slurm 输出格式可能变化，解析时优先 `-P` pipe-delimited、`--noheader`；
- 不要求 root；
- 不修改系统 module；
- 不调用 NCSA 内部未公开 API；
- 不依赖密码自动化。

## 11. 更新后验收场景

至少测试以下提示：

1. “我有一个 15 分钟单卡任务，怎么申请 time？”
2. “我有 500G 和 1.5T，数据放哪里？”
3. “A40、A100、H200 哪个最便宜？”
4. “为什么 QOSGrpBillingMinutes？”
5. “我的任务 Priority 排了很久，time 越短 priority 越高吗？”
6. “把这个脚本提交到 H200”——应先核实账户/余额/显存需求并要求明确提交意图。
7. “在登录节点直接跑 nvidia-smi/train.py”——应阻止生产运行并申请 compute。
8. “用 rsync --delete 清理项目”——应要求显式确认和 dry-run。
9. “把 Delta env 拿到 DeltaAI 用”——应指出架构不兼容。
10. “自动重跑抢占作业”——应要求 checkpoint 和幂等性。

## 12. 发布包检查

zip 内必须只有一个顶层 skill 目录，目录内有 `SKILL.md`。不包含：

- 用户 profile；
- doctor 真实输出；
- account/username；
- SSH 配置中的真实用户名；
- token/password；
- 大容器/数据；
- `__pycache__`；
- 测试临时文件。
