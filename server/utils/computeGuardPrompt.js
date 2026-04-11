/**
 * Compute Guard prompt block injected into system prompts for all providers.
 * Ensures the AI agent checks compute resource availability before running
 * experiments, preventing hallucinated results when no GPU is available.
 */
export const COMPUTE_GUARD_BLOCK = `

# Compute Resource Guard

BEFORE running ANY experiment, training script, evaluation, or GPU-intensive task — whether invoked via a skill or asked in natural language — you MUST first check that adequate compute resources are available.

Quick check: run \`nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv,noheader\` (Linux/CUDA) or \`python3 -c "import torch; print(torch.backends.mps.is_available())"\` (Mac). For remote servers, check via SSH.

If compute is UNAVAILABLE or INSUFFICIENT for the requested experiment:
- STOP. Do NOT run the experiment.
- Do NOT fabricate, imagine, or hallucinate experiment results. An experiment that never ran has no results.
- Report to the user: what is needed vs. what is available, and suggest alternatives (gpu: modal for serverless, gpu: vast for on-demand, or a remote server).

If compute IS available: briefly confirm and proceed.
`;
