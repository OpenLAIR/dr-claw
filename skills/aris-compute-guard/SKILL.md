---
name: aris-compute-guard
description: "Mandatory pre-flight compute resource check before running experiments. Detects whether local/remote GPU or compute resources are actually available. If resources are unavailable, STOPS the experiment pipeline immediately and reports to the user — preventing the model from hallucinating fake experiment results. Use when: about to run experiments, deploy training, or any GPU-intensive task."
argument-hint: [environment-type]
allowed-tools: Bash(nvidia-smi*), Bash(python*), Bash(ssh*), Bash(echo*), Bash(which*), Bash(command*), Read, Grep, Glob
license: MIT
metadata:
  author: wanshuiyin/ARIS
  version: "1.0.0"
---

# Compute Resource Guard

**MANDATORY** pre-flight check before any experiment execution. This skill determines whether the required compute resources are actually available. If they are not, you MUST stop immediately and inform the user — do NOT proceed to run experiments, and do NOT imagine or fabricate experiment results.

## Context: $ARGUMENTS

## CRITICAL RULE

**If this check determines compute resources are unavailable, you MUST:**
1. **STOP** all experiment execution immediately
2. **DO NOT** attempt to run any training scripts, evaluation scripts, or experiment code
3. **DO NOT** fabricate, imagine, or hallucinate any experiment results
4. **REPORT** clearly to the user what resources are missing and what they need to do
5. **MARK** the experiment task as blocked (not failed, not done)

## Workflow

### Step 1: Detect Target Environment

Read the project's `CLAUDE.md` to determine the experiment environment:

- **Local GPU** (`gpu: local`): Check local CUDA/MPS
- **Remote server** (`gpu: remote`): Check SSH connectivity + remote GPU
- **Vast.ai** (`gpu: vast`): Check for running instances
- **Modal** (`gpu: modal`): Check Modal CLI + auth (Modal is serverless — always "available" if configured)

If no `CLAUDE.md` exists or no `gpu:` setting is found, assume **local** environment.

### Step 2: Check Compute Availability

#### For Local GPU (Linux with CUDA):

```bash
# Check if nvidia-smi exists
which nvidia-smi 2>/dev/null
# If exists, check GPU status
nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader 2>/dev/null
```

**Available** = `nvidia-smi` succeeds AND at least one GPU has `memory.used < 500 MiB` (free).
**Unavailable** = `nvidia-smi` not found, returns error, or ALL GPUs have `memory.used >= memory.total * 0.9`.

#### For Local GPU (Mac with MPS):

```bash
python3 -c "
import torch
mps_available = hasattr(torch.backends, 'mps') and torch.backends.mps.is_available()
print(f'MPS_AVAILABLE={mps_available}')
if mps_available:
    print('COMPUTE_OK=true')
else:
    print('COMPUTE_OK=false')
" 2>/dev/null
```

**Available** = MPS is available (Apple Silicon with PyTorch MPS support).
**Unavailable** = No MPS, no CUDA, pure CPU only — warn user that experiments will be extremely slow or may not work.

#### For Local CPU-only (no GPU):

```bash
# Check if any GPU framework is available
python3 -c "
import torch
cuda = torch.cuda.is_available()
mps = hasattr(torch.backends, 'mps') and torch.backends.mps.is_available()
print(f'CUDA={cuda}, MPS={mps}')
if not cuda and not mps:
    print('COMPUTE_OK=false')
    print('REASON=No GPU available (no CUDA, no MPS). CPU-only execution is not suitable for ML training experiments.')
else:
    print('COMPUTE_OK=true')
" 2>&1
```

If `python3` or `torch` is not installed:
```bash
# Fallback: check for nvidia-smi directly
nvidia-smi 2>/dev/null || echo "COMPUTE_OK=false"
echo "REASON=Neither nvidia-smi nor PyTorch found. Cannot verify GPU availability."
```

#### For Remote Server (SSH):

```bash
# Check SSH connectivity (timeout 10s)
ssh -o ConnectTimeout=10 -o BatchMode=yes <server> "echo CONNECTED" 2>/dev/null
# If connected, check GPU
ssh -o ConnectTimeout=10 <server> "nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv,noheader" 2>/dev/null
```

**Available** = SSH connects AND GPU has free memory.
**Unavailable** = SSH fails (server down, auth issue, network) OR no free GPU.

#### For Vast.ai:

```bash
# Check for running instances
cat vast-instances.json 2>/dev/null
# Or query Vast.ai API
vastai show instances 2>/dev/null
```

**Available** = A running instance exists with SSH access.
**Unavailable** = No running instances (need to provision one first).

#### For Modal (serverless):

```bash
# Check Modal CLI is installed and authenticated
modal token verify 2>/dev/null || echo "MODAL_NOT_CONFIGURED"
```

**Available** = Modal CLI installed and authenticated.
**Unavailable** = Modal not installed or not authenticated.

### Step 3: Decision Gate

| Check Result | Action |
|---|---|
| **COMPUTE_OK = true** | Proceed with experiment. Print brief resource summary and continue. |
| **COMPUTE_OK = false** | **STOP IMMEDIATELY.** Do NOT run any experiments. Go to Step 4. |

### Step 4: Stop and Report (when compute unavailable)

When compute resources are NOT available, respond with a clear, structured message:

```
⚠️ COMPUTE RESOURCES UNAVAILABLE — Experiment Stopped

I checked the compute resources and they are NOT available for running experiments.

**Environment:** [local / remote / vast.ai / modal]
**Issue:** [specific reason — e.g., "No GPU detected", "SSH connection failed", "All GPUs fully occupied"]

**What you need to do:**
- [Actionable step 1 — e.g., "Ensure your machine has a CUDA-compatible GPU"]
- [Actionable step 2 — e.g., "Free up GPU memory by stopping other processes"]
- [Actionable step 3 — e.g., "Configure a remote server in CLAUDE.md"]

**Alternative options:**
- Set `gpu: modal` in CLAUDE.md to use Modal serverless GPU (no local GPU needed)
- Set `gpu: vast` in CLAUDE.md to rent an on-demand GPU from Vast.ai
- Configure a remote GPU server with `gpu: remote` in CLAUDE.md

I will NOT proceed with running experiments or generating results, as doing so without actual compute resources would produce fabricated output. Please resolve the compute issue and try again.
```

**After this message, STOP. Do not continue with any experiment workflow steps.**

### Step 5: Proceed Summary (when compute available)

When compute IS available, print a brief summary and return control:

```
✅ Compute resources verified:
- Environment: [local / remote / vast.ai / modal]
- GPU: [GPU name, count, free memory]
- Status: Ready for experiments

Proceeding with experiment execution.
```

## Integration

This skill is called automatically by:
- `/aris-run-experiment` (Step 0, before environment detection)
- `/aris-experiment-bridge` (Phase 0, before parsing experiment plan)

It can also be called standalone:
```
/aris-compute-guard
/aris-compute-guard local
/aris-compute-guard remote
```

## Rules

- NEVER skip this check. It exists to prevent wasted time and hallucinated results.
- If the check itself fails (e.g., `python3` not found), treat it as **unavailable** and report.
- For `gpu: modal`, the check is lenient — Modal handles GPU allocation automatically. Only fail if Modal CLI is not installed/authenticated.
- For CPU-only environments, warn but allow if the experiment is explicitly CPU-compatible (e.g., small-scale testing, data preprocessing).
- This check should complete in under 30 seconds. If SSH times out, report as unavailable.
