# InnoFlow Skills — 测试指南 (Hands-on)

本文档提供每个 Skill 的**具体输入 prompt**（可直接复制到 Claude / Cursor Agent 对话中）和**预期输出**，方便逐步验证。

> **参考数据**:
> - Instance JSON: `/home/dingjie/workspace/medical/Medical_ai_scientist_idea/benchmark/final-med/nlp_qa/nlp_qa_1.json`
> - 参考输出目录: `Ideation/` (ideas + references) 和 `Experiment/` (code_references + datasets + core_code + analysis)
>
> 详细日志文件与 Skill 的映射关系见 `TEST_CASES.md`。

---

## 0. 全流程测试 (inno-research-orchestrator)

### 测试 A: Idea 模式 — 完整流程

**输入 Prompt** (复制到对话框):

```
请基于以下 instance 文件启动完整的 Research Pipeline（idea 模式）:

- Instance 路径: /home/dingjie/workspace/medical/Medical_ai_scientist_idea/benchmark/final-med/nlp_qa/nlp_qa_1.json
- task_level: task2
- category: nlp_qa
- max_iter_times: 1

请使用 task2（背景描述）作为输入，走 idea 分支：
prepare → idea-generation → code-survey (Phase A + B) → implementation-plan → ml-dev → submit/refine
```

**预期输出**:
- Orchestrator 判定输入成熟度为 **idea-level**（因为 task_level=task2，输入是背景描述而非完整计划）
- 依次调用 7 个 skill，生成以下目录/文件:
  - `Ideation/references/logs/` + `Ideation/ideas/logs/` 下的 agent/tool JSON
  - `Experiment/code_references/logs/` + `Experiment/core_code/logs/` + `Experiment/analysis/logs/` 下的 agent JSON
  - `Experiment/code_references/` 下克隆的代码仓库, `Ideation/references/papers/` 下下载的论文
  - `Experiment/core_code/` 下完整的项目代码

---

### 测试 B: Plan 模式 — 完整流程

**输入 Prompt**:

```
请基于以下 instance 文件启动完整的 Research Pipeline（plan 模式）:

- Instance 路径: /home/dingjie/workspace/medical/Medical_ai_scientist_idea/benchmark/final-med/nlp_qa/nlp_qa_1.json
- task_level: task1
- category: nlp_qa
- max_iter_times: 1

请使用 task1（完整的实现计划）作为输入，走 plan 分支：
prepare (with ideas) → code-survey (plan) → implementation-plan → ml-dev → submit/refine

注意：plan 模式跳过 idea-generation 和 repo-acquisition。
```

**预期输出**:
- Orchestrator 判定输入成熟度为 **plan-level**
- 跳过 idea-generation 和 repo-acquisition
- 使用 `task1` 的内容作为 `ideas` 参数

---

## 1. inno-prepare-resources (单独测试)

### 测试 1.1: 加载实例并准备资源

**输入 Prompt**:

```
请执行 inno-prepare-resources 技能。

参数:
- instance_path: /home/dingjie/workspace/medical/Medical_ai_scientist_idea/benchmark/final-med/nlp_qa/nlp_qa_1.json
- task_level: task2
- category: nlp_qa

请完成以下步骤:
1. 调用 load_instance 加载实例，获取 source_papers、task_instructions、date_limit
2. 执行 github_search 搜索参考论文对应的 GitHub 仓库
3. 调用 Prepare Agent 克隆相关代码仓库到 Experiment/code_references/
4. 下载 arXiv 论文源码到 Ideation/references/papers/

完成后请报告:
- 加载了多少篇 source_papers
- date_limit 是什么
- 克隆了哪些仓库（名称和路径）
- arXiv 下载了哪些论文
```

**预期输出**:

| 检查项 | 预期值 |
|--------|--------|
| source_papers 数量 | 14 |
| date_limit | `2017-06-26` |
| task_instructions | 包含 "biomedical question answering" 的背景描述 |
| 克隆的仓库 | TorchGlove (`Experiment/code_references/TorchGlove`), GloVe-PyTorch (`Experiment/code_references/GloVe-PyTorch`), mikolov_word2vec (`Experiment/code_references/mikolov_word2vec`) |
| reference_papers | "Global vectors for word representation", "Distributed representations of words and phrases and their compositionality" |
| arXiv 下载结果 | "Distributed representations..." 成功; "Global vectors..." 失败 (`[No Match]`) |

**验证日志文件**:
```
Ideation/references/logs/load_instance.json      → args.task_level == "task2"
Ideation/references/logs/github_search.json      → result 非空
Ideation/references/logs/download_arxiv_source_by_title.json → result 包含 1 成功 + 1 失败
Ideation/references/logs/prepare_agent.json     → 最后一条消息调用 case_resolved
```

---

## 2. inno-idea-generation (单独测试)

### 测试 2.1: 生成多个 idea 并选择最佳

**输入 Prompt**:

```
请执行 inno-idea-generation 技能。

前置条件 (来自 prepare 步骤的输出):
- 任务领域: BioASQ Biomedical Factoid QA（生物医学事实型问答）
- 参考代码库: TorchGlove, GloVe-PyTorch, mikolov_word2vec
- 论文源码已下载到 Ideation/references/papers/
- date_limit: 2017-06-26
- task_instructions: "The primary task or problem domain the research tackles is biomedical question answering (QA), specifically focused on factoid and list questions within the context of the BioASQ challenge..."

请完成以下步骤:
1. 生成第一个原始 idea（包含 Title、Core Modules(3)、Challenges、Motivation、Proposed Method、Key Equations）
2. 在多样性约束下再生成 4 个不同的 idea（共 5 个）
   - 约束: 不引入新的输入模态、数据源或标签；不改变任务、疾病/条件、主要模态或预测目标
3. 从 5 个 idea 中选择最佳一个
4. 用 doctor/engineer 专家精炼选中的 idea
5. 扫描本地 .tex 文件获取额外证据

完成后请报告:
- 5 个 idea 的标题列表
- 选中了哪个 idea
- 精炼后的 idea 标题和核心模块
```

**预期输出**:

| 检查项 | 预期值 |
|--------|--------|
| 生成 idea 数量 | 5 个（各有不同标题和方法） |
| 每个 idea 结构 | Title + Core Modules(3) + Challenges + Motivation + Proposed Method + Key Equations |
| 多样性 | 5 个 idea 方法各不相同（如 phrase-mining, dual-pointer, graph-attention, morphology, Sinkhorn 等） |
| 选中的 idea | 应该是评分最高的一个 |
| 精炼内容 | 包含 medical_evidence, medical_reasoning, engineering_evidence, engineering_reasoning 的补充 |

**参考输出（nlp_qa_1 实际运行结果）**:
- Idea 1: "BioPhrase-Reader: Phrase-Aware, Contrastive Span QA for BioASQ"
- Idea 2: "BioDual-Pointer Evidence Aggregator: Multi-View Calibration..."
- Idea 3: "BioGraph-Span: Evidence Chain Graph Attention..."
- Idea 4: "BioCoFi-Morph: Coarse-to-Fine Morphology-Constrained..."
- Idea 5: "BioSinkhorn-Span: Joint 2D Span Scoring with Sinkhorn..." ← **选中**
- 精炼后: "BioSinkhorn-Span++" (增加了 alias-aware supervision, QA-interaction distillation)

**验证日志文件**:
```
Ideation/ideas/logs/idea_generation_agent.json                  → 第一个 idea
Ideation/ideas/logs/idea_generation_agent_iter_1~4.json         → 后续 4 个 idea
Ideation/ideas/logs/idea_generation_agent_iter_select.json      → 选择结果
Ideation/ideas/logs/*_final_refinement.json (×6)                → 专家精炼
```

---

## 3. inno-code-survey (单独测试 — Phase A: Repo Acquisition + Phase B: Code Survey)

### 测试 3.1: Phase A — 为选中的 idea 获取所需代码库

**输入 Prompt**:

```
请执行 inno-code-survey 技能的 Phase A（Repo Acquisition）。

前置条件:
- 选中的 idea: "BioSinkhorn-Span: Joint 2D Span Scoring with Sinkhorn Normalization and Question-Conditional Sparse Biases for BioASQ Factoid QA"
- 该 idea 需要以下技术组件:
  - Sinkhorn normalization / optimal transport
  - Entmax sparse attention (alpha-entmax)
  - Character n-gram overlap / text distance
  - Span-length prior / semi-Markov models
  - BiDAF-style attention
- 已有代码库: TorchGlove, GloVe-PyTorch, mikolov_word2vec

请搜索 GitHub 并克隆与上述技术相关的代码仓库到 Experiment/code_references/ 目录下。
完成后报告:
- 新获取的仓库列表（名称 + 路径）
- 更新后的 prepare_res（reference_codebases 和 reference_paths）
```

**预期输出**:

| 检查项 | 预期值 |
|--------|--------|
| 新获取仓库数量 | 5~8 个（取决于搜索结果） |
| 必须包含的仓库 | `entmax`（sparse attention）, `geomloss`（Sinkhorn/OT）, `textdistance`（n-gram overlap） |
| 可选的仓库 | `pytorch-struct`, `parser`(supar), `SuperGluePretrainedNetwork`, `numerical-tours` |
| `[REPO_ACQUIRED]` 标记 | 每个成功克隆的仓库都应输出 `[REPO_ACQUIRED] name=<name>; path=<path>` |
| prepare_res 更新 | `reference_codebases` 和 `reference_paths` 应从 3 个增长到 ~10 个 |

**参考输出（nlp_qa_1 实际运行结果）**:
```
acquired_code_repos:
  SuperGluePretrainedNetwork → Experiment/code_references/SuperGluePretrainedNetwork
  entmax                     → Experiment/code_references/entmax
  numerical-tours            → Experiment/code_references/numerical-tours
  geomloss                   → Experiment/code_references/geomloss
  textdistance               → Experiment/code_references/textdistance
  parser                     → Experiment/code_references/parser
  pytorch-struct             → Experiment/code_references/pytorch-struct
```

**验证日志**:
```
Experiment/code_references/logs/repo_acquisition_agent.json → context_variables.acquired_code_repos 非空
```

---

### 测试 3.2: Phase B — 对获取的代码库进行 code survey

**输入 Prompt**:

```
请执行 inno-code-survey 技能的 Phase B（Code Survey）。

前置条件:
- 选中的 idea: "BioSinkhorn-Span" — 包含 3 个模块:
  Module 1: Bi-affine 2D Joint Span Scoring with Masked Sinkhorn Normalization
  Module 2: Question-Conditional Sparse Attention and Char-N-gram Overlap Bias
  Module 3: Question-Conditioned Span-Length Prior

- 可用代码库（路径在 Experiment/code_references/ 下）:
  TorchGlove, GloVe-PyTorch, mikolov_word2vec,
  entmax, geomloss, textdistance, pytorch-struct, parser, SuperGluePretrainedNetwork, numerical-tours

请浏览这些代码库的结构和关键文件，生成一份代码调研报告:
- 将每个模块映射到可用代码库中的具体实现文件
- 说明如何复用或参考这些代码来实现我们的 idea
```

**预期输出**:

| 检查项 | 预期值 |
|--------|--------|
| Module 1 (Sinkhorn) 映射 | `geomloss/sinkhorn_divergence.py` — Sinkhorn loop, epsilon scheduling |
| Module 2 (entmax + overlap) 映射 | `entmax/activations.py` or `entmax/root_finding.py` — EntmaxBisect; `textdistance/token_based.py` — Jaccard |
| Module 3 (length prior) 映射 | `pytorch-struct/semimarkov.py` — Semi-Markov span modeling |
| 辅助映射 | `parser/supar/modules/affine.py` — Biaffine scoring; `parser/supar/modules/lstm.py` — CharLSTM |
| 输出格式 | 结构化的 Implementation Report，包含每个模块对应的代码文件、函数、使用方式 |

**验证**:
```
context_variables.model_survey → 非空字符串，包含 "geomloss", "entmax", "textdistance" 等关键词
Experiment/code_references/logs/code_survey_agent.json → context_variables.model_survey 完整
```

---

## 4. inno-experiment-dev (单独测试)

### 测试 4.1: 生成实现计划 + 实现代码 + Judge 迭代 + 提交实验

**输入 Prompt**:

```
请执行 inno-experiment-dev 技能。

前置条件:
- Idea: "BioSinkhorn-Span" (3 个模块: Sinkhorn joint scoring, entmax sparse attention, span-length prior)
- Code survey 结果: Module1→geomloss, Module2→entmax+textdistance, Module3→pytorch-struct
- 参考代码库: entmax, geomloss, textdistance, pytorch-struct, parser 等
- 数据集: BioASQ Factoid QA (位于 Experiment/datasets/bioasq/)
- max_iter_times: 1

请完成全部 3 个阶段:

Phase 1 - 实现计划:
1. 数据处理计划: 如何读取 BioASQ 数据、tokenization、span alignment
2. 模型架构: BiLSTM encoder, BiDAF attention, Sinkhorn joint scoring, entmax marginals, length prior
3. 训练配置: optimizer (Adam), learning rate, batch size, max epochs
4. 损失函数: joint NLL + length KL regularization
5. 测试方案: Strict Accuracy, Lenient Accuracy, MRR
6. 文件布局: project/ 目录结构

Phase 2 - 代码实现与 Judge 迭代:
1. 根据实现计划创建项目目录结构和 Python 文件
2. 实现模型并用 Judge 评审，最多迭代 1 次

Phase 3 - 提交实验:
1. 调整 epochs (3-10)，运行完整实验
2. 确保模型 checkpoint 被保存
```

**预期输出**:

| 检查项 | 预期值 |
|--------|--------|
| dataset_plan | 包含 `read_data`（Python reader 代码）, `data_preprocessing`（tokenization + span alignment）, `data_dataloader`（PyTorch Dataset/DataLoader） |
| training_plan | 包含 `training_pipeline`（模型骨架代码）, `loss_function`（L_joint + β_len L_len）, `optimizer`（Adam, lr=2e-3）, `training_configurations` |
| testing_plan | 包含 `test_metric`（SAcc, LAcc, MRR 定义 + Python 代码）, `test_data`（BioASQ test files）, `test_function`（评估循环代码） |
| 创建的目录 | `Experiment/core_code/data/`, `Experiment/core_code/model/`, `Experiment/core_code/training/`, `Experiment/core_code/testing/`, `Experiment/core_code/data_processing/`, `Experiment/core_code/checkpoints/` |
| 创建的文件 | 至少包含: 模型定义文件、数据加载文件、训练脚本、测试脚本、`run_training_testing.py` |
| Judge 评审 | 将 idea 分解为 atomic checks，逐一验证代码实现 |
| `fully_correct` | 可能为 `false`（需要修改） |
| 迭代修复 | 修复 tensor size mismatch、import errors 等运行时问题 |
| submit_res | 包含完整训练/测试结果（3-10 epochs），checkpoint 已保存 |

**参考（nlp_qa_1 实际运行中遇到的错误）**:
```
raw_error_stats:
  FILE_MISSING: 2
  ImportError (relative import beyond top-level): 1
  RuntimeError (tensor size mismatch 384 vs 256): 1
  RuntimeError (Boolean value of Tensor ambiguous): 1
```

**验证日志**:
```
Experiment/core_code/logs/coding_plan_agent.json              → context_variables 包含 dataset_plan, training_plan, testing_plan
Experiment/core_code/logs/machine_learning_agent.json         → 初始实现
Experiment/core_code/logs/judge_agent.json                    → Judge 评审结果
Experiment/core_code/logs/machine_learning_agent_iter_submit.json → 提交实验结果
```

---

## 5. inno-experiment-analysis (单独测试)

### 测试 5.1: 分析实验结果并改进

**输入 Prompt**:

```
请执行 inno-experiment-analysis 技能。

前置条件:
- ML 实现已完成并提交（经过 inno-experiment-dev），代码在 Experiment/core_code/ 下
- 数据集: Experiment/datasets/bioasq/
- judge_messages: 来自上一步的完整对话记录
- exp_iter_times: 1

请完成:
1. Analyze: 分析实验结果，生成 analysis_report，绘制图表
2. Code Suggestions: 基于分析给出改进计划 (further_plan)
3. Refine: 基于分析结果改进代码并重新运行

报告:
- 训练日志（epochs, loss）
- 测试指标（如果有: SAcc, LAcc, MRR）
- 分析报告的主要发现
- 改进计划的具体步骤
- 改进后的实验结果
```

**预期输出**:

| 检查项 | 预期值 |
|--------|--------|
| experiment_report | 包含 `analysis_report`（详细分析）和 `further_plan`（改进步骤字典） |
| analysis_report | 包含详细的结果分析、root cause 分析、与 idea 的关联分析 |
| further_plan | 多个具体的改进行动（如 A1: 修复 embedding, A2: 调整 lr, ... A12） |
| 改进实现 | ML Agent 根据 further_plan 修改代码并重新运行实验 |
| 图表 | 可能包含 loss curves、accuracy 对比图等 |

**参考（nlp_qa_1 实际运行结果）**:
```
experiment_report 包含:
  analysis_report: 详细的结果分析、root cause 分析、alignment checks
  further_plan: 12 个改进步骤 (A1-A12)
```

**验证日志**:
```
Experiment/analysis/logs/experiment_analysis_agent_iter_refine_1.json → experiment_report 非空
Experiment/analysis/logs/machine_learning_agent_iter_refine_1.json   → 改进后的代码和结果
```

---

## 单个 Skill 快速测试 Prompt 模板

如果只想快速验证某个 Skill 是否被正确识别和调用，可以使用以下简短 prompt:

### 触发 orchestrator:
```
我有一个研究实例文件 /home/dingjie/workspace/medical/Medical_ai_scientist_idea/benchmark/final-med/nlp_qa/nlp_qa_1.json，请帮我启动 Research Pipeline。
```

### 触发 prepare:
```
请加载实例文件 /home/dingjie/workspace/medical/Medical_ai_scientist_idea/benchmark/final-med/nlp_qa/nlp_qa_1.json (task_level=task2, category=nlp_qa)，准备参考论文和代码库。
```

### 触发 idea-gen:
```
我的研究方向是 BioASQ biomedical factoid QA。参考论文涉及 neural QA、GloVe、biomedical word2vec。请帮我生成多个创新 idea 并选择最佳方案。
```

### 触发 code-survey (Phase A — repo acquisition)：
```
我的 idea 是 "BioSinkhorn-Span"，需要 Sinkhorn normalization、entmax sparse attention、character n-gram overlap 相关的代码库。请从 GitHub 搜索并克隆相关仓库。
```

### 触发 code-survey (Phase B — code survey):
```
请对 Experiment/code_references/ 下的代码库（entmax, geomloss, textdistance, pytorch-struct, parser）进行 code survey，分析哪些文件可以复用来实现 BioSinkhorn-Span 的三个模块。
```

### 触发 experiment-dev:
```
请根据 code survey 结果和 BioSinkhorn-Span idea，生成详细的实现计划，编写代码并用 Judge 评审（最多迭代 1 次），最后提交实验运行。数据集在 Experiment/datasets/bioasq/。
```

### 触发 experiment-analysis:
```
代码实现已提交并有初始实验结果。请分析结果、绘制图表、给出改进建议，并实现改进后重新运行实验。数据集在 Experiment/datasets/bioasq/。
```

### 触发 paper-writing:
```
实验已完成并分析完毕。请基于 Experiment/core_code/ 的代码和实验结果，使用 NeurIPS 2025 模板为 BioSinkhorn-Span 撰写一篇完整的论文草稿。输出到 Publication/paper/ 目录。
```

---

## 6. inno-paper-writing (单独测试)

### 测试 6.1: 基于实验结果撰写论文

**输入 Prompt**:

```
请执行 inno-paper-writing 技能。

前置条件:
- Idea: "BioSinkhorn-Span" — 完整的 idea 描述在 Ideation/ideas/selected_idea.txt
- 实验代码: Experiment/core_code/ 下的完整项目
- 实验结果: Experiment/core_code/results.json 和 Experiment/analysis/ 下的图表
- 参考论文: Ideation/references/papers/ 下的 arXiv 源码
- 代码调研: Experiment/code_references/model_survey.md
- 目标会议: NeurIPS 2025

请完成:
1. 探索项目仓库，理解核心贡献和主要实验结果
2. 搜索相关文献并验证引用
3. 使用 NeurIPS 2025 模板撰写完整的论文草稿
4. 将论文输出到 Publication/paper/ 目录

报告:
- 论文结构（各 section 概要）
- 使用的引用数量（已验证 vs 需人工确认）
- 论文长度是否符合 page limit
```

**预期输出**:

| 检查项 | 预期值 |
|--------|--------|
| 模板来源 | `skills/inno-paper-writing/templates/neurips2025/` |
| 输出目录 | `Publication/paper/` 下包含 `main.tex`, `neurips.sty`, `references.bib` 等 |
| 论文结构 | Abstract, Introduction, Methods, Experiments, Related Work, Limitations, Conclusion |
| 引用验证 | 所有引用通过 Semantic Scholar API 验证或标记为 `[PLACEHOLDER]` |
| Page limit | ≤ 9 pages（不含 references 和 appendix） |
| 匿名化 | 无作者信息、无致谢、自引用使用第三人称 |

---

## 验证数据参考

### 输入文件 (Instance JSON) 关键字段

```json
{
  "target": "Neural Question Answering at BioASQ 5B",
  "source_papers": [ /* 14 篇论文 */ ],
  "authors": ["Georg Wiese", "Dirk Weissenborn", "Mariana Neves"],
  "year": 2017,
  "url": "http://arxiv.org/abs/1706.08568v1",
  "task1": "To implement the methodology outlined in this paper...",  // 完整计划 → plan mode
  "task2": "The primary task or problem domain the research tackles is biomedical question answering (QA)...",  // 背景描述 → idea mode
  "instance_id": "nlp_qa_1"
}
```

### 预期的 context_variables 快照 (pipeline 完成后)

```json
{
  "project_path": "<project_path>",
  "references_path": "<project_path>/Ideation/references/",
  "ideas_path": "<project_path>/Ideation/ideas/",
  "code_references_path": "<project_path>/Experiment/code_references/",
  "datasets_path": "<project_path>/Experiment/datasets/",
  "core_code_path": "<project_path>/Experiment/core_code/",
  "analysis_path": "<project_path>/Experiment/analysis/",
  "date_limit": "2017-06-26",
  "prepare_result": {
    "reference_codebases": ["TorchGlove", "GloVe-PyTorch", "mikolov_word2vec", "SuperGluePretrainedNetwork", "entmax", "numerical-tours", "geomloss", "textdistance", "parser", "pytorch-struct"],
    "reference_paths": ["Experiment/code_references/TorchGlove", "Experiment/code_references/GloVe-PyTorch", "..."],
    "reference_papers": ["Global vectors for word representation", "Distributed representations of words and phrases and their compositionality"]
  },
  "idea_generation_history": [ /* 5 entries, rounds 1-5 */ ],
  "final_selected_idea_data": {
    "raw_idea": "Title: BioSinkhorn-Span...",
    "refined_idea_text": "Title: BioSinkhorn-Span..."
  },
  "acquired_code_repos": {
    "SuperGluePretrainedNetwork": "Experiment/code_references/SuperGluePretrainedNetwork",
    "entmax": "Experiment/code_references/entmax",
    "geomloss": "Experiment/code_references/geomloss",
    "textdistance": "Experiment/code_references/textdistance",
    "pytorch-struct": "Experiment/code_references/pytorch-struct",
    "parser": "Experiment/code_references/parser",
    "numerical-tours": "Experiment/code_references/numerical-tours"
  },
  "model_survey": "... Implementation Report: BioSinkhorn-Span ...",
  "dataset_plan": { "dataset_description": "BioASQ Factoid QA...", "..." : "..." },
  "training_plan": { "training_pipeline": "...", "..." : "..." },
  "testing_plan": { "test_metric": "SAcc, LAcc, MRR...", "..." : "..." },
  "suggestion_dict": { "fully_correct": false, "suggestion": null },
  "raw_error_stats": { "FILE_MISSING::...": 2, "GENERIC::ImportError...": 1, "..." : "..." }
}
```
