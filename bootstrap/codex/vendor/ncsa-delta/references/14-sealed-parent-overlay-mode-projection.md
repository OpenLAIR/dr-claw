# Sealed parent、signed overlay 与逐路径 mode projection

本专题处理 formal deployment 中一种隐蔽的 prepublication engineering failure：父 source 已经 seal 为只读 mode，新的候选 source 在本地仍是可写 mode；部署只复制父树，再覆盖少量 changed/addition 文件。如果随后把合并树的 mode 与本地完整可写树逐项比较，所有未被 overlay 触及的文件都会被误报为漂移，即使 path、size 和 SHA256 完全一致。

正确做法不是忽略 mode，也不是把整棵树统一 `chmod` 后再猜，而是为 sealed parent 和 signed overlay 建立逐路径投影，并把科学内容等价与部署 mode authority 分层。

本规则适用于任何项目或模型。manifest、receipt 和示例不得写入真实账号、hostname、JobID、数据集身份或物理 GPU 身份。

## 1. 两层 authority 不得混在一起

### 1.1 科学/source-content 等价

判断“候选代码字节是否仍是同一科学实现”时，比较：

```text
path
type
size
SHA256
```

这称为 **mode-stripped content rows**。它证明文件集合和内容相同，不证明部署权限正确。

### 1.2 部署 mode authority

判断“合并后的 incoming/final 是否按部署合同物化”时，比较：

```text
path
type
size
SHA256
mode
```

这里的 mode 不能来自本地完整可写树。唯一 authority 是：

```text
projected[path] =
  signed_overlay[path],  if path is declared by the overlay
  sealed_parent[path],   otherwise
```

因此：

- base-only 路径完整继承 sealed parent row，包括 `0440` 等只读 mode；
- overlay 路径完整采用 signed overlay row，包括普通文件 `0644`、显式 executable `0750` 或该部署政策允许的其他 mode；
- overlay 新增路径直接加入投影；
- overlay 替换已有路径时，path/type/size/SHA256/mode 全部以 signed overlay 为准；
- 未声明 deletion 语义时，任何缺失父路径都 fail-closed；若项目需要 deletion，必须先定义单独、签名且经过正负 fixture 的 tombstone schema，不能把“复制时漏文件”解释为删除。

## 2. 为什么不能比较 local writable full-tree modes

本地候选完整树常因编辑、打包或 checkout 政策呈现：

```text
all ordinary files -> 0644
declared executables -> 0750
```

而 sealed parent 可能是：

```text
all ordinary files -> 0440
declared executables -> 0550
```

若一次 overlay 只改 2 个文件，合并树中其余数百个 base-only 文件仍应保持 sealed mode。拿合并树去和 local full-tree mode 比，会把正确的继承误判为错误。更危险的“修复”是为了让这次比较通过，把 base-only 文件都改成 local writable mode；这会反过来破坏父 seal。

所以 local full tree 只能用于 mode-stripped content comparison：

- local full 与投影的 path/type/size/SHA256 必须相同；
- local full 与投影的 mode 是否相同只作观察字段；
- `local writable full-tree modes used as authority` 必须显式为 `false`；
- 验证器不能存在把 local full mode 替代 projected mode 的 fallback。

## 3. 正确的 prepublication 流程

### 3.1 先冻结三份清单

1. `SEALED_PARENT_MODE_ROWS.json`：父 source 的 exact file rows，包括 mode 与 rows digest；
2. `SIGNED_OVERLAY_MODE_ROWS.json`：只包含 changed/addition 路径，绑定 path/type/size/SHA256/mode 与 rows digest；
3. `LOCAL_FULL_CONTENT_COMPARATOR.json`：本地完整候选树的 rows；它只证明 mode-stripped content closure，不取得 mode authority。

这三份清单都应 write-once，并记录自身 SHA256。overlay 的 declared paths 也必须受签名/哈希约束；不能在复制后通过目录扫描临时扩展 overlay 集合。

### 3.2 建立逐路径投影

按 path 建表：先装载全部 parent rows，再用 overlay rows 完整替换同名 row。保存：

- `parent_rows_sha256`；
- `overlay_rows_sha256`；
- `projected_rows_sha256`；
- `projected_content_rows_sha256`；
- base-only path list/digest；
- overlay path list/digest。

`projected_rows_sha256` 是 deployment-mode authority。`projected_content_rows_sha256` 是科学/source-content 边界。二者不能互相替代。

### 3.3 物化到 unique incoming

1. 创建此前不存在的 unique incoming；
2. 从 sealed parent 复制，并保留 parent mode；
3. 只把 signed overlay 清单中的路径覆盖/新增到 incoming，并保留 overlay manifest mode；
4. 拒绝额外路径、symlink、special file、AppleDouble 和未声明 deletion；
5. 对 incoming 重新扫描 path/type/size/SHA256/mode；
6. 要求 observed rows 与 projected rows exact equality；
7. 要求 local full 的 mode-stripped content rows 与 projected content rows equality；
8. 通过后才允许原子 publish。

复制工具的默认 umask、archive mode 或 `copy`/`rsync` 行为不能作为隐含合同。manifest mode 才是 authority；若复制工具不保留 mode，应在 incoming 内按投影逐路径显式设置，再重新扫描验证。

覆盖一个 `0440` 父文件时，某些平台/复制 API 会尝试原地打开 destination 并因只读 mode 失败。不得为此把父树或 base-only 文件先统一 chmod 为 writable。通用物化方法是：在 incoming 内同一目录创建唯一临时文件，写入 overlay 内容并设置 signed mode，核对 size/SHA256/mode，再用同文件系统 atomic replace 替换该 overlay path。随后仍必须对整个 incoming 重新扫描；单个临时文件校验不能代替投影验证。

## 4. Stage1 必须复现真正的 sealed-parent mode

只在两个本地可写目录之间做 merge smoke，会漏掉本类错误。Stage1 check 必须在外部 disposable root 中构造真实 mode 关系：

```text
sealed parent base-only file: 0440
sealed parent file later replaced by overlay: 0440
overlay ordinary replacement/addition: 0644
overlay declared executable: 0750
local writable full-tree base file: 0644
```

然后执行与正式 operator 同一套：copy parent、apply overlay、project、scan、verify、生成 write-once report。正例应满足：

- base-only `0440` 被保留；
- overlay ordinary `0644` 被采用；
- overlay executable `0750` 被采用；
- local full 与 projected exact rows **不相等**，但 mode-stripped content rows 相等；
- 总体验证 PASS。

如果 Stage1 先把父树复制成 writable mode，或者直接从 local full 构造 candidate，它没有覆盖正式部署的 mode 语义，不得放行 mutation。

## 5. Publish 后的 digest 与后续 seal

原子 rename 本身不应改变 file rows。publish 后必须从 final 路径重新扫描，要求：

```text
postpublish observed rows digest == projected_rows_sha256
```

并写入 write-once `postpublish_projected_rows_digest_sha256`。不能只沿用 prepublish 内存对象或复制前 digest。

若发布后还要执行“整棵 formal source 收紧为 `0440/0550`”的最终 seal，这是另一个明确的 mode transition：

1. 先保存并验证 postpublish projected rows digest；
2. 生成 final-seal policy 与 expected sealed rows digest；
3. 在尚未提交的 final 上逐路径应用；
4. 重新扫描并生成独立 final-seal manifest；
5. 此后 final 不再原地修改。

不能拿 final-seal digest 倒填 projected digest，也不能把两个阶段都叫一个模糊的 “source manifest”。

## 6. 可执行 validator

`scripts/delta-mode-projection.py` 是 Python 3.9+、stdlib-only 的离线工具。它只扫描普通文件；symlink、special file、AppleDouble 或不安全 path 会 fail-closed。先在三个独立 root 上创建 manifests：

```bash
python3 <SKILL_ROOT>/scripts/delta-mode-projection.py create \
  --root <SEALED_PARENT_ROOT> \
  --role sealed_parent \
  --output <EVIDENCE>/SEALED_PARENT_MODE_ROWS.json

python3 <SKILL_ROOT>/scripts/delta-mode-projection.py create \
  --root <SIGNED_OVERLAY_ROOT> \
  --role signed_overlay \
  --output <EVIDENCE>/SIGNED_OVERLAY_MODE_ROWS.json

python3 <SKILL_ROOT>/scripts/delta-mode-projection.py create \
  --root <LOCAL_FULL_ROOT> \
  --role local_full_content_comparator \
  --output <EVIDENCE>/LOCAL_FULL_CONTENT_COMPARATOR.json
```

Stage1、prepublish 或 postpublish 分别调用：

```bash
python3 <SKILL_ROOT>/scripts/delta-mode-projection.py verify \
  --parent-manifest <EVIDENCE>/SEALED_PARENT_MODE_ROWS.json \
  --overlay-manifest <EVIDENCE>/SIGNED_OVERLAY_MODE_ROWS.json \
  --local-full-manifest <EVIDENCE>/LOCAL_FULL_CONTENT_COMPARATOR.json \
  --candidate-root <DISPOSABLE_MERGE_OR_PUBLISHED_ROOT> \
  --phase stage1 \
  --report <WRITE_ONCE_REPORT.json>
```

对 final 路径使用 `--phase postpublish`。只有全部检查通过时，报告才会写入非空 `postpublish_projected_rows_digest_sha256`。工具不复制、不 chmod、不 publish、不 seal，只验证并生成 write-once evidence。

正式 operator 应冻结该工具的 SHA256，并把 report schema/version 纳入其自身协议。项目若已有等价 validator，可以沿用，但必须覆盖本专题列出的所有语义和回归。

## 7. Generated artifact 必须有阶段语义

有些 formal source 在 overlay merge 后还会由 materializer 生成一个 canonical JSON config。这个 config 在 pre-materialization 阶段**不应该存在**，但在 post-materialization 和 post-seal 阶段又是完整 source 的必要成员。一个无阶段语义、默认 `exclude=config` 的通用 inventory 无法同时表达这两个事实。

因此必须使用四个明确阶段：

1. **pre-materialization**：扫描 projected source，canonical generated config 必须不存在；`generated_artifacts=[]`，`excluded_artifacts=[]`；
2. **post-materialization**：显式允许且要求恰好一个 canonical generated config；
3. **post-seal**：把 config 纳入全树 seal projection 与 whole-tree manifest；
4. **post-seal replay**：从实际 final root 独立重扫，逐行 replay whole manifest。

任何清单只要依赖“默认忽略 config”“excluded artifact 不参与比较”或“验证目录时临时减掉 config”，就不能直接充当 post-materialization authority。它可以继续作为 pre-source 的辅助观察，但必须由 phase-aware inventory 重新建立 post-materialization 的完整权威清单。

### 7.1 Pre-materialization 必须拒绝 config

pre-materialization inventory 必须绑定 canonical relative POSIX path，并同时证明：

- 该 path 不在 observed rows；
- source 中没有任何 declared generated artifact；
- excluded-artifact 集合严格为空；
- 剩余 rows 是上一节 projected deployment rows 的 exact path/type/size/SHA256/mode 清单。

若 config 已经存在，不能把它从扫描结果过滤掉后继续 PASS；必须 fail-closed。这能发现重用旧 materialized tree、上次失败残留和阶段顺序反转。

### 7.2 Post-materialization 的唯一新增项

materializer 完成后，phase-aware validator 必须要求：

```text
observed paths = pre non-generated projected paths + {canonical config path}
```

并逐项验证：

- 所有 non-generated projected rows 的 path/type/size/SHA256/mode exact unchanged；
- generated artifact 数量严格等于 `1`；
- config 的 exact path/type/size/SHA256/mode/schema 必须逐字段成立：path 与冻结 canonical path exact，type 为普通文件，size/SHA256/mode 与外部冻结的 config authority exact，JSON 顶层 `schema` 与冻结 expected schema exact；duplicate key、非法 JSON 或缺失 schema 都 FAIL；
- config authority 文件必须位于被验证 source root 之外，防止用实际产物自证实际产物。

这里的 `schema` 是 config 自身的顶层 schema 标识，不是 inventory report schema；两者都必须明确记录。

### 7.3 Post-seal 必须包含 config 并可 replay

seal 是 post-materialization 后的独立 mode transition。validator 从完整 post-materialization rows 生成 sealed projection：普通文件采用显式 ordinary mode，例如 `0440`；原本声明可执行的文件采用显式 executable mode，例如 `0550`。canonical config 也是普通文件，必须进入同一 whole-tree manifest，不能继续作为 excluded artifact。

post-seal 必须验证：

- 全树 path/type/size/SHA256 不变；
- 每个普通/可执行文件的 sealed mode exact；
- config path/type/size/SHA256/schema 不变，sealed mode exact；
- whole rows digest 从实际 sealed root 重新扫描产生；
- 独立 replay 再次从实际 root 扫描，并与保存的 whole manifest exact equality。

“生成 post-seal manifest”与“replay 该 manifest”是两步。只把同一个内存 rows 对象写两次，不构成 replay。

### 7.4 Stage1 必须真实执行转换

Stage1 不能只调用纯函数比较几组 rows。它必须在此前不存在的 unique disposable root 中真实执行：

```text
projected pre-source
  -> copy/materialize disposable source
  -> atomic create canonical generated config
  -> post-materialization inventory
  -> chmod whole tree by explicit seal policy
  -> post-seal whole manifest
  -> independent whole-manifest replay
```

只有最后 replay PASS 后，Stage1 才能创建 write-once `COMPLETE`。任何中途失败保留 disposable partial/evidence，不在同一 scope 重跑覆盖。

### 7.5 可执行 phase validator

`scripts/delta-phase-inventory.py` 是 Python 3.9+、stdlib-only 的阶段化工具。分步调用示例：

```bash
python3 <SKILL_ROOT>/scripts/delta-phase-inventory.py pre-materialization \
  --root <PROJECTED_PRE_SOURCE> \
  --canonical-config-path <RELATIVE_CONFIG_PATH> \
  --output <EVIDENCE>/PRE_MATERIALIZATION_INVENTORY.json

python3 <SKILL_ROOT>/scripts/delta-phase-inventory.py post-materialization \
  --root <MATERIALIZED_SOURCE> \
  --pre-manifest <EVIDENCE>/PRE_MATERIALIZATION_INVENTORY.json \
  --expected-config-file <FROZEN_EXTERNAL_CONFIG_AUTHORITY.json> \
  --expected-schema <EXPECTED_CONFIG_SCHEMA> \
  --expected-mode 0644 \
  --output <EVIDENCE>/POST_MATERIALIZATION_INVENTORY.json

python3 <SKILL_ROOT>/scripts/delta-phase-inventory.py post-seal \
  --root <SEALED_SOURCE> \
  --post-manifest <EVIDENCE>/POST_MATERIALIZATION_INVENTORY.json \
  --sealed-file-mode 0440 \
  --sealed-executable-mode 0550 \
  --output <EVIDENCE>/POST_SEAL_WHOLE_MANIFEST.json

python3 <SKILL_ROOT>/scripts/delta-phase-inventory.py replay-sealed \
  --root <SEALED_SOURCE> \
  --sealed-manifest <EVIDENCE>/POST_SEAL_WHOLE_MANIFEST.json \
  --report <EVIDENCE>/POST_SEAL_WHOLE_MANIFEST_REPLAY.json
```

Stage1 应直接运行真实 round trip：

```bash
python3 <SKILL_ROOT>/scripts/delta-phase-inventory.py stage1-check \
  --pre-root <PROJECTED_PRE_SOURCE> \
  --stage1-root <UNIQUE_DISPOSABLE_STAGE1_ROOT> \
  --canonical-config-path <RELATIVE_CONFIG_PATH> \
  --expected-config-file <FROZEN_EXTERNAL_CONFIG_AUTHORITY.json> \
  --expected-schema <EXPECTED_CONFIG_SCHEMA>
```

`stage1-check` 会真实创建 disposable materialized tree、生成 config、执行 post-inventory、seal 和 replay；目标 Stage1 root 已存在时拒绝复用。正式 operator 仍应冻结工具 SHA256，并把全部 phase report SHA256 纳入 protocol。

## 8. 必须保留的正负回归

### 正例

- parent base-only `0440` + overlay ordinary `0644` + overlay executable `0750`，candidate 按逐路径投影物化：PASS；
- local full 把 base-only 表示为 `0644`，因此 local exact mode equality 为 false，但 path/type/size/SHA256 相同：仍 PASS；
- postpublish rescan 的 rows digest 与 projected rows digest 相同，并生成 `postpublish_projected_rows_digest_sha256`：PASS。
- pre source 不含 config；disposable materialization 只新增一个 canonical config；non-generated projected rows exact unchanged；config 的 path/type/size/SHA256/mode/schema exact；全树 seal 后 config 变为 ordinary sealed mode；独立 whole-manifest replay：PASS。

### 负例

- parent/overlay 的 `mode/content/path/size tamper` 都是必须保留的独立负回归，不能只用一个笼统的“manifest mismatch”代替；
- candidate 直接复制 local writable full tree，使 base-only 从 `0440` 变成 `0644`；即使它与 local full exact equality，也必须 FAIL；
- parent manifest 的 base-only mode、content SHA、path 或 size 任一被篡改：FAIL；
- overlay manifest 的 mode、content SHA、path 或 size 任一被篡改：FAIL；
- candidate/incoming/final 的 path、size、content 或 mode 任一不符合投影：FAIL；
- postpublish root 与 projected rows digest 不同：FAIL，且不得生成成功 digest；
- manifest rows digest 不匹配、重复 path、额外 path、AppleDouble、symlink 或 special file：FAIL；
- report 已存在：拒绝覆盖。
- pre-materialization 已存在 canonical config：FAIL，不能通过 exclude 隐藏；
- post-materialization 缺 config、出现额外 generated path、non-generated row 漂移，或 config 的 path/type/size/SHA256/mode/schema 任一漂移：FAIL；
- generic file-set manifest、默认 excluded-artifact manifest 或 `excluded_artifacts` 非空的 phase manifest 直接用于 post-materialization：FAIL；
- post-seal 漏掉 config、config 未 seal、任一 whole-tree row 漂移或 replay 漂移：FAIL；
- Stage1 只比较静态 rows、未真实 materialize config、未 seal 或未 replay：不得放行。

这些回归不仅测试“验证器能发现坏文件”，还必须测试“错误的 authority 选择”本身：naive local-full equality 不能替代 projected equality。

## 9. 失败 identity 与证据保留

只要 prepublication controller 已创建 attempt root、partial receipt 或 `.incoming.<identity>`，这个 identity 就已经是审计证据。即使没有 Slurm job、optimizer step、Validation 或科学产物，也必须：

- 保留旧 partial root、incoming、stdout/stderr、manifest 和 failure receipt；
- 不删除 incoming，不在原路径补 chmod/补文件，不覆盖旧 report；
- 为修复创建新的 **完整 execution identity**：source、preflight、incoming、formal final、run/log namespace 和 controller scope 都使用下一唯一 identity；
- 新 identity 绑定 parent failure receipt SHA256、根因分类、operator patch SHA256 和重新生成的全部 manifests；
- 不只换 recovery-id；不能继续沿用带有旧失败语义的 execution/source/final identity。

“还没提交 Slurm”只说明没有科学 mutation，不意味着旧 deployment identity 可以重用。完整换 identity 能避免 partial evidence 与新执行混在一起，也能让后续审计明确区分工程重试和科学实验身份。

这里的 identity 规则同样覆盖 phase-inventory failure：只要 prelaunch controller 已创建 source/preflight/incoming/formal-final/run/log/controller 中任一 partial scope，修复就必须换下一套**完整 execution identity**。不能只换 Stage1 root、recovery-id 或 config receipt 名称，同时继续沿用旧 execution/source/final identity。

## 10. 最终自检

- [ ] 科学/source-content 等价只比较 path/type/size/SHA256。
- [ ] deployment authority 比较 path/type/size/SHA256/mode。
- [ ] base-only 完整继承 sealed parent row；overlay 完整采用 signed row。
- [ ] local writable full-tree modes 明确不是 authority。
- [ ] Stage1 disposable merge 真正构造 `0440` parent 与 `0644/0750` overlay。
- [ ] candidate、prepublish 和 postpublish 都按投影重新扫描，而不是复用内存 rows。
- [ ] postpublish projected rows digest write-once 且与实际 final rescan 相同。
- [ ] final seal 若存在，是单独、有 manifest 的 mode transition。
- [ ] pre-materialization inventory 拒绝 canonical generated config，且 excluded artifacts 为空。
- [ ] post-materialization 显式要求唯一 config，并逐项验证 path/type/size/SHA256/mode/schema。
- [ ] 所有 non-generated projected rows 在 materialization 前后 exact unchanged。
- [ ] post-seal whole manifest 包含 config，并从实际 root 独立 replay。
- [ ] Stage1 真实执行 disposable materialize → post-inventory → seal → replay。
- [ ] 通用 exclude-based inventory 未被当作 post-materialization authority。
- [ ] 所有指定正负回归通过。
- [ ] prepublication partial/incoming 保留；修复使用新的完整 execution identity，而非只换 recovery-id。
