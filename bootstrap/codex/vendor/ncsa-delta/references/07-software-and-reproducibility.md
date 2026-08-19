# 软件环境、Conda、Apptainer、Jupyter 与复现

## 1. 环境选择优先级

1. NCSA 提供且满足需求的 Lmod module；
2. 版本固定的 Apptainer/NGC 容器；
3. `/projects` 或 `/work/hdd` 中的前缀 Conda 环境；
4. 项目内 venv/wheelhouse；
5. 最后才在作业启动时安装依赖。

目标不是“今天能 import”，而是几周后仍能重跑并知道用了什么。

## 2. Lmod

```bash
module reset
module list
module spider pytorch
module spider cuda
module -t avail 2>&1 | less
```

`module spider` 比硬编码记忆中的版本可靠。CPU-only build 时避免意外加载 CUDA 模块导致链接 GPU library。

作业日志：

```bash
module list 2>&1
which python || true
python -VV || true
which gcc || true
gcc --version | head -1 || true
```

不要在 `.bashrc` 中无条件加载大量 module/Conda env，可能污染 batch。交互配置应检测 interactive shell。

### 2.1 PyTorch 2.8/cu128 wrapper 的已知 hidden-dependency 故障

2026-08-11 在 Delta RH9 登录节点实测：

```bash
module spider pytorch-conda/2.8
```

会说 wrapper 可直接 load，但实际：

```bash
module --ignore_cache load cudatoolkit/25.3_12.8 pytorch-conda/2.8
```

仍会因下列 hidden dependency 失败：

```text
python/.conda-env/pytorch/2.8-cu128
```

原因是 wrapper `/sw/rh9.4/user/modules/pytorch-conda/2.8.lua` 请求该模块，但对应目录不在默认 MODULEPATH。`--ignore_cache` 仅让 Lmod 重查当前可见路径，不会自动暴露 hidden module tree。

已验证 fallback：

```bash
module reset
module use /sw/rh9.4/user/modules/python/.conda-env
module --ignore_cache load cudatoolkit/25.3_12.8
module --ignore_cache load pytorch/2.8-cu128
```

登录节点实测得到：

```text
Python             3.11.13
Python executable  /sw/rh9.4/user/python/conda-env/pytorch-2.8-cu128/bin/python
Python prefix      /sw/rh9.4/user/python/conda-env/pytorch-2.8-cu128
Torch              2.8.0+cu128
Torch CUDA build   12.8
Torch origin       /sw/rh9.4/user/python/conda-env/pytorch-2.8-cu128/lib/python3.11/site-packages/torch/__init__.py
```

登录节点没有 GPU，因此那里 `torch.cuda.is_available() == False` 是正常的，不能用来证明 compute runtime。提交前必须在登录节点执行完整 load/import/origin probe；作业开始后必须在 allocation 内再执行 compute probe，要求同一组 version/origin 并且 CUDA 可用。`module spider`、静态 lint 和 `sbatch --test-only` 都不会执行这个 import，不能代替探针。

使用技能内的严格脚本：

```bash
# 先复制到当前 attempt 的 immutable source root 并记录 SHA256
cp <SKILL_ROOT>/scripts/delta-load-pytorch-2.8-cu128.sh <FROZEN_SOURCE>/
cp <SKILL_ROOT>/scripts/delta-pytorch-runtime-receipt.py <FROZEN_SOURCE>/
sha256sum <FROZEN_SOURCE>/delta-*pytorch* > <FROZEN_PREFLIGHT>/ENV_HELPERS.SHA256

# 登录节点真正加载并生成 immutable receipt
bash <FROZEN_SOURCE>/delta-load-pytorch-2.8-cu128.sh \
  --phase login --receipt <FROZEN_PREFLIGHT>/PYTORCH_LOGIN_RUNTIME.json

# batch 正文：在同一 srun 内验证后 exec 主程序
srun bash <FROZEN_SOURCE>/delta-load-pytorch-2.8-cu128.sh \
  --phase compute \
  --receipt <RUN_ROOT>/PYTORCH_COMPUTE_RUNTIME.json \
  --login-receipt <FROZEN_PREFLIGHT>/PYTORCH_LOGIN_RUNTIME.json \
  -- python -u train.py ...
```

receipt 已存在时脚本会拒绝覆盖。这是故意的：修复/重跑必须换新 attempt identity，不得改写旧证据。

### 2.2 数值 runtime、加载路由与 claim boundary

login 节点和 compute 节点的 Lmod 可见性/缓存可能不同：前者可能走 hidden-module `fallback`，后者反而能解析公开 `wrapper`，或反过来。因此 receipt 必须把字段分为两层：

- **fail-closed 数值 runtime parity**：`python_version`、`python_executable`、`python_executable_resolved`、`python_prefix`、`torch_version`、`torch_file`、`torch_cuda_version`；
- **观测性加载证据**：`load_method`、`wrapper_rc`、`module_list`。

第二类字段必须原样写入 receipt，并可由 `observations_differing_from_login` 显示差异，但不得生成 `matches_login_*` 失败也不参与 `passed`。只有第一类字段和 compute CUDA 能力决定是否为同一预定数值 runtime。

本规则修复的具体故障模式是：login receipt 走 fallback，后续 compute 节点走 wrapper；Python `3.11.13`、Torch `2.8.0+cu128`、CUDA `12.8`、executable/prefix/Torch origin 全部精确相同，但旧门禁因 `load_method` 不同让4个正式 cell 在0个 formal step 前以 exit 3 结束。这是 **pre-formal infrastructure false rejection**，不是模型效果或科学结果。

仅当 login 和 compute receipt 的核心 runtime 字段精确匹配，才能把 wrapper/fallback 变化解释为“同一数值环境的加载路由变化”，而非变更科学 runtime。任一核心字段不符时：

- 立即停止，不运行主程序；
- 将其标记为环境不匹配，不是 matched retry；
- 若需继续，建立新的科学 attempt/contract。

即使 receipt 完全匹配，它也只证明所列运行时标识一致，不自动保证 GPU kernel 的 bitwise determinism、数据顺序、随机数状态或最终科学结果一致。这些仍需单独的 deterministic probe/科学 validator。

### 2.3 Skill 工具的 Python 3.9 与项目语义 runtime 是两条边界

Delta 登录节点裸 `python3` 在 2026-08-11 实测为 `3.9.18`。它足够运行本 skill 中刻意仅使用 stdlib、支持 Python 3.9 的基础设施工具：

- `delta-cost.py`；
- `delta-time-advisor.py`；
- `delta-lint.py`；
- `delta-fileset-manifest.py`。

这不意味着裸 `python3` 可以执行项目代码。例如 `@dataclass(slots=True)` 是 Python 3.10+ 功能；在 Python 3.9 导入时会以类似下列错误失败：

```text
TypeError: dataclass() got an unexpected keyword argument 'slots'
```

任何会 import 项目包、解析项目 dataclass/config、调用 validator 或执行项目语义的提交前 preflight，必须与生产程序使用同一 frozen loader：

```bash
bash <FROZEN_SOURCE>/delta-load-pytorch-2.8-cu128.sh \
  --phase login \
  --receipt <FROZEN_PREFLIGHT>/PROJECT_SEMANTIC_PREFLIGHT_RUNTIME.json \
  -- python -m <PROJECT_PREFLIGHT_MODULE> ...
```

loader 会先生成精确 Python `3.11.13`/Torch/CUDA-build/origin receipt，然后在同一环境中 `exec` 项目 preflight。不得采用这种不对称流程：

```text
裸 Python 3.9 做项目预检 → 仅正式 srun 切到 Python 3.11.13
```

这不只可能导致假失败；也可能让预检和生产程序看到不同导入路径、类定义或依赖。项目 semantic preflight receipt 应与 source manifest、lint 和 test-only 原文一起冻结。

## 3. Conda 环境位置

不放 `$HOME`：

```bash
ENV=/projects/<P>/$USER/envs/myenv-2026-08
conda create --prefix "$ENV" python=3.12
conda activate "$ENV"
```

稳定、共享、较小的 env 可放 `/projects`；巨大、可重建 env 可放 `/work/hdd`。将包缓存放 work：

```bash
export CONDA_PKGS_DIRS=/work/hdd/<P>/$USER/caches/conda-pkgs
mkdir -p "$CONDA_PKGS_DIRS"
```

记录：

```bash
conda env export --prefix "$ENV" --from-history > /projects/<P>/$USER/env-locks/myenv.from-history.yml
conda list --explicit --prefix "$ENV" > /projects/<P>/$USER/env-locks/myenv.explicit.txt
python -m pip freeze > /projects/<P>/$USER/env-locks/myenv.pip-freeze.txt
```

`from-history` 更便于跨平台重建，`explicit` 更精确但平台/通道绑定；两者都保留。

## 4. Batch 中激活 Conda 的三种方式

NCSA 当前文档建议：在已激活自建环境的 shell 中提交，让 batch 继承环境，不在脚本中 `conda activate`。示例：

```bash
conda activate /projects/<P>/$USER/envs/myenv
sbatch job.slurm
```

这种方式简单，但依赖提交 shell。更明确的替代方式需现场测试：

```bash
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate /projects/<P>/$USER/envs/myenv
srun python ...
```

或：

```bash
srun conda run --no-capture-output -p /projects/<P>/$USER/envs/myenv python -u train.py
```

无论使用哪种，都在日志验证：

```bash
which python
python -VV
python - <<'PY'
import sys
print(sys.executable)
print(sys.prefix)
PY
```

不要同时继承一个 env、再激活另一个、再加载冲突 module。

## 5. pip 与 wheelhouse

避免每个作业启动时联网 `pip install`。构建 wheelhouse：

```bash
python -m pip download -r requirements.txt \
  -d /work/hdd/<P>/$USER/wheelhouse
python -m pip install --no-index \
  --find-links /work/hdd/<P>/$USER/wheelhouse \
  -r requirements.txt
```

GPU extension wheel 与 Python/CUDA/ROCm/编译器/架构相关。A100/H200 同为 NVIDIA 但 compute capability 不同；自定义 kernel 应包含目标 arch 或运行时编译策略。

不使用 `pip install --user` 堆满 `$HOME/.local`，这会造成不可见依赖和 quota 问题。

## 6. Apptainer

现场：

```bash
command -v apptainer
apptainer --version
```

NVIDIA：

```bash
apptainer exec --nv \
  --bind /projects/<P>/$USER:/projects/<P>/$USER,/work/hdd/<P>/$USER:/work/hdd/<P>/$USER \
  /projects/<P>/$USER/containers/image.sif \
  python -u train.py
```

AMD：

```bash
apptainer exec --rocm ... image.sif python ...
```

先在 MI100 allocation 内验证 host ROCm 与容器兼容。

缓存：

```bash
export APPTAINER_CACHEDIR=/work/hdd/<P>/$USER/caches/apptainer
export APPTAINER_TMPDIR=/work/hdd/<P>/$USER/tmp/apptainer
mkdir -p "$APPTAINER_CACHEDIR" "$APPTAINER_TMPDIR"
```

大 build 可把 `APPTAINER_TMPDIR` 指到计算节点 local `/tmp`，但最终 `.sif` 必须复制回持久盘。

## 7. NGC 镜像

NCSA 会提供部分 NVIDIA NGC 镜像，目录/版本会更新：

```bash
find /sw/external/NGC -maxdepth 1 -type f -o -type l 2>/dev/null | sort | head -100
```

不要把文档中的旧镜像标签当“最新”。选择后记录完整路径、文件 checksum：

```bash
sha256sum /sw/external/NGC/<image> > /projects/<P>/$USER/env-locks/<image>.sha256
```

系统镜像可能被更新/移除。关键长期复现可在许可允许的前提下将固定 `.sif` 保存到项目空间。

## 8. 容器 bind 与 HOME

Apptainer通常自动 bind `$HOME`，这可能让容器意外读取用户 `.local`、cache 或配置。提高复现性：

- 显式 bind 项目/work；
- cache 指到 work；
- 避免容器依赖 HOME 中未记录的包；
- 必要时使用干净环境选项并现场测试；
- 不把 secret bake 进 image。

输出目录需容器内可见且可写。

## 9. CUDA/驱动/框架核实

在 NVIDIA allocation 内：

```bash
nvidia-smi
nvidia-smi -L
python - <<'PY'
import torch
print('torch', torch.__version__)
print('cuda build', torch.version.cuda)
print('available', torch.cuda.is_available())
if torch.cuda.is_available():
    print(torch.cuda.get_device_name(0))
    print(torch.cuda.get_device_capability(0))
PY
```

容器内 CUDA user-space 需与 host driver 兼容。不要仅看 `nvcc --version` 推断 PyTorch 实际使用的 CUDA。

ROCm：

```bash
rocm-smi
python - <<'PY'
import torch
print(torch.__version__)
print(getattr(torch.version, 'hip', None))
print(torch.cuda.is_available())
PY
```

PyTorch 在 ROCm 上仍使用 `torch.cuda` API 名称，这是框架接口，不表示底层是 NVIDIA。

## 10. 编译

大规模编译申请 CPU interactive：

```bash
srun -A <CPU_ACCOUNT> -p cpu-interactive \
  --nodes=1 --ntasks=1 --cpus-per-task=32 --mem=64G \
  --time=01:00:00 --pty bash -l
```

在 local `/tmp` build 可减少小文件 I/O，完成后安装到 `/projects`/`/work`。记录 compiler、CMake、module、flags、Git commit。

不要在 A100 编译出的 `-march=native` CPU binary 未测试就拿到 H200 Intel 节点；A100/A40 主机是 AMD，H200 主机是 Intel。跨节点 CPU 指令集应采用兼容 target 或分别构建。

## 11. 复现 manifest

每次生产作业写：

```bash
RUN_META=/work/hdd/<P>/$USER/runs/$SLURM_JOB_ID/meta
mkdir -p "$RUN_META"
{
  date -Is
  hostname -f
  uname -a
  echo "job=$SLURM_JOB_ID partition=$SLURM_JOB_PARTITION nodes=$SLURM_JOB_NODELIST"
  git rev-parse HEAD 2>/dev/null || true
  module list 2>&1 || true
  which python 2>/dev/null || true
  python -VV 2>&1 || true
  nvidia-smi -L 2>/dev/null || true
  rocm-smi --showproductname 2>/dev/null || true
} > "$RUN_META/environment.txt"

scontrol show job -dd "$SLURM_JOB_ID" > "$RUN_META/slurm-job.txt"
```

还应保存：

- 配置文件的最终解析结果；
- 命令行；
- 随机种子；
- 数据集版本/manifest/checksum；
- 容器 checksum；
- Git diff 或 clean-state；
- 关键库版本。

不要把含 token 的环境变量全量 dump。

## 12. Jupyter

推荐 Open OnDemand Jupyter。不要在登录节点运行 kernel。

命令行模式需申请计算节点，再做 SSH tunnel。NCSA 文档给出完整流程；最小原则：

1. `srun`/OOD 申请 CPU/GPU；
2. 在计算节点启动 `jupyter-notebook --no-browser --ip=0.0.0.0 --port=<PORT>`；
3. 本地 SSH tunnel 指向计算节点内部 hostname；
4. 结束时停止 kernel/server 并释放 allocation。

Notebook 用于探索；生产运行应转成版本控制脚本和 batch job。

## 13. Delta 与 DeltaAI 环境不可混用

两者 home 不同、CPU 架构不同。共享 `/work` 中的 Conda env、compiled wheel、native binary 可能不可兼容。路径共享不等于 binary 兼容：

- 用独立 env 名称：`env-delta-x86_64`、`env-deltaai-aarch64`；
- 容器检查 architecture；
- 不把 x86 `.so` 在 ARM 上加载；
- 共享数据和纯 Python 源码通常更安全。

## 14. 网络与下载

计算节点的外网访问政策可能变化。不要让作业依赖运行时下载模型/数据。提前下载到 `/projects`/`work`，保存许可证与 checksum。对 Hugging Face 等 cache 指定共享路径并使用 offline mode 进行生产复现。
