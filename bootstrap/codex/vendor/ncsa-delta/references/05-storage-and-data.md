# 存储、500G/1.5T 布局、数据迁移与 I/O

## 1. 当前文件系统角色

| 文件系统 | 典型路径 | 常见配额/容量 | 快照/清理 | 用途 |
|---|---|---|---|---|
| HOME | `/u/$USER` | 100 GB、750k 文件/用户 | 有每日快照；不 purged | 小配置、脚本、源码、job 文件；不用于作业重 I/O |
| PROJECTS | `/projects/<project>` | 默认 500 GB，可申请 1–25 TB | 无可靠快照、不 purged | 共享权威数据、软件、稳定结果 |
| WORK HDD | `/work/hdd/<project>` | 默认 1 TB，可申请更大，包括 1.5 TB | 无快照、不 purged | 计算 I/O、活跃实验、大数据、中间结果 |
| WORK NVMe | `/work/nvme/<project>` | 申请制 | 无快照 | 大量小文件或高 IOPS 工作负载 |
| node-local | `/tmp` | CPU约0.74 TB；多数GPU约1.5 TB；H200约2 TB | 每作业后清除 | 本次作业高速临时 I/O；每节点独立 |

`/projects` 和 `/work` 没有可依赖的备份。删除或覆盖后通常无法恢复。HOME 快照与主数据同一系统，不是灾备。

## 2. 识别用户说的“500G + 1.5TB”

先执行：

```bash
quota
printf 'WORK=%s\nSCRATCH=%s\n' "${WORK-}" "${SCRATCH-}"
readlink -f "${WORK-}" 2>/dev/null || true
readlink -f "${SCRATCH-}" 2>/dev/null || true
```

对候选路径：

```bash
df -hT /projects/<PROJECT> /work/hdd/<PROJECT>
stat -f -c '%T %S %b %a' /projects/<PROJECT> /work/hdd/<PROJECT>
```

`df` 反映挂载或文件系统视图，Lustre 的 `lazystatfs` 等设置可能使它看起来与项目 entitlement 不一致；账户实际 block/file 配额以 `quota` 为准，`df` 只辅助确认文件系统类型和当前挂载可用性。

在实际 GPU allocation 内：

```bash
df -hT /tmp
findmnt /tmp
```

判断：

- `quota` 显示 `/projects/<P>` limit 500G：这是持久项目盘；
- `quota` 显示 `/work/hdd/<P>` limit 1.5T：这是持久 work 盘；
- 只有计算节点 `df /tmp` 显示约 1.5T，而 `quota` 不列它：这是作业本地临时盘。

不能称 `/tmp` 为“第二块持久盘”，也不能从登录节点 `/tmp` 容量推断计算节点本地盘。

## 3. 推荐目录树

`quota` 显示的是 allocation 根目录配额；实际工作优先使用现场已提供的个人子目录：

```bash
PROJECT=/projects/<PROJECT>/$USER
WORK=/work/hdd/<PROJECT>/$USER
NVME=/work/nvme/<PROJECT>/$USER

for root in "$PROJECT" "$WORK"; do
  [[ -d "$root" && -r "$root" && -w "$root" && -x "$root" ]] || {
    printf 'Missing or inaccessible storage root: %s\n' "$root" >&2
    exit 2
  }
done

mkdir -p "$PROJECT"/{code,env-locks,containers,datasets/source,checkpoints/best,results/final}
mkdir -p "$WORK"/{datasets/processed,runs,checkpoints/latest,caches,logs,tmp}
if [[ -d "$NVME" && -r "$NVME" && -w "$NVME" && -x "$NVME" ]]; then
  mkdir -p "$NVME"/{hot-cache,small-file-shards,io-intensive-tmp}
fi
```

`/projects/<PROJECT>/shared` 等项目根目录下的共享树只用于明确的团队协作内容。不要把个人 runs、cache 和高频 checkpoint 混到共享根目录；若没有个人子目录，先核实项目约定和权限再选路径。

### `/projects` 放什么

- Git 工作树或发布 snapshot；
- `environment.yml`、lockfile、容器 definition；
- 稳定 `.sif`；
- 原始/权威数据，尤其不可轻易重建者；
- 最佳 checkpoint 与最终结果；
- README、数据字典、provenance、校验和。

### `/work/hdd` 放什么

- 预处理/增强后的可重建数据；
- 活跃 experiment run 目录；
- 每 N 步 checkpoint；
- Hugging Face/Torch/pip/Conda/Apptainer cache；
- 大日志、临时 shard、编译目录；
- 可以按策略清理的旧 runs。

### `/tmp` 放什么

- 解包后的百万小文件；
- dataloader cache；
- 临时数据库、排序、shuffle shard；
- 容器 overlay/build temp；
- 单次作业 output staging。

任何唯一副本都不应只在 `/tmp`。

## 4. 每个作业使用唯一 local scratch

```bash
LOCAL_BASE=${SLURM_TMPDIR:-/tmp/$USER/$SLURM_JOB_ID}
umask 027
mkdir -p "$LOCAL_BASE"/{input,cache,output}
```

不要直接写 `/tmp/data`，会与同节点其他用户/作业冲突。不要假定 `$SLURM_TMPDIR` 一定存在；用 fallback。

检查空间：

```bash
df -h "$LOCAL_BASE"
```

节点共享时可用空间可能小于名义 1.5 TB。

## 5. 单节点 staging 模式

```bash
set -Eeuo pipefail
SRC=/work/hdd/<PROJECT>/$USER/datasets/processed/myset
DEST=/work/hdd/<PROJECT>/$USER/runs/$SLURM_JOB_ID
LOCAL=${SLURM_TMPDIR:-/tmp/$USER/$SLURM_JOB_ID}
mkdir -p "$LOCAL/input" "$LOCAL/output" "$DEST"

rsync -a --partial "$SRC/" "$LOCAL/input/"

copy_back() {
  local reason=${1:-periodic}
  rsync -a --partial "$LOCAL/output/" "$DEST/"
  printf 'copy-back=%s reason=%s\n' "$(date -Is)" "$reason" >&2
}

# 最简单、可靠的基线是应用周期性 checkpoint 到共享盘，并在正常结束后最终同步。
# 需要在 USR1 时由 shell 同步，必须采用 stage-local-tmp.slurm 中的“后台 srun +
# 可中断 wait + 显式信号转发”模式；不要只给前台 srun 外层加 B: trap。
srun python train.py --data "$LOCAL/input" --output "$LOCAL/output"
copy_back normal
```

注意：SIGKILL、节点断电、文件系统故障时 trap 不保证执行。重要 checkpoint 应周期性直接写共享盘或异步复制，而不是只在结尾 copy-back。

## 6. 多节点 staging

`/tmp` 在每节点独立。需要每节点执行一次 stage：

```bash
srun --ntasks="$SLURM_NNODES" --ntasks-per-node=1 bash -lc '
  set -euo pipefail
  local_dir=${SLURM_TMPDIR:-/tmp/$USER/$SLURM_JOB_ID}
  mkdir -p "$local_dir/input"
  rsync -a --partial /work/hdd/<P>/$USER/datasets/processed/myset/ "$local_dir/input/"
  hostname; du -sh "$local_dir/input"
'
```

这会让所有节点同时从共享盘读取，可能形成 I/O burst。对大数据：

- 分批/错峰；
- 每节点只 stage 自己 shard；
- 使用 `sbcast` 仅适合较小文件；
- 先测总 staging 时间并计入 walltime。

输出 copy-back 要避免所有 rank 写同一文件。使用 per-rank/per-node 子目录，最后由 rank 0 合并。

## 7. 原子 checkpoint

单文件：

```python
# 伪代码
save("checkpoint.tmp")
fsync_and_close()
os.replace("checkpoint.tmp", "checkpoint-step-001000.pt")
atomic_update_latest_pointer()
```

目录/sharded checkpoint：写到新目录，完成后写 `_SUCCESS` marker，再更新 `latest`。恢复时只选择有完成 marker 的 checkpoint。

多个作业共用同一 `latest.pt` 会竞态；路径必须含 run ID/JobID。

## 8. 配额与 inode

```bash
quota
```

不要用全盘 `du -sh /work/hdd/<project>` 作为频繁监控，可能对共享文件系统造成大量 metadata I/O。针对个人目录中的特定 run：

```bash
du -sh /work/hdd/<P>/$USER/runs/<RUN>
find /work/hdd/<P>/$USER/runs/<RUN> -xdev -type f -printf '.' | wc -c
```

仅在必要时执行。更好是在程序中记录产出文件数。

策略：

- 留 10%–20% 空间；
- 设 run retention policy；
- 保留 best/final，清理可重建 cache；
- 不在共享目录无限写 TensorBoard event、小 checkpoint；
- 合并小文件为适当 shard。

## 9. 小文件问题

百万小文件会消耗 inode，并让 Lustre metadata 成为瓶颈。候选格式：

- tar shard / WebDataset；
- SquashFS（只读数据集）；
- LMDB；
- HDF5；
- Zarr（合理 chunk，不是每元素一文件）；
- Parquet shard。

选择依赖并发读写、随机访问、压缩和崩溃恢复。先在小子集验证，不盲目把所有数据打成单个超大不可并发文件。

## 10. 缓存环境变量

```bash
export CACHE_ROOT=/work/hdd/<P>/$USER/caches
mkdir -p "$CACHE_ROOT"/{pip,conda,huggingface,torch,apptainer,xdg}
export PIP_CACHE_DIR="$CACHE_ROOT/pip"
export CONDA_PKGS_DIRS="$CACHE_ROOT/conda"
export HF_HOME="$CACHE_ROOT/huggingface"
export TORCH_HOME="$CACHE_ROOT/torch"
export APPTAINER_CACHEDIR="$CACHE_ROOT/apptainer"
export XDG_CACHE_HOME="$CACHE_ROOT/xdg"
```

共享 cache 可能发生并发写和版本冲突。按用户、框架版本或容器 digest 分隔。cache 是可重建的，不应放 `/projects` 最宝贵空间。

## 11. 文件系统 constraint

NCSA 希望作业声明依赖的文件系统。当前文档表：

```text
/projects   -> projects
/work/hdd   -> work
/taiga      -> taiga
/ime        -> ime（且依赖 work）
```

先检查实时 feature：

```bash
sinfo -N -o '%N|%P|%f' | head -50
```

如果标签存在：

```bash
#SBATCH --constraint="projects&work"
```

文档某些旧示例写 `scratch`，但当前 `/work/hdd` 表项是 `work`。只有 live feature 确认后才使用 `scratch`。

## 12. 传输

### 小到中等

```bash
rsync -avP local_dir/ <USER>@login.delta.ncsa.illinois.edu:/projects/<P>/<USER>/incoming/
```

或反向。`-P` 包含 partial/progress。不要默认 `--delete`。

### macOS 到 Delta：同时禁用 copyfile/xattrs，并严格校验 file set

macOS 的 archive/copyfile 机制可以把 Finder metadata/resource fork 编码成 AppleDouble `._*` 文件。已观察到：即使 tar 发送端加了 `--no-xattrs`，Linux/Delta 解包后仍可能出现 `._*`。因此发送端必须同时使用：

```bash
COPYFILE_DISABLE=1 tar --no-xattrs ...
```

不能只做 `sha256sum -c`：它会证明预期文件正确，但不会拒绝额外 `._*`。使用随 skill 附带、Python 3.9 stdlib-only 的 exact file-set 工具：

```bash
# 1. Mac 源端在 source root 外生成 immutable content + file-set manifest。
python3 <SKILL_ROOT>/scripts/delta-fileset-manifest.py create \
  --root <MAC_SOURCE_ROOT> \
  --output <MAC_EVIDENCE_ROOT>/EXPECTED_FILESET.json

# 2. Delta 只创建本 attempt 唯一且不已存在的 incoming。
ssh <DELTA_ALIAS> \
  'test ! -e <DELTA_INCOMING> && test ! -e <DELTA_FINAL> && mkdir -p <DELTA_INCOMING>/payload'
ssh <DELTA_ALIAS> 'cat > <DELTA_INCOMING>/EXPECTED_FILESET.json' \
  < <MAC_EVIDENCE_ROOT>/EXPECTED_FILESET.json

# 3. COPYFILE_DISABLE 与 --no-xattrs 缺一不可。Mac 不生成 AppleDouble。
COPYFILE_DISABLE=1 tar --no-xattrs -C <MAC_SOURCE_ROOT> -cf - . \
  | ssh <DELTA_ALIAS> 'tar --no-same-owner -C <DELTA_INCOMING>/payload -xf -'

# 4. Delta 对路径类型、缺失、多余、size、SHA256、symlink target
#    以及所有 ._* 做严格验证。
ssh <DELTA_ALIAS> \
  'python3 ~/.agents/skills/ncsa-delta/scripts/delta-fileset-manifest.py verify \
     --root <DELTA_INCOMING>/payload \
     --manifest <DELTA_INCOMING>/EXPECTED_FILESET.json \
     --report <DELTA_INCOMING>/FILESET_VERIFICATION.json'

# 5. 只有上一条返回 0 后才能原子发布；final 已存在就停止。
ssh <DELTA_ALIAS> \
  'test ! -e <DELTA_FINAL> && mv <DELTA_INCOMING> <DELTA_FINAL>'
```

`delta-fileset-manifest.py create` 在 Mac 源目录已含 `._*` 时也会失败。`verify` 任何失败都返回非零并写 immutable report；此时必须只保留/隔离该唯一 incoming 用于诊断，不能生成 final，不能覆盖已有 final，也不能删除失败证据后在同一 incoming 原地重来。

### Delta 到另一台 Linux 服务器的可审计归档

当 Mac 只是调度端，不要默认先把 Delta 目录 rsync 到 macOS 再上传。macOS 接收 Linux/Delta 目录时已观察到 `fchmodat`/ACL 错误；即使加 `--no-perms`，rsync 仍可能在其他 metadata 步骤失败。对 Delta 到 server94 这类跨远端归档，优先让 Mac 只转发 tar byte stream，不在 Mac 文件系统落盘/重解压。

安全顺序（所有占位符先替换为经过验证的绝对路径）：

1. 在源端对归档根目录生成相对路径 SHA256 manifest；
2. 目标端创建本 attempt 专有、不已存在的 `incoming` 目录；
3. 用 `ssh <DELTA_ALIAS> tar ... | ssh <SERVER94_ALIAS> tar ...` 直接传输；
4. 将源 manifest 单独写到 incoming，在目标端同时验证 checksum 和 exact file set；
5. 保存校验原始输出/JSON，只在全部 PASS 后将 incoming **同文件系统原子 rename** 为最终名；
6. 再验证最终路径，然后才能在获得授权后清理 Delta 中转副本。

结构示意：

```bash
# 在 Mac 上运行；只是结构示意，先将占位符替换为已验证的精确路径。
# 源 manifest：内容中的文件名相对于 <DELTA_SOURCE_ROOT>。
ssh <DELTA_ALIAS> \
  'cd <DELTA_SOURCE_ROOT> && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum' \
  | ssh <SERVER94_ALIAS> 'cat > <INCOMING_ROOT>/SHA256SUMS'

# Mac 不解包，只管道转发 tar stream。
ssh <DELTA_ALIAS> 'tar -C <DELTA_SOURCE_ROOT> -cf - .' \
  | ssh <SERVER94_ALIAS> 'tar --no-same-owner -C <INCOMING_ROOT>/payload -xf -'

# 目标端确认 manifest，保留原始校验输出，然后原子 rename。
ssh <SERVER94_ALIAS> \
  'cd <INCOMING_ROOT>/payload && sha256sum -c ../SHA256SUMS | tee ../SHA256SUMS.verify.txt'
ssh <SERVER94_ALIAS> \
  'test ! -e <FINAL_ROOT> && mv <INCOMING_ROOT> <FINAL_ROOT>'
```

`<INCOMING_ROOT>` 与 `<FINAL_ROOT>` 必须同父目录/同文件系统，否则 `mv` 不是原子 rename。建立 incoming 和 `payload` 的命令应先单独执行并确认目标不存在；不得通过覆盖旧 incoming/final 来“重试”。

### Mac zsh 编排的特殊变量陷阱

zsh 中的 `path` 是与 `PATH` 双向绑定的特殊数组。下列写法会破坏命令搜索路径：

```zsh
for path in ...; do
  ...
done
```

后续 `ssh`、`rsync`、`sha256sum` 可能全部变成 `command not found`。使用 `artifact_path`、`source_path`、`receipt_file` 等普通变量名，并在长编排脚本开头记录：

```zsh
command -v ssh rsync sha256sum tar
```

如果已误覆盖，退出该 shell/子 shell 重建环境；不要在一个已损坏的 `PATH` 中不断尝试改命令。

### 大数据

使用 Globus：

- `NCSA Delta`：NCSA identity；
- `ACCESS Delta`：ACCESS identity。

大传输可重试、校验且不把负担长期放在登录 shell。传输后用 manifest/checksum 验证。

### 校验

```bash
find dataset -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
sha256sum -c SHA256SUMS
```

对 PB/超大数据全量校验成本高，采用来源 manifest、分层抽样或 Globus checksum；校验本身也应在计算/数据节点合理运行。

## 13. 权限与共享

```bash
umask 027
mkdir -p /projects/<P>/shared
chmod 2770 /projects/<P>/shared
```

`2` 设置 setgid，使新文件继承项目组。先确认项目组名和协作需求。不要 `chmod -R 777`。

对外 Globus 共享使用专门子目录，避免暴露整个项目树。敏感数据遵循项目的数据使用协议，不因技术上可共享就自动公开。

## 14. 备份与项目到期

Delta 不提供长期归档。ACCESS 用户若不再属于任何 active Delta 项目，访问可能被移除；项目到期后通常只有约 30 天 data-management grace period。应在到期前：

- 导出最终结果；
- 保存代码 commit、环境 lock、容器 digest；
- 通过 Globus 复制重要数据到长期存储；
- 验证目标端校验和；
- 不把 `/projects`/`/work` 当永久档案库。

## 15. 安全清理

先列清单和大小，再删除：

```bash
find /work/hdd/<P>/$USER/runs -mindepth 1 -maxdepth 1 -type d -mtime +30 -print
```

不要让 Codex直接执行生成的 `rm -rf`。推荐移动到带日期的 quarantine，再由用户复核：

```bash
mkdir -p /work/hdd/<P>/$USER/quarantine/2026-08-10
mv <confirmed-old-run> /work/hdd/<P>/$USER/quarantine/2026-08-10/
```

确认备份和路径后再删除。绝不变量未检查就执行 `rm -rf "$DIR"`。
