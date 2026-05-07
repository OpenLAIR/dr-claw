# Skills Index

> **Do NOT read all SKILL.md files at once.** Use this index to find the right skill, then read only that one.

## Core Pipeline Skills

| Skill | Path | Description |
|-------|------|-------------|
| dataset-discovery | `.agents/skills/dataset-discovery/SKILL.md` | Multi-source ML dataset discovery. Search HuggingFace Hub, OpenML, GitHub, and paper cross-references for datasets re... |
| init-analysis | `.agents/skills/init-analysis/SKILL.md` | This skill should be used when the user asks to "run initial analysis", "analyze single-cell data", "QC my data", "ru... |
| inno-code-survey | `.agents/skills/inno-code-survey/SKILL.md` | Acquires missing code repositories for the selected idea (Phase A) and conducts comprehensive code survey mapping aca... |
| inno-deep-research | `.agents/skills/inno-deep-research/SKILL.md` | Comprehensive research assistant that synthesizes information from multiple sources with citations. Use when: conduct... |
| inno-experiment-analysis | `.agents/skills/inno-experiment-analysis/SKILL.md` | This skill should be used when the user asks to "analyze experimental results", "generate results section", "statisti... |
| inno-experiment-dev | `.agents/skills/inno-experiment-dev/SKILL.md` | Creates implementation plan, writes project code with judge feedback loop, and submits final experiment run. Use afte... |
| inno-figure-gen | `.agents/skills/inno-figure-gen/SKILL.md` | Generate/edit images with Gemini image models (default: gemini-3.1-flash-image-preview). Use for image create/modify ... |
| inno-grant-proposal | `.agents/skills/inno-grant-proposal/SKILL.md` | Help professors and researchers write, revise, adapt, and polish grant proposals for US agencies (NSF, NIH, DOE, DARP... |
| inno-humanizer | `.agents/skills/inno-humanizer/SKILL.md` | Remove signs of AI-generated writing from text. Use when editing or reviewing text to make it sound more natural and ... |
| inno-idea-eval | `.agents/skills/inno-idea-eval/SKILL.md` | Multi-persona idea evaluation with quality gate. Evaluates ideas across 5 InnoEval dimensions (Clarity, Novelty, Vali... |
| inno-idea-generation | `.agents/skills/inno-idea-generation/SKILL.md` | Facilitates structured brainstorming sessions, conducts comprehensive research, and generates creative solutions usin... |
| inno-paper-reviewer | `.agents/skills/inno-paper-reviewer/SKILL.md` | Structured manuscript/grant review with checklist-based evaluation. Use when writing formal peer reviews with specifi... |
| inno-paper-writing | `.agents/skills/inno-paper-writing/SKILL.md` | Creates formal academic research papers following IEEE/ACM formatting standards with proper structure, citations, and... |
| managing-obsidian-notes | `skills/managing-obsidian-notes/SKILL.md` | Obsidian vault CRUD via CLI. Vault bootstrap (PARA structure), per-project scaffolding, templates. Pops open notes in Obsidian after create/update. |
| inno-pipeline-planner | `.agents/skills/inno-pipeline-planner/SKILL.md` | Guides the user through an interactive conversation to define their research project, then generates research_brief.j... |
| inno-prepare-resources | `.agents/skills/inno-prepare-resources/SKILL.md` | Loads the evaluation instance, searches GitHub for related repositories, builds a dataset description, queries the Pr... |
| inno-rclone-to-overleaf | `.agents/skills/inno-rclone-to-overleaf/SKILL.md` | Access Overleaf projects via CLI. Use for reading/writing LaTeX files, syncing local .tex files to Overleaf, download... |
| inno-rebuttal | `.agents/skills/inno-rebuttal/SKILL.md` | Drafting and refining academic rebuttals for top-tier AI/CS conferences (NeurIPS, ICML, ICLR, CVPR, ECCV, AAAI, ARR, ... |
| inno-reference-audit | `.agents/skills/inno-reference-audit/SKILL.md` | This skill provides reference guidance for citation verification in academic writing. Use when the user asks about "c... |

## Library Skills

| Skill | Path | Description |
|-------|------|-------------|
| ml-paper-writing | `.agents/skills/library/20-ml-paper-writing/SKILL.md` | Write publication-ready ML/AI papers for NeurIPS, ICML, ICLR, ACL, AAAI, COLM. Use when drafting papers from research... |
| academic-researcher | `.agents/skills/library/academic-researcher/SKILL.md` | Academic research assistant for literature reviews, paper analysis, and scholarly writing. Use when: reviewing academ... |
| huggingface-accelerate | `.agents/skills/library/accelerate/SKILL.md` | Simplest distributed training API. 4 lines to add distributed support to any PyTorch script. Unified API for DeepSpee... |
| huggingface-accelerate | `.agents/skills/library/accelerate/SKILL.md` | Simplest distributed training API. 4 lines to add distributed support to any PyTorch script. Unified API for DeepSpee... |
| adding-leetcode-templates | `.agents/skills/library/adding-leetcode-templates/SKILL.md` | Add algorithm/data structure template code to the leetcode-template Anki deck with proper HTML formatting. Use this s... |
| ai-reference-audit | `.agents/skills/library/ai-reference-audit/SKILL.md` | Run strong reference audits for AI research papers and repos. Use when asked to check LaTeX/BibTeX citations for miss... |
| audiocraft-audio-generation | `.agents/skills/library/audiocraft/SKILL.md` | PyTorch library for audio generation including text-to-music (MusicGen) and text-to-sound (AudioGen). Use when you ne... |
| audiocraft-audio-generation | `.agents/skills/library/audiocraft/SKILL.md` | PyTorch library for audio generation including text-to-music (MusicGen) and text-to-sound (AudioGen). Use when you ne... |
| autogpt-agents | `.agents/skills/library/autogpt/SKILL.md` | Autonomous AI agent platform for building and deploying continuous agents. Use when creating visual workflow agents, ... |
| autogpt-agents | `.agents/skills/library/autogpt/SKILL.md` | Autonomous AI agent platform for building and deploying continuous agents. Use when creating visual workflow agents, ... |
| awq-quantization | `.agents/skills/library/awq/SKILL.md` | Activation-aware weight quantization for 4-bit LLM compression with 3x speedup and minimal accuracy loss. Use when de... |
| awq-quantization | `.agents/skills/library/awq/SKILL.md` | Activation-aware weight quantization for 4-bit LLM compression with 3x speedup and minimal accuracy loss. Use when de... |
| axolotl | `.agents/skills/library/axolotl/SKILL.md` | Expert guidance for fine-tuning LLMs with Axolotl - YAML configs, 100+ models, LoRA/QLoRA, DPO/KTO/ORPO/GRPO, multimo... |
| axolotl | `.agents/skills/library/axolotl/SKILL.md` | Expert guidance for fine-tuning LLMs with Axolotl - YAML configs, 100+ models, LoRA/QLoRA, DPO/KTO/ORPO/GRPO, multimo... |
| batch-condensing-arxiv-papers | `.agents/skills/library/batch-condensing-arxiv-papers/SKILL.md` | Downloads and condenses multiple arXiv papers to their essential LaTeX content. Use when the user requests to "downlo... |
| evaluating-code-models | `.agents/skills/library/bigcode-evaluation-harness/SKILL.md` | Evaluates code generation models across HumanEval, MBPP, MultiPL-E, and 15+ benchmarks with pass@k metrics. Use when ... |
| evaluating-code-models | `.agents/skills/library/bigcode-evaluation-harness/SKILL.md` | Evaluates code generation models across HumanEval, MBPP, MultiPL-E, and 15+ benchmarks with pass@k metrics. Use when ... |
| biorxiv-database | `.agents/skills/library/biorxiv-database/SKILL.md` | Efficient database search tool for bioRxiv preprint server. Use this skill when searching for life sciences preprints... |
| quantizing-models-bitsandbytes | `.agents/skills/library/bitsandbytes/SKILL.md` | Quantizes LLMs to 8-bit or 4-bit for 50-75% memory reduction with minimal accuracy loss. Use when GPU memory is limit... |
| quantizing-models-bitsandbytes | `.agents/skills/library/bitsandbytes/SKILL.md` | Quantizes LLMs to 8-bit or 4-bit for 50-75% memory reduction with minimal accuracy loss. Use when GPU memory is limit... |
| blip-2-vision-language | `.agents/skills/library/blip-2/SKILL.md` | Vision-language pre-training framework bridging frozen image encoders and LLMs. Use when you need image captioning, v... |
| blip-2-vision-language | `.agents/skills/library/blip-2/SKILL.md` | Vision-language pre-training framework bridging frozen image encoders and LLMs. Use when you need image captioning, v... |
| brainstorming-research-ideas | `.agents/skills/library/brainstorming-research-ideas/SKILL.md` | Guides researchers through structured ideation frameworks to discover high-impact research directions. Use when explo... |
| chroma | `.agents/skills/library/chroma/SKILL.md` | Open-source embedding database for AI applications. Store embeddings and metadata, perform vector and full-text searc... |
| chroma | `.agents/skills/library/chroma/SKILL.md` | Open-source embedding database for AI applications. Store embeddings and metadata, perform vector and full-text searc... |
| clip | `.agents/skills/library/clip/SKILL.md` | OpenAI's model connecting vision and language. Enables zero-shot image classification, image-text matching, and cross... |
| clip | `.agents/skills/library/clip/SKILL.md` | OpenAI's model connecting vision and language. Enables zero-shot image classification, image-text matching, and cross... |
| constitutional-ai | `.agents/skills/library/constitutional-ai/SKILL.md` | Anthropic's method for training harmless AI through self-improvement. Two-phase approach - supervised learning with s... |
| constitutional-ai | `.agents/skills/library/constitutional-ai/SKILL.md` | Anthropic's method for training harmless AI through self-improvement. Two-phase approach - supervised learning with s... |
| converting-pptx-to-images | `.agents/skills/library/converting-pptx-to-images/SKILL.md` | Convert a PPTX file into a folder of per-slide PNG images using LibreOffice and pdftoppm. Use when the user asks to "... |
| creative-thinking-for-research | `.agents/skills/library/creative-thinking-for-research/SKILL.md` | Applies cognitive science frameworks for creative thinking to CS and AI research ideation. Use when seeking genuinely... |
| crewai-multi-agent | `.agents/skills/library/crewai/SKILL.md` | Multi-agent orchestration framework for autonomous AI collaboration. Use when building teams of specialized agents wo... |
| crewai-multi-agent | `.agents/skills/library/crewai/SKILL.md` | Multi-agent orchestration framework for autonomous AI collaboration. Use when building teams of specialized agents wo... |
| cross-machine-sync | `.agents/skills/library/cross-machine-sync/SKILL.md` | Sync and push files, text, and clipboard between MacBook Pro and Mac Mini over Tailscale SSH. Use when user asks to "... |
| deepspeed | `.agents/skills/library/deepspeed/SKILL.md` | Expert guidance for distributed training with DeepSpeed - ZeRO optimization stages, pipeline parallelism, FP16/BF16/F... |
| deepspeed | `.agents/skills/library/deepspeed/SKILL.md` | Expert guidance for distributed training with DeepSpeed - ZeRO optimization stages, pipeline parallelism, FP16/BF16/F... |
| dspy | `.agents/skills/library/dspy/SKILL.md` | Build complex AI systems with declarative programming, optimize prompts automatically, create modular RAG systems and... |
| dspy | `.agents/skills/library/dspy/SKILL.md` | Build complex AI systems with declarative programming, optimize prompts automatically, create modular RAG systems and... |
| excalidraw | `.agents/skills/library/excalidraw/SKILL.md` | Create and edit Excalidraw diagrams programmatically. Use when the user asks to create diagrams, flowcharts, architec... |
| experimental-rigor-audit | `.agents/skills/library/experimental-rigor-audit/SKILL.md` | Audit experiments and writeups for scientific rigor, reasoning transparency, and common pitfalls. Use when reviewing ... |
| faiss | `.agents/skills/library/faiss/SKILL.md` | Facebook's library for efficient similarity search and clustering of dense vectors. Supports billions of vectors, GPU... |
| faiss | `.agents/skills/library/faiss/SKILL.md` | Facebook's library for efficient similarity search and clustering of dense vectors. Supports billions of vectors, GPU... |
| optimizing-attention-flash | `.agents/skills/library/flash-attention/SKILL.md` | Optimizes transformer attention with Flash Attention for 2-4x speedup and 10-20x memory reduction. Use when training/... |
| optimizing-attention-flash | `.agents/skills/library/flash-attention/SKILL.md` | Optimizes transformer attention with Flash Attention for 2-4x speedup and 10-20x memory reduction. Use when training/... |
| gemini-deep-research | `.agents/skills/library/gemini-deep-research/SKILL.md` | Perform deep, multi-source research using Google Gemini's Deep Research Agent. Use this skill whenever the user asks ... |
| gguf-quantization | `.agents/skills/library/gguf/SKILL.md` | GGUF format and llama.cpp quantization for efficient CPU/GPU inference. Use when deploying models on consumer hardwar... |
| gguf-quantization | `.agents/skills/library/gguf/SKILL.md` | GGUF format and llama.cpp quantization for efficient CPU/GPU inference. Use when deploying models on consumer hardwar... |
| gptq | `.agents/skills/library/gptq/SKILL.md` | Post-training 4-bit quantization for LLMs with minimal accuracy loss. Use for deploying large models (70B, 405B) on c... |
| gptq | `.agents/skills/library/gptq/SKILL.md` | Post-training 4-bit quantization for LLMs with minimal accuracy loss. Use for deploying large models (70B, 405B) on c... |
| grpo-rl-training | `.agents/skills/library/grpo-rl-training/SKILL.md` | Expert guidance for GRPO/RL fine-tuning with TRL for reasoning and task-specific model training |
| grpo-rl-training | `.agents/skills/library/grpo-rl-training/SKILL.md` | Expert guidance for GRPO/RL fine-tuning with TRL for reasoning and task-specific model training |
| guidance | `.agents/skills/library/guidance/SKILL.md` | Control LLM output with regex and grammars, guarantee valid JSON/XML/code generation, enforce structured formats, and... |
| guidance | `.agents/skills/library/guidance/SKILL.md` | Control LLM output with regex and grammars, guarantee valid JSON/XML/code generation, enforce structured formats, and... |
| hqq-quantization | `.agents/skills/library/hqq/SKILL.md` | Half-Quadratic Quantization for LLMs without calibration data. Use when quantizing models to 4/3/2-bit precision with... |
| hqq-quantization | `.agents/skills/library/hqq/SKILL.md` | Half-Quadratic Quantization for LLMs without calibration data. Use when quantizing models to 4/3/2-bit precision with... |
| huggingface-tokenizers | `.agents/skills/library/huggingface-tokenizers/SKILL.md` | Fast tokenizers optimized for research and production. Rust-based implementation tokenizes 1GB in <20 seconds. Suppor... |
| huggingface-tokenizers | `.agents/skills/library/huggingface-tokenizers/SKILL.md` | Fast tokenizers optimized for research and production. Rust-based implementation tokenizes 1GB in <20 seconds. Suppor... |
| instructor | `.agents/skills/library/instructor/SKILL.md` | Extract structured data from LLM responses with Pydantic validation, retry failed extractions automatically, parse co... |
| instructor | `.agents/skills/library/instructor/SKILL.md` | Extract structured data from LLM responses with Pydantic validation, retry failed extractions automatically, parse co... |
| invoking-codex | `.agents/skills/library/invoking-codex/SKILL.md` | Invoke Codex CLI as a subagent to perform tasks and return results. Use when you want a second opinion, need Codex's ... |
| invoking-gemini | `.agents/skills/library/invoking-gemini/SKILL.md` | Invoke Gemini CLI as a subagent to perform tasks and return results. Use when you want a second opinion from Gemini, ... |
| json-canvas | `.agents/skills/library/json-canvas/SKILL.md` | Create and edit JSON Canvas files (.canvas) with nodes, edges, groups, and connections. Use when working with .canvas... |
| knowledge-distillation | `.agents/skills/library/knowledge-distillation/SKILL.md` | Compress large language models using knowledge distillation from teacher to student models. Use when deploying smalle... |
| knowledge-distillation | `.agents/skills/library/knowledge-distillation/SKILL.md` | Compress large language models using knowledge distillation from teacher to student models. Use when deploying smalle... |
| lambda-labs-gpu-cloud | `.agents/skills/library/lambda-labs/SKILL.md` | Reserved and on-demand GPU cloud instances for ML training and inference. Use when you need dedicated GPU instances w... |
| lambda-labs-gpu-cloud | `.agents/skills/library/lambda-labs/SKILL.md` | Reserved and on-demand GPU cloud instances for ML training and inference. Use when you need dedicated GPU instances w... |
| langchain | `.agents/skills/library/langchain/SKILL.md` | Framework for building LLM-powered applications with agents, chains, and RAG. Supports multiple providers (OpenAI, An... |
| langchain | `.agents/skills/library/langchain/SKILL.md` | Framework for building LLM-powered applications with agents, chains, and RAG. Supports multiple providers (OpenAI, An... |
| langsmith-observability | `.agents/skills/library/langsmith/SKILL.md` | LLM observability platform for tracing, evaluation, and monitoring. Use when debugging LLM applications, evaluating m... |
| langsmith-observability | `.agents/skills/library/langsmith/SKILL.md` | LLM observability platform for tracing, evaluation, and monitoring. Use when debugging LLM applications, evaluating m... |
| lehigh-aisp-gpu | `.agents/skills/library/lehigh-aisp-gpu/SKILL.md` | Connect to Lehigh AISP GPU server (aisp.cse.lehigh.edu) as yila22 with key ~/.ssh/id_rsa_unify, and quickly browse co... |
| implementing-llms-litgpt | `.agents/skills/library/litgpt/SKILL.md` | Implements and trains LLMs using Lightning AI's LitGPT with 20+ pretrained architectures (Llama, Gemma, Phi, Qwen, Mi... |
| implementing-llms-litgpt | `.agents/skills/library/litgpt/SKILL.md` | Implements and trains LLMs using Lightning AI's LitGPT with 20+ pretrained architectures (Llama, Gemma, Phi, Qwen, Mi... |
| llama-cpp | `.agents/skills/library/llama-cpp/SKILL.md` | Runs LLM inference on CPU, Apple Silicon, and consumer GPUs without NVIDIA hardware. Use for edge deployment, M1/M2/M... |
| llama-cpp | `.agents/skills/library/llama-cpp/SKILL.md` | Runs LLM inference on CPU, Apple Silicon, and consumer GPUs without NVIDIA hardware. Use for edge deployment, M1/M2/M... |
| llama-factory | `.agents/skills/library/llama-factory/SKILL.md` | Expert guidance for fine-tuning LLMs with LLaMA-Factory - WebUI no-code, 100+ models, 2/3/4/5/6/8-bit QLoRA, multimod... |
| llama-factory | `.agents/skills/library/llama-factory/SKILL.md` | Expert guidance for fine-tuning LLMs with LLaMA-Factory - WebUI no-code, 100+ models, 2/3/4/5/6/8-bit QLoRA, multimod... |
| llamaguard | `.agents/skills/library/llamaguard/SKILL.md` | Meta's 7-8B specialized moderation model for LLM input/output filtering. 6 safety categories - violence/hate, sexual ... |
| llamaguard | `.agents/skills/library/llamaguard/SKILL.md` | Meta's 7-8B specialized moderation model for LLM input/output filtering. 6 safety categories - violence/hate, sexual ... |
| llamaindex | `.agents/skills/library/llamaindex/SKILL.md` | Data framework for building LLM applications with RAG. Specializes in document ingestion (300+ connectors), indexing,... |
| llamaindex | `.agents/skills/library/llamaindex/SKILL.md` | Data framework for building LLM applications with RAG. Specializes in document ingestion (300+ connectors), indexing,... |
| llava | `.agents/skills/library/llava/SKILL.md` | Large Language and Vision Assistant. Enables visual instruction tuning and image-based conversations. Combines CLIP v... |
| llava | `.agents/skills/library/llava/SKILL.md` | Large Language and Vision Assistant. Enables visual instruction tuning and image-based conversations. Combines CLIP v... |
| evaluating-llms-harness | `.agents/skills/library/lm-evaluation-harness/SKILL.md` | Evaluates LLMs across 60+ academic benchmarks (MMLU, HumanEval, GSM8K, TruthfulQA, HellaSwag). Use when benchmarking ... |
| evaluating-llms-harness | `.agents/skills/library/lm-evaluation-harness/SKILL.md` | Evaluates LLMs across 60+ academic benchmarks (MMLU, HumanEval, GSM8K, TruthfulQA, HellaSwag). Use when benchmarking ... |
| long-context | `.agents/skills/library/long-context/SKILL.md` | Extend context windows of transformer models using RoPE, YaRN, ALiBi, and position interpolation techniques. Use when... |
| long-context | `.agents/skills/library/long-context/SKILL.md` | Extend context windows of transformer models using RoPE, YaRN, ALiBi, and position interpolation techniques. Use when... |
| mac-mini-ssh | `.agents/skills/library/mac-mini-ssh/SKILL.md` | Connect to Mac Mini via SSH over Tailscale. Use for running commands remotely, syncing files between MacBook Pro and ... |
| macbook-ssh | `.agents/skills/library/macbook-ssh/SKILL.md` | Connect to MacBook Pro via SSH over Tailscale. Use for running commands remotely, syncing files between Mac Mini and ... |
| making-academic-presentations | `.agents/skills/library/making-academic-presentations/SKILL.md` | Create academic presentation slide decks and optionally demo videos from research papers. Use when the user asks to "... |
| making-nsf-pose-insight-slides | `.agents/skills/library/making-nsf-pose-insight-slides/SKILL.md` | Create NSF-POSE insight slides as a PPTX. Use when the user asks for "NSF-POSE slides", "POSE insight PPTX", "insight... |
| making-skills | `.agents/skills/library/making-skills/SKILL.md` | Build new Claude Skills following best practices. Use this skill when the user asks to "create a skill", "make a new ... |
| mamba-architecture | `.agents/skills/library/mamba/SKILL.md` | State-space model with O(n) complexity vs Transformers' O(n²). 5× faster inference, million-token sequences, no KV ca... |
| mamba-architecture | `.agents/skills/library/mamba/SKILL.md` | State-space model with O(n) complexity vs Transformers' O(n²). 5× faster inference, million-token sequences, no KV ca... |
| managing-calendar-events | `.agents/skills/library/managing-calendar-events/SKILL.md` | Manage Google Calendar events using gcalcli. Use this skill when the user asks to "create a calendar event", "add eve... |
| managing-cli-wrapper-apis | `.agents/skills/library/managing-cli-wrapper-apis/SKILL.md` | Set up and reuse local OpenAI-compatible API servers that wrap Codex CLI or Claude Code. Use this when asked to copy ... |
| managing-github-repos | `.agents/skills/library/managing-github-repos/SKILL.md` | Manage GitHub repositories using the gh CLI. Use this skill when the user asks to "create a repo", "clone a repo", "l... |
| managing-obsidian-notes | `.agents/skills/library/managing-obsidian-notes/SKILL.md` | CRUD operations for Obsidian vault notes. Use when asked to "create a note", "add a folder", "update notes", "organiz... |
| managing-omnifocus-tasks | `.agents/skills/library/managing-omnifocus-tasks/SKILL.md` | Manage OmniFocus tasks using AppleScript/osascript. Use this skill when the user asks to "add task to OmniFocus", "cr... |
| managing-python-packages | `.agents/skills/library/managing-python-packages/SKILL.md` | Manage Python package installations using uv (ultra-fast Python package installer). Use this skill when the user asks... |
| managing-uf-gpu | `.agents/skills/library/managing-uf-gpu/SKILL.md` |  |
| training-llms-megatron | `.agents/skills/library/megatron-core/SKILL.md` | Trains large language models (2B-462B parameters) using NVIDIA Megatron-Core with advanced parallelism strategies. Us... |
| training-llms-megatron | `.agents/skills/library/megatron-core/SKILL.md` | Trains large language models (2B-462B parameters) using NVIDIA Megatron-Core with advanced parallelism strategies. Us... |
| miles-rl-training | `.agents/skills/library/miles/SKILL.md` | Provides guidance for enterprise-grade RL training using miles, a production-ready fork of slime. Use when training l... |
| miles-rl-training | `.agents/skills/library/miles/SKILL.md` | Provides guidance for enterprise-grade RL training using miles, a production-ready fork of slime. Use when training l... |
| ml-paper-writing | `.agents/skills/library/ml-paper-writing/SKILL.md` | Write publication-ready ML/AI papers for NeurIPS, ICML, ICLR, ACL, AAAI, COLM. Use when drafting papers from research... |
| mlflow | `.agents/skills/library/mlflow/SKILL.md` | Track ML experiments, manage model registry with versioning, deploy models to production, and reproduce experiments w... |
| mlflow | `.agents/skills/library/mlflow/SKILL.md` | Track ML experiments, manage model registry with versioning, deploy models to production, and reproduce experiments w... |
| modal-serverless-gpu | `.agents/skills/library/modal/SKILL.md` | Serverless GPU cloud platform for running ML workloads. Use when you need on-demand GPU access without infrastructure... |
| modal-serverless-gpu | `.agents/skills/library/modal/SKILL.md` | Serverless GPU cloud platform for running ML workloads. Use when you need on-demand GPU access without infrastructure... |
| model-merging | `.agents/skills/library/model-merging/SKILL.md` | Merge multiple fine-tuned models using mergekit to combine capabilities without retraining. Use when creating special... |
| model-merging | `.agents/skills/library/model-merging/SKILL.md` | Merge multiple fine-tuned models using mergekit to combine capabilities without retraining. Use when creating special... |
| model-pruning | `.agents/skills/library/model-pruning/SKILL.md` | Reduce LLM size and accelerate inference using pruning techniques like Wanda and SparseGPT. Use when compressing mode... |
| model-pruning | `.agents/skills/library/model-pruning/SKILL.md` | Reduce LLM size and accelerate inference using pruning techniques like Wanda and SparseGPT. Use when compressing mode... |
| moe-training | `.agents/skills/library/moe-training/SKILL.md` | Train Mixture of Experts (MoE) models using DeepSpeed or HuggingFace. Use when training large-scale models with limit... |
| moe-training | `.agents/skills/library/moe-training/SKILL.md` | Train Mixture of Experts (MoE) models using DeepSpeed or HuggingFace. Use when training large-scale models with limit... |
| nano-banana | `.agents/skills/library/nano-banana/SKILL.md` | Render images from text prompts via PaperBanana (multi-agent academic figure pipeline) or Gemini CLI's nanobanana ext... |
| nanobanana-prompt-architect | `.agents/skills/library/nanobanana-prompt-architect/SKILL.md` | Generate high-fidelity, math-accurate prompts for academic framework figures (ICML/NeurIPS style) and optionally rend... |
| nanogpt | `.agents/skills/library/nanogpt/SKILL.md` | Educational GPT implementation in ~300 lines. Reproduces GPT-2 (124M) on OpenWebText. Clean, hackable code for learni... |
| nanogpt | `.agents/skills/library/nanogpt/SKILL.md` | Educational GPT implementation in ~300 lines. Reproduces GPT-2 (124M) on OpenWebText. Clean, hackable code for learni... |
| nemo-curator | `.agents/skills/library/nemo-curator/SKILL.md` | GPU-accelerated data curation for LLM training. Supports text/image/video/audio. Features fuzzy deduplication (16× fa... |
| nemo-curator | `.agents/skills/library/nemo-curator/SKILL.md` | GPU-accelerated data curation for LLM training. Supports text/image/video/audio. Features fuzzy deduplication (16× fa... |
| nemo-evaluator-sdk | `.agents/skills/library/nemo-evaluator/SKILL.md` | Evaluates LLMs across 100+ benchmarks from 18+ harnesses (MMLU, HumanEval, GSM8K, safety, VLM) with multi-backend exe... |
| nemo-evaluator-sdk | `.agents/skills/library/nemo-evaluator/SKILL.md` | Evaluates LLMs across 100+ benchmarks from 18+ harnesses (MMLU, HumanEval, GSM8K, safety, VLM) with multi-backend exe... |
| nemo-guardrails | `.agents/skills/library/nemo-guardrails/SKILL.md` | NVIDIA's runtime safety framework for LLM applications. Features jailbreak detection, input/output validation, fact-c... |
| nemo-guardrails | `.agents/skills/library/nemo-guardrails/SKILL.md` | NVIDIA's runtime safety framework for LLM applications. Features jailbreak detection, input/output validation, fact-c... |
| nnsight-remote-interpretability | `.agents/skills/library/nnsight/SKILL.md` | Provides guidance for interpreting and manipulating neural network internals using nnsight with optional NDIF remote ... |
| nnsight-remote-interpretability | `.agents/skills/library/nnsight/SKILL.md` | Provides guidance for interpreting and manipulating neural network internals using nnsight with optional NDIF remote ... |
| obsidian-bases | `.agents/skills/library/obsidian-bases/SKILL.md` | Create and edit Obsidian Bases (.base files) with views, filters, formulas, and summaries. Use when working with .bas... |
| obsidian-markdown | `.agents/skills/library/obsidian-markdown/SKILL.md` | Create and edit Obsidian Flavored Markdown with wikilinks, embeds, callouts, properties, and other Obsidian-specific ... |
| openrlhf-training | `.agents/skills/library/openrlhf/SKILL.md` | High-performance RLHF framework with Ray+vLLM acceleration. Use for PPO, GRPO, RLOO, DPO training of large models (7B... |
| openrlhf-training | `.agents/skills/library/openrlhf/SKILL.md` | High-performance RLHF framework with Ray+vLLM acceleration. Use for PPO, GRPO, RLOO, DPO training of large models (7B... |
| outlines | `.agents/skills/library/outlines/SKILL.md` | Guarantee valid JSON/XML/code structure during generation, use Pydantic models for type-safe outputs, support local m... |
| outlines | `.agents/skills/library/outlines/SKILL.md` | Guarantee valid JSON/XML/code structure during generation, use Pydantic models for type-safe outputs, support local m... |
| paper-analyzer | `.agents/skills/library/paper-analyzer/SKILL.md` | Deep analysis of a single paper — generate structured notes with figures, evaluation, and knowledge graph updates |
| paper-finder | `.agents/skills/library/paper-finder/SKILL.md` | Search existing paper notes by title, author, keyword, or research domain |
| paper-image-extractor | `.agents/skills/library/paper-image-extractor/SKILL.md` | Extract figures from papers — prioritizes arXiv source package for high-quality images |
| peft-fine-tuning | `.agents/skills/library/peft/SKILL.md` | Parameter-efficient fine-tuning for LLMs using LoRA, QLoRA, and 25+ methods. Use when fine-tuning large models (7B-70... |
| peft-fine-tuning | `.agents/skills/library/peft/SKILL.md` | Parameter-efficient fine-tuning for LLMs using LoRA, QLoRA, and 25+ methods. Use when fine-tuning large models (7B-70... |
| phoenix-observability | `.agents/skills/library/phoenix/SKILL.md` | Open-source AI observability platform for LLM tracing, evaluation, and monitoring. Use when debugging LLM application... |
| phoenix-observability | `.agents/skills/library/phoenix/SKILL.md` | Open-source AI observability platform for LLM tracing, evaluation, and monitoring. Use when debugging LLM application... |
| pinecone | `.agents/skills/library/pinecone/SKILL.md` | Managed vector database for production AI applications. Fully managed, auto-scaling, with hybrid search (dense + spar... |
| pinecone | `.agents/skills/library/pinecone/SKILL.md` | Managed vector database for production AI applications. Fully managed, auto-scaling, with hybrid search (dense + spar... |
| pose-interview-logging | `.agents/skills/library/pose-interview-logging/SKILL.md` | Log POSE program interviews into the Innovation Within discovery platform using Playwright automation. Creates interv... |
| pose-schedule | `.agents/skills/library/pose-schedule/SKILL.md` | Add POSE program tasks to OmniFocus and Google Calendar, and create session calendar invitations with Zoom links and ... |
| processing-forum-posts | `.agents/skills/library/processing-forum-posts/SKILL.md` | Process and clean forum posts from 一亩三分地 (1point3acres) for interview preparation. Use this skill when the user asks ... |
| processing-gemini-talks | `.agents/skills/library/processing-gemini-talks/SKILL.md` | Split Gemini conversation exports into individual knowledge notes and place them in the Obsidian vault. Use when the ... |
| prompt-guard | `.agents/skills/library/prompt-guard/SKILL.md` | Meta's 86M prompt injection and jailbreak detector. Filters malicious prompts and third-party data for LLM apps. 99%+... |
| prompt-guard | `.agents/skills/library/prompt-guard/SKILL.md` | Meta's 86M prompt injection and jailbreak detector. Filters malicious prompts and third-party data for LLM apps. 99%+... |
| pytorch-fsdp2 | `.agents/skills/library/pytorch-fsdp2/SKILL.md` | Adds PyTorch FSDP2 (fully_shard) to training scripts with correct init, sharding, mixed precision/offload config, and... |
| pytorch-fsdp2 | `.agents/skills/library/pytorch-fsdp2/SKILL.md` | Adds PyTorch FSDP2 (fully_shard) to training scripts with correct init, sharding, mixed precision/offload config, and... |
| pytorch-lightning | `.agents/skills/library/pytorch-lightning/SKILL.md` | High-level PyTorch framework with Trainer class, automatic distributed training (DDP/FSDP/DeepSpeed), callbacks syste... |
| pytorch-lightning | `.agents/skills/library/pytorch-lightning/SKILL.md` | High-level PyTorch framework with Trainer class, automatic distributed training (DDP/FSDP/DeepSpeed), callbacks syste... |
| pyvene-interventions | `.agents/skills/library/pyvene/SKILL.md` | Provides guidance for performing causal interventions on PyTorch models using pyvene's declarative intervention frame... |
| pyvene-interventions | `.agents/skills/library/pyvene/SKILL.md` | Provides guidance for performing causal interventions on PyTorch models using pyvene's declarative intervention frame... |
| qdrant-vector-search | `.agents/skills/library/qdrant/SKILL.md` | High-performance vector similarity search engine for RAG and semantic search. Use when building production RAG system... |
| qdrant-vector-search | `.agents/skills/library/qdrant/SKILL.md` | High-performance vector similarity search engine for RAG and semantic search. Use when building production RAG system... |
| ray-data | `.agents/skills/library/ray-data/SKILL.md` | Scalable data processing for ML workloads. Streaming execution across CPU/GPU, supports Parquet/CSV/JSON/images. Inte... |
| ray-data | `.agents/skills/library/ray-data/SKILL.md` | Scalable data processing for ML workloads. Streaming execution across CPU/GPU, supports Parquet/CSV/JSON/images. Inte... |
| ray-train | `.agents/skills/library/ray-train/SKILL.md` | Distributed training orchestration across clusters. Scales PyTorch/TensorFlow/HuggingFace from laptop to 1000s of nod... |
| ray-train | `.agents/skills/library/ray-train/SKILL.md` | Distributed training orchestration across clusters. Scales PyTorch/TensorFlow/HuggingFace from laptop to 1000s of nod... |
| research-landscape-assessment | `.agents/skills/library/research-landscape-assessment/SKILL.md` | Assess the research landscape for a given topic: quantify hotness/saturation, identify sub-directions, find key paper... |
| research-news | `.agents/skills/library/research-news/SKILL.md` | Daily paper recommendation workflow — search arXiv and Semantic Scholar, score and recommend papers |
| rwkv-architecture | `.agents/skills/library/rwkv/SKILL.md` | RNN+Transformer hybrid with O(n) inference. Linear time, infinite context, no KV cache. Train like GPT (parallel), in... |
| rwkv-architecture | `.agents/skills/library/rwkv/SKILL.md` | RNN+Transformer hybrid with O(n) inference. Linear time, infinite context, no KV cache. Train like GPT (parallel), in... |
| sparse-autoencoder-training | `.agents/skills/library/saelens/SKILL.md` | Provides guidance for training and analyzing Sparse Autoencoders (SAEs) using SAELens to decompose neural network act... |
| sparse-autoencoder-training | `.agents/skills/library/saelens/SKILL.md` | Provides guidance for training and analyzing Sparse Autoencoders (SAEs) using SAELens to decompose neural network act... |
| scientific-writing | `.agents/skills/library/scientific-writing/SKILL.md` | Core skill for the deep research and writing tool. Write scientific manuscripts in full paragraphs (never bullet poin... |
| searching-agent-sessions | `.agents/skills/library/searching-agent-sessions/SKILL.md` | Search and browse past coding agent sessions (Claude Code, Codex, Gemini) via CASS CLI. Use when the user asks to "fi... |
| searching-ai-papers | `.agents/skills/library/searching-ai-papers/SKILL.md` | Search general-domain AI/ML papers across arXiv, Semantic Scholar, OpenAlex, OpenReview, ICLR accepted papers (OpenRe... |
| searching-local-papers | `.agents/skills/library/searching-local-papers/SKILL.md` | Search the local corpus of 115K+ AI/ML research papers (79% with abstracts, 84% for 2025+ papers) using a precomputed... |
| searching-rednote-posts | `.agents/skills/library/searching-rednote-posts/SKILL.md` | Search Xiaohongshu (小红书/RedNote) posts using Playwright MCP browser automation. Use when the user asks to "search Red... |
| segment-anything-model | `.agents/skills/library/segment-anything/SKILL.md` | Foundation model for image segmentation with zero-shot transfer. Use when you need to segment any object in images us... |
| segment-anything-model | `.agents/skills/library/segment-anything/SKILL.md` | Foundation model for image segmentation with zero-shot transfer. Use when you need to segment any object in images us... |
| sending-lehigh-emails | `.agents/skills/library/sending-lehigh-emails/SKILL.md` | Send emails using Lehigh University Gmail account (yila22@lehigh.edu) via Gmail MCP. Use this skill when the user ask... |
| sentence-transformers | `.agents/skills/library/sentence-transformers/SKILL.md` | Framework for state-of-the-art sentence, text, and image embeddings. Provides 5000+ pre-trained models for semantic s... |
| sentence-transformers | `.agents/skills/library/sentence-transformers/SKILL.md` | Framework for state-of-the-art sentence, text, and image embeddings. Provides 5000+ pre-trained models for semantic s... |
| sentencepiece | `.agents/skills/library/sentencepiece/SKILL.md` | Language-independent tokenizer treating text as raw Unicode. Supports BPE and Unigram algorithms. Fast (50k sentences... |
| sentencepiece | `.agents/skills/library/sentencepiece/SKILL.md` | Language-independent tokenizer treating text as raw Unicode. Supports BPE and Unigram algorithms. Fast (50k sentences... |
| session-migrate | `.agents/skills/library/session-migrate/SKILL.md` | Migrate Claude Code sessions between MacBook Pro and Mac Mini over Tailscale SSH. Remaps user paths so sessions creat... |
| sglang | `.agents/skills/library/sglang/SKILL.md` | Fast structured generation and serving for LLMs with RadixAttention prefix caching. Use for JSON/regex outputs, const... |
| sglang | `.agents/skills/library/sglang/SKILL.md` | Fast structured generation and serving for LLMs with RadixAttention prefix caching. Use for JSON/regex outputs, const... |
| simpo-training | `.agents/skills/library/simpo/SKILL.md` | Simple Preference Optimization for LLM alignment. Reference-free alternative to DPO with better performance (+6.4 poi... |
| simpo-training | `.agents/skills/library/simpo/SKILL.md` | Simple Preference Optimization for LLM alignment. Reference-free alternative to DPO with better performance (+6.4 poi... |
| skypilot-multi-cloud-orchestration | `.agents/skills/library/skypilot/SKILL.md` | Multi-cloud orchestration for ML workloads with automatic cost optimization. Use when you need to run training or bat... |
| skypilot-multi-cloud-orchestration | `.agents/skills/library/skypilot/SKILL.md` | Multi-cloud orchestration for ML workloads with automatic cost optimization. Use when you need to run training or bat... |
| slime-rl-training | `.agents/skills/library/slime/SKILL.md` | Provides guidance for LLM post-training with RL using slime, a Megatron+SGLang framework. Use when training GLM model... |
| slime-rl-training | `.agents/skills/library/slime/SKILL.md` | Provides guidance for LLM post-training with RL using slime, a Megatron+SGLang framework. Use when training GLM model... |
| speculative-decoding | `.agents/skills/library/speculative-decoding/SKILL.md` | Accelerate LLM inference using speculative decoding, Medusa multiple heads, and lookahead decoding techniques. Use wh... |
| speculative-decoding | `.agents/skills/library/speculative-decoding/SKILL.md` | Accelerate LLM inference using speculative decoding, Medusa multiple heads, and lookahead decoding techniques. Use wh... |
| stable-diffusion-image-generation | `.agents/skills/library/stable-diffusion/SKILL.md` | State-of-the-art text-to-image generation with Stable Diffusion models via HuggingFace Diffusers. Use when generating... |
| stable-diffusion-image-generation | `.agents/skills/library/stable-diffusion/SKILL.md` | State-of-the-art text-to-image generation with Stable Diffusion models via HuggingFace Diffusers. Use when generating... |
| syncing-overleaf-papers | `.agents/skills/library/syncing-overleaf-papers/SKILL.md` | Two-way file management between local and remote Dropbox/Overleaf via rclone. Use when the user asks to "sync to over... |
| syncing-skill-hub | `.agents/skills/library/syncing-skill-hub/SKILL.md` | Check skill sync status and optionally back up to git. Use when the user asks to "sync skills", "save skills", "push ... |
| tensorboard | `.agents/skills/library/tensorboard/SKILL.md` | Visualize training metrics, debug models with histograms, compare experiments, visualize model graphs, and profile pe... |
| tensorboard | `.agents/skills/library/tensorboard/SKILL.md` | Visualize training metrics, debug models with histograms, compare experiments, visualize model graphs, and profile pe... |
| tensorrt-llm | `.agents/skills/library/tensorrt-llm/SKILL.md` | Optimizes LLM inference with NVIDIA TensorRT for maximum throughput and lowest latency. Use for production deployment... |
| tensorrt-llm | `.agents/skills/library/tensorrt-llm/SKILL.md` | Optimizes LLM inference with NVIDIA TensorRT for maximum throughput and lowest latency. Use for production deployment... |
| toggling-mac-displays | `.agents/skills/library/toggling-mac-displays/SKILL.md` | Toggle physical monitors on/off for Mac Mini to enable virtual displays for remote desktop access. Use when asked to ... |
| torchforge-rl-training | `.agents/skills/library/torchforge/SKILL.md` | Provides guidance for PyTorch-native agentic RL using torchforge, Meta's library separating infra from algorithms. Us... |
| torchforge-rl-training | `.agents/skills/library/torchforge/SKILL.md` | Provides guidance for PyTorch-native agentic RL using torchforge, Meta's library separating infra from algorithms. Us... |
| distributed-llm-pretraining-torchtitan | `.agents/skills/library/torchtitan/SKILL.md` | Provides PyTorch-native distributed LLM pretraining using torchtitan with 4D parallelism (FSDP2, TP, PP, CP). Use whe... |
| distributed-llm-pretraining-torchtitan | `.agents/skills/library/torchtitan/SKILL.md` | Provides PyTorch-native distributed LLM pretraining using torchtitan with 4D parallelism (FSDP2, TP, PP, CP). Use whe... |
| transformer-lens-interpretability | `.agents/skills/library/transformer-lens/SKILL.md` | Provides guidance for mechanistic interpretability research using TransformerLens to inspect and manipulate transform... |
| transformer-lens-interpretability | `.agents/skills/library/transformer-lens/SKILL.md` | Provides guidance for mechanistic interpretability research using TransformerLens to inspect and manipulate transform... |
| trending-research-scanner | `.agents/skills/library/trending-research-scanner/SKILL.md` | Iterative field radar — scan trending research papers across Semantic Scholar, OpenAlex, HF Daily Papers, and arXiv w... |
| fine-tuning-with-trl | `.agents/skills/library/trl-fine-tuning/SKILL.md` | Fine-tune LLMs using reinforcement learning with TRL - SFT for instruction tuning, DPO for preference alignment, PPO/... |
| fine-tuning-with-trl | `.agents/skills/library/trl-fine-tuning/SKILL.md` | Fine-tune LLMs using reinforcement learning with TRL - SFT for instruction tuning, DPO for preference alignment, PPO/... |
| unsloth | `.agents/skills/library/unsloth/SKILL.md` | Expert guidance for fast fine-tuning with Unsloth - 2-5x faster training, 50-80% less memory, LoRA/QLoRA optimization |
| unsloth | `.agents/skills/library/unsloth/SKILL.md` | Expert guidance for fast fine-tuning with Unsloth - 2-5x faster training, 50-80% less memory, LoRA/QLoRA optimization |
| updating-leetcode-anki-cards | `.agents/skills/library/updating-leetcode-anki-cards/SKILL.md` | Transform LeetCode Anki flashcards from code-implementation-heavy format to semantic-reasoning-focused format followi... |
| verl-rl-training | `.agents/skills/library/verl/SKILL.md` | Provides guidance for training LLMs with reinforcement learning using verl (Volcano Engine RL). Use when implementing... |
| verl-rl-training | `.agents/skills/library/verl/SKILL.md` | Provides guidance for training LLMs with reinforcement learning using verl (Volcano Engine RL). Use when implementing... |
| serving-llms-vllm | `.agents/skills/library/vllm/SKILL.md` | Serves LLMs with high throughput using vLLM's PagedAttention and continuous batching. Use when deploying production L... |
| serving-llms-vllm | `.agents/skills/library/vllm/SKILL.md` | Serves LLMs with high throughput using vLLM's PagedAttention and continuous batching. Use when deploying production L... |
| weights-and-biases | `.agents/skills/library/weights-and-biases/SKILL.md` | Track ML experiments with automatic logging, visualize training in real-time, optimize hyperparameters with sweeps, a... |
| weights-and-biases | `.agents/skills/library/weights-and-biases/SKILL.md` | Track ML experiments with automatic logging, visualize training in real-time, optimize hyperparameters with sweeps, a... |
| whisper | `.agents/skills/library/whisper/SKILL.md` | OpenAI's general-purpose speech recognition model. Supports 99 languages, transcription, translation to English, and ... |
| whisper | `.agents/skills/library/whisper/SKILL.md` | OpenAI's general-purpose speech recognition model. Supports 99 languages, transcription, translation to English, and ... |
| writing-experiment-reports | `.agents/skills/library/writing-experiment-reports/SKILL.md` | Generate comprehensive LaTeX experiment reports for machine learning ablation studies. Use when user requests "create... |
| writing-standup-notes | `.agents/skills/library/writing-standup-notes/SKILL.md` | Create structured daily standup notes following the Yesterday/Today/Blockers format. Use this skill when the user ask... |
