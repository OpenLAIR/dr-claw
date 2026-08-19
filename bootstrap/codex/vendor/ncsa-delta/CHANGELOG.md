# Changelog

## 0.4.5 — 2026-08-12

- 修复 login–compute runtime receipt 将 Lmod `load_method` 误当科学/数值 parity 字段的问题；login 走 fallback、compute 走 wrapper（或反过来）不再因加载路由差异单独 exit 3。
- 明确字段分层：Python 版本、lexical/resolved executable、prefix、Torch 版本、CUDA build 和 Torch origin 仍严格 fail-close；`load_method`、`wrapper_rc`、`module_list` 仍原样记录，但只作观测字段。
- compute receipt 新增 `observation_only_fields` 和 `observations_differing_from_login`，让路由差异可审计但不参与 `passed`；`compared_login_fields` 只列出核心 runtime identity。
- 增加行为回归：wrapper/fallback、wrapper rc 和 module list 全部不同但核心 runtime 相同时必须 PASS；任一核心字段漂移仍必须 FAIL。
- 将已观测的“4个正式 cell 在0 formal step 前因路由 mismatch 以 exit 3 结束”归类为 pre-formal infrastructure false rejection，不解释为科学结果，也不放松核心 runtime 合同。

## 0.4.4 — 2026-08-12

- 新增 generated artifact 的阶段语义：pre-materialization source inventory 必须证明 canonical generated config 不存在；post-materialization inventory 必须显式允许且要求恰好一个 canonical config，不能沿用“默认排除 config”的通用清单。
- 新增 Python 3.9 stdlib-only 的 `delta-phase-inventory.py`：逐项核对非生成 projected rows 不变，以及 config 的 exact path/type/size/SHA256/mode/top-level schema；拒绝 generic/exclude-based manifest 直接充当 post-materialization authority。
- post-seal 门禁升级为全树验证：包括 generated config 在内的每条 row 都按显式 ordinary/executable seal mode 投影，生成 whole-tree manifest，并要求从实际 final root 做独立 whole-manifest replay。
- Stage1 check 现在必须真实执行 unique disposable copy/materialize config/post-inventory/seal/replay；只对静态 rows 调 validator、只验证 pre-source 或跳过生成配置与 seal 的 smoke 都不能放行正式 mutation。
- 补充阶段错位、pre-existing config、额外 generated artifact、非生成 content drift、config mode/schema drift、excluded-artifact manifest misuse 和 post-seal replay drift 的正负回归；任何 prelaunch partial 仍需保留并换新完整 execution identity。

## 0.4.3 — 2026-08-12

- 新增 sealed parent + signed overlay 的逐路径 mode projection 合同：base-only row 完整继承父 seal，overlay row 完整采用签名的 path/type/size/SHA256/mode；禁止把 local writable full-tree modes 当作 deployment authority。
- 新增 Python 3.9 stdlib-only 的 `delta-mode-projection.py`：将 mode-stripped path/type/size/SHA256 科学/source-content 等价与部署 mode authority 分层，生成 write-once stage1/prepublish/postpublish report 和 projected rows digest。
- Stage1 合并检查现在必须真正构造 sealed-parent mode：`0440` base-only + `0644` overlay ordinary + `0750` overlay executable；仅用两棵 writable tree 的 smoke 不再足够。
- 强化 prepublication identity 规则：partial root/incoming 必须保留；修复必须使用新的完整 execution/source/preflight/incoming/final/run/log/controller identity，不得仅替换 recovery-id。
- 增加正负回归：混合 `0440/0644/0750` 正例、naive local-full equality 拒绝、parent/overlay 的 mode/content/path/size tamper、postpublish projected rows digest 和 write-once report。

## 0.4.2 — 2026-08-12

- 基于 Delta 两份互补 allocation 证据固化三域 GPU ordinal 合同：scheduler `GRES/IDX`、`SLURM_JOB_GPUS`、`SLURM_STEP_GPUS` 与 allocation-visible CVD/`nvidia-smi`、framework-local Torch index 严格分栏；`IDX3 -> visible0` 与 `IDX0 -> visible0` 都是正常正例，严禁跨域 ordinal equality。
- 新增 Python 3.9 stdlib-only 的 `delta-gpu-runtime-contract.py`：只在 scheduler 域内验证 count/set，一次 allocation 内用 UUID/name/PCI 做观察性 join，不注册跨 job 目标身份；write-once report 明确声明未做型号/UUID/node pinning。
- 显存门禁改为 `declared minimum <= Torch usable bytes <= board total bytes`，允许 driver/ECC/固件保留造成的差值，禁止 Torch usable 与 `nvidia-smi memory.total` exact equality。
- 强化 Python interpreter identity：lexical launcher 只与 lexical expected/prior 比，resolved target 只与 resolved expected/prior 比；明确 resolved-to-lexical 混比会误拒合法 `bin/python -> bin/python3.11` symlink。
- 新增 foreground/single-writer operator 合同：wrapper 空 output 或 duplicate `FATAL` 不代表原进程失败；恢复/取消前核对 exact PID、`/proc` starttime、cmdline/script SHA 和 scope，使用原 owner 的真实 wait exit，aggregate `COMPLETE` 只能在全部 receipt/hash 通过后 write-once 创建。
- 增加 GPU runtime 正/负回归：scheduler `IDX3/IDX0 -> visible0` 正例，以及 scheduler count、UUID join、Torch unavailable、multiple visible devices、minimum usable memory 负例；同步 SKILL/README/MANIFEST/PROMPTS/reference routes。

## 0.4.1 — 2026-08-12

- 新增 formal deployment/runtime closure 专题：严格区分 Delta 裸登录 Python 3.9.18、冻结 Python 3.11.13/Torch runtime，以及项目 immutable hashed dependency overlay；固定 `module use` + `module --ignore_cache load` fallback 与正式 `PYTHONPATH`/import-origin 门禁。
- 明确 venv interpreter symlink 是可审计的正常结构；禁止用“词法路径必须等于 `readlink -f`”的 blanket guard 误拒，改为同时验证 symlink chain、resolved target、可写性、prefix 与 runtime receipt。
- 固化 macOS tar/AppleDouble、`umask` 与显式 mode normalization 的不同语义；unique incoming 先规范 mode、再 exact fileset/SHA/mode seal、最后 atomic rename，final 不原地补文件或 chmod。
- 要求 immutable formal source 上的 compile/unittest/F3 使用外部 `tempfile`、`PYTHONDONTWRITEBYTECODE`/外部 pycache；legacy writable mirror 只能作为 non-authoritative 测试沙箱，不能进入正式 `PYTHONPATH`。
- ordinary unittest receipt 现在必须保存完整日志、test IDs、计数、import origins 和 source pre/post verify；仅保存输出 SHA256 不再足够。
- 明确 conversion-only dependency 应 lazy import；若 formal import/preflight 会触达，就属于 `formal_runtime_dependencies`。machine preflight 必须和 `conversion_only_dependencies` 分栏报告，正式新增依赖使用不可变哈希 overlay。
- 加入 schema 变更与所有 F0–F3 正/负 fixtures、producer/consumer/validator/materializer 的原子同步规则；full discovery 未通过不得跳到执行。
- 明确 `D03`–`D06` 一类 prelaunch failure identity 是不可变审计证据；修复必须创建下一唯一 attempt，记录 parent/failure/patch SHA，不得原地覆盖。

## 0.4.0 — 2026-08-11

- 新增排队保护硬规则：`PENDING` 默认只读诊断并继续等待；禁止 Codex 为尝试更快启动而自动 cancel/re-submit、hold/release/requeue、修改资源/分区/依赖或提交重复副本。执行 mutation 前必须核实具体 JobID，并明确取消会丢失旧 JobID 与 queue age/位置，新作业重新排队。
- 将 GPU 型号选择从 `.slurm` 源文件移到 `sbatch --partition=...` 提交层；七个 GPU 模板移除硬编码 A40/A100 分区，保留通用 GPU 数量请求。
- 废止 0.3.0 的 exact physical GPU continuation/device pinning 路线；GPU UUID、型号、PCI/index 和 node 现在只允许作为观察性 runtime receipt，不得作为筛选、节点约束或 fail-close 条件。
- linter 新增 `--submission-partition`，并拦截 GPU 脚本中的型号分区、typed GRES、node pinning、GPU bind、`CUDA_VISIBLE_DEVICES` 覆盖、固定 `cuda:N` 和 UUID target。
- Apptainer 模板按 allocation 实际 vendor 选择 `--nv`/`--rocm`；文档明确“任何 GPU 可跑”仍受 CUDA/ROCm、显存、精度和 custom kernel 的真实兼容边界约束。
- 保留项目内 `.agents/skills/ncsa-delta` 为唯一主版本；安装说明明确用户级/项目级只能选择一个可见副本。

## 0.3.0 — 2026-08-11

- 新增 exact physical GPU continuation 手册：严格区分物理 UUID、Slurm `GRES/IDX` 与 allocation-local index；明确请求 `k<N` 张卡不保证包含目标 UUID。
- 固化两种可审计设备策略：整组 GPU，或由 `scontrol`、holder/guard `EndTime` 和 guard window 支撑的 complement-cardinality 证明；两者都必须在任何科学 mutation 前按 UUID fail-close。
- 明确 `afterany` 不证明 epilog/GRES 已释放，也不自动重绑失败 predecessor 上的 `afterok` downstream；加入 `DependencyNeverSatisfied` 清理、新 immutable recovery identity 和 dependency readback 流程。
- 加入 pre/post-mutation 科学污染边界、login/compute import-origin/runtime receipt、macOS 旧 `rsync` 不支持 `--chmod` 时“先传后远端 chmod”、cluster/local/UTC 时间规范、基于预测 `EndTime` 的长 sleep 以及 `/projects`、`/work/hdd`、`/work/nvme` 权威分工。
- 新增提交、allocation 内、失败后和完成后的自检清单与无凭据的安全命令模板。

## 0.2.3 — 2026-08-11

- 修复 macOS 到 Delta tar 边界：发送端必须同时使用 `COPYFILE_DISABLE=1` 和 `--no-xattrs`，因为仅后者仍可在 Linux 产生 AppleDouble `._*`。
- 新增 Python 3.9 stdlib-only 的 `delta-fileset-manifest.py`，对跨系统归档进行 exact path/type/size/SHA256/symlink/file-set 验证；任何额外或 `._*` 都使验证失败，只保留/隔离 incoming，绝不生成或覆盖 final。
- 明确 Delta 登录节点裸 `python3` 实测为 3.9.18：它只适合 skill 自身的 stdlib 工具。任何项目 semantic preflight（包括 `dataclass(slots=True)` 代码）必须与正式程序一样经 frozen loader/runtime receipt 进入 Python 3.11.13。
- 严格区分 `sbatch --test-only` 原文中的 planning JobID 与后续 `sbatch --parsable` 返回的 actual JobID；前者只归档为预检文本，所有监控、依赖和归档只能使用后者。

## 0.2.2 — 2026-08-11

- 记录 Delta RH9 上 `pytorch-conda/2.8` wrapper 可见但 hidden dependency `python/.conda-env/pytorch/2.8-cu128` 无法解析的已验证故障，并固化 `module use /sw/rh9.4/user/modules/python/.conda-env` + `pytorch/2.8-cu128` fallback。
- 增加可冻结的 PyTorch 2.8/cu128 loader 和 immutable login/compute runtime receipt，精确验证 Python 3.11.13、Torch 2.8.0+cu128、CUDA 12.8、包来源与 compute CUDA 可用性。
- 提交前门禁升级为“实际 module load/import probe → lint → test-only → manifest 复核”；明确 spider/lint/test-only 不证明 runtime 可用。
- linter 会拦截无 fallback 的 `pytorch-conda/2.8`，并警告缺失精确 runtime receipt 的 PyTorch 2.8/cu128 脚本。
- 增加 pre-`srun` 环境失败、immutable retry identity、`jobcharge` 子日窗口 bug、macOS rsync `fchmodat`/ACL 失败后的 tar-stream + SHA256 + atomic rename 归档流程，以及 zsh `path`/`PATH` 陷阱。
- 明确 fallback 只在数值 runtime receipt 完全匹配时才属于加载路由修复，不自动提升为 matched scientific result 或 bitwise determinism 证据。

## 0.2.1 — 2026-08-10

- 按 Delta 当前 `jobcharge -h` 修正所有账户参数为 `-a/--account`，并修复作业报告工具与成本工具提示。
- 将 Slurm 模板和环境示例的个人数据根目录改为 `/projects/<PROJECT>/$USER`、`/work/hdd/<PROJECT>/$USER` 和可选 `/work/nvme/<PROJECT>/$USER`；项目根目录保留给明确共享内容。
- 对未设置的 `WORK`/`SCRATCH` 使用安全探针，并说明 `df` 不能替代 `quota` 判断 allocation 配额。
- 增加外部 CLI 和用户级路径回归测试；明确 GPU-only 账户不能提交 CPU-only 作业，限制分区可见不代表账户可用。

## 0.2.0 — 2026-08-10

- 加入手机 ChatGPT 到 Mac Remote Control、Mac SSH ControlMaster、NCSA Kerberos + Duo、Delta 远端 Codex 和 Desktop SSH app-server 的完整分层连接手册。
- 明确 OpenAI 账号/MFA 与 NCSA 密码/Duo 是独立认证域，并加入切换 ChatGPT 账号后的重新授权流程。
- 加入 `delta-codex` 具体 alias、连接复用、Mac 防睡眠、端到端验证、断线恢复和错误分层；明确 `ControlPersist 7d` 不等于永久会话。
- 说明 Delta 普通用户不能因 ACCESS 页面已上传公钥就假定可用 public-key SSH。
- 修正 README 的安装目录名，并加入远端 `$HOME/.agents/skills` 安装说明。
- 移除 `agents/openai.yaml` 中当前 Codex 不支持的 `api` 产品值，使界面元数据能被新版 Desktop 正常加载。

## 0.1.0 — 2026-08-09

- 初始完整版本。
- 覆盖 Delta 当前 CPU/A40/A100x4/A100x8/H200/MI100 分区和费率因子。
- 加入实际运行费用与 walltime 准入上界的区分。
- 加入 500 GB `/projects`、可扩容 `/work/hdd` 与 1.5/2 TB 节点本地 `/tmp` 的辨认和布局规则。
- 加入 walltime P95 建议、backfill 解释、抢占 checkpoint、作业数组、依赖、多节点 PyTorch 模板。
- 加入只读 doctor、SU estimator、walltime advisor、Slurm linter 和作业报告工具。
- 精确区分 Slurm MiB/GiB 与 NCSA 十进制计费 GB；模板和 linter 可识别 58G/59G 等计费边界。
- 修正多节点 launcher、抢占信号和本地 `/tmp` 提前同步/最终 copy-back 的可靠性细节。
