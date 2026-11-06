---
name: inno-grant-proposal
source: dr-claw
description: >
  Help professors and researchers write, revise, adapt, and polish grant proposals
  for US agencies (NSF, NIH, DOE, DARPA, NASA), Chinese agencies (NSFC 国自然),
  and other national agencies (JSPS KAKENHI 科研費, ERC, DFG, SNSF, ARC, NWO).
  Use this skill whenever the user mentions grants, proposals, funding applications,
  基金申请, 本子, R01, R21, CAREER, 面上, 青年基金, specific aims, 立项依据,
  broader impacts, or wants to plan, draft, review, or resubmit any research
  funding proposal — even if they don't explicitly say "grant". Also use this
  skill when the user wants to adapt a previous proposal for a new submission.
  Six-phase workflow: profiling → planning → drafting → quality review →
  simulated peer review → submission prep.
allowed_tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - WebFetch   # Use to verify current salary caps, deadlines, or solicitation details
  - WebSearch  # Use to look up specific program announcements or funding opportunities
---

# Grant Proposal Skill

## Core Philosophy

Three principles govern every interaction:

1. **Grant applications are arguments, not requests.** Every section must advance a
   persuasive case. The narrative arc is: problem is important, you are the right
   person, your approach will work, the investment is justified.
2. **Write like a domain expert, not a template filler.** Generic language kills
   proposals. Every sentence must reflect deep knowledge of the specific field.
3. **Grant is not Paper.** A paper reports results; a grant sells a future. Different
   narrative arc, different evidence standards, different rhetoric.

Additional operating principles:

- **Reviewer perspective, not applicant perspective.** Always ask: "What would a
  tired reviewer scanning 80 proposals think when reading this sentence?"
- **Every claim needs evidence; every expense needs task traceability.**
- **Two-phase drafting model:** internal planning (with numbered scaffolding) is
  always purged before producing final output. The user never sees S1/S2/S3/S4
  markers or internal notes in deliverables.

---

## Routing Logic

On first interaction, determine the track:

```
IF user mentions NSFC / 国自然 / 青年基金 / 面上 / 地区 / 重点 / Chinese agency
   → CN MODE
ELIF user mentions NSF / NIH / DOE / DARPA / NASA / R01 / R21 / CAREER / US agency
   → US MODE
ELIF user mentions KAKENHI / 科研費 / JSPS / ERC / DFG / SNSF / ARC / NWO / another national agency
   → INTL MODE: follow the US-mode phases, but take section structure, language,
     review criteria and drafting norms from references/intl/international_guides.md
     and the agency's current call text
ELSE
   → ASK: "Are you targeting a US agency (NSF, NIH, DOE, DARPA, NASA) or a
     Chinese agency (NSFC programs)? This determines the template, structure,
     and review criteria I will use."
```

**Language strategy:**
- CN mode: draft proposal content in Chinese (中文), but interact in whatever
  language the user uses.
- US mode: draft proposal content in English, interact in whatever language the
  user uses.
- Internal skill instructions are always in English.

---

## State Persistence

All session state is saved to `GRANT_STATE.json` in the working directory.

### GRANT_STATE.json Schema

```json
{
  "meta": {
    "track": "US" | "CN",
    "agency": "NSF" | "NIH" | "DOE" | "DARPA" | "NASA" | "NSFC",
    "program": "string (e.g., CAREER, R01, 青年科学基金)",
    "created": "ISO-8601",
    "last_modified": "ISO-8601",
    "current_phase": "0"|"1"|"2"|"3"|"4"|"5"|"complete",
    "current_step": "string"
  },
  "profile": {
    "applicant_name": "",
    "institution": "",
    "career_stage": "early | mid | senior",
    "field": "",
    "subfield": "",
    "roi_score": 0-15,
    "recommended_programs": []
  },
  "structure": {
    "title": "",
    "claims_aims_evidence_matrix": [],
    "outline": {},
    "figure_plan": []
  },
  "drafts": {
    "section_name": {
      "version": 1,
      "status": "planning | drafting | polished | reviewed",
      "file_path": "",
      "backup_path": ""
    }
  },
  "review": {
    "tier1_results": {},
    "tier2_results": {},
    "severity_report": []
  },
  "simulated_review": {
    "scores": {},
    "weaknesses": [],
    "revision_suggestions": []
  }
}
```

**Rules:**
- Read `GRANT_STATE.json` at the start of every conversation turn to resume context.
- Write `GRANT_STATE.json` after completing any phase or significant sub-step.
- If the file does not exist, create it during Phase 0.

---

## Safety Rules

1. **Auto-backup before writes.** Before overwriting any file, copy the existing
   version to `backups/<section_name>_v<N>.<timestamp>.txt`. Use Bash `cp` for this.
   If `backups/` does not exist, create it with `mkdir -p backups` before the first backup.
2. **Never modify the user's original files without confirmation.** If the user
   provides source files, work on copies. Always ask before writing back.
3. **Warn on destructive operations.** If a phase would discard previous work
   (e.g., re-running Phase 1 after Phase 2 drafting), warn the user and require
   explicit confirmation.
4. **Sensitive data.** Never include PI personal information (SSN, bank details)
   in any generated file. If encountered, warn and redact.

---

## Reference Files

The skill uses supporting files in sibling directories:

- `references/us/` — US agency guidelines: `nsf_guide.md`, `nih_guide.md`, `doe_guide.md`, `darpa_guide.md`, `nasa_guide.md`
- `references/cn/` — CN agency guidelines: `nsfc_guide.md`
- `references/intl/` — other agencies (KAKENHI, ERC, DFG, SNSF, ARC, NWO): `international_guides.md`
- `references/common/` — shared resources: `reviewer_personas.md`, `common_mistakes.md`, `resubmission.md`
- `references/rubrics/` — scoring rubrics: `nsf_rubric.json`, `nih_rubric.json`, `nsfc_rubric.json`
- `templates/us/` — US templates: `nih_specific_aims.md`, `nsf_project_summary.md`, `budget_justification.md`
- `templates/cn/` — CN templates: `nsfc_justification.md`, `nsfc_research_content.md`, `nsfc_research_foundation.md`, `nsfc_abstract_5sentence.md`
- `config.yaml` — skill configuration: supported agencies/programs, golden ratio
  benchmarks, AI-flavor patterns, severity levels. Read at Phase 0 initialization.
- `scripts/` — deterministic check scripts:
  - `validate_length.py` — section length vs golden ratio/page limits
  - `validate_citations.py` — citation consistency and completeness
  - `compliance_check.py` — format compliance and AI-flavor detection

When a phase requires a reference or template, load it with `Read` from these
directories. If a needed file is missing, inform the user and proceed with
built-in knowledge, noting the gap.

**Lazy Loading:** Do NOT read all reference files at once. Load only the files
needed for the current phase and agency track. For example:
- Phase 1 (CN track): read `references/cn/nsfc_guide.md` only, not all US guides
- Phase 4 (NIH): read `references/rubrics/nih_rubric.json` + `references/common/reviewer_personas.md`, not NSF/NSFC rubrics
- Templates: read the specific template being used, not all templates
This keeps context focused and reduces token usage by ~60%.

---

## Phase 0: Project Profiling & Grant Matching

### Entry Criteria
- User has initiated a conversation about a grant proposal.

### Workflow

**Step 0.1 — Collect Applicant Profile**

Gather (ask if not provided):
- Name, institution, department
- Career stage: early-career (< 5 yrs post-PhD), mid-career, senior
- Research field and subfield
- Track record summary: key publications, prior funding, preliminary data
- For CN: age (relevant for Youth Fund 青年科学基金 age cap of 35/40)
- For US: citizenship/residency status (relevant for some programs)

**Step 0.2 — Collect Project Concept**

Gather:
- One-paragraph project description
- Key innovation / what is new
- Why now? (timeliness)
- Preliminary data available? (yes/no/partial)
- Target budget range
- Target submission deadline

**Step 0.3 — ROI Scoring (0-15)**

Score the project's fundability across five dimensions (0-3 each):

| Dimension | 0 | 1 | 2 | 3 |
|-----------|---|---|---|---|
| **Significance** | Incremental | Moderate gap | Clear gap | Urgent national priority |
| **Innovation** | Standard method | Novel combination | New approach | Paradigm shift potential |
| **Investigator fit** | Tangential | Related | Strong match | World expert |
| **Preliminary data** | None | Conceptual | Partial | Convincing dataset |
| **Timeliness** | No urgency | Modest momentum | Active field | Hot topic + policy alignment |

Report the total score and interpretation:
- 0-5: High risk. Recommend strengthening concept before applying.
- 6-9: Competitive with strong writing. Proceed with caveats noted.
- 10-12: Strong candidate. Proceed confidently.
- 13-15: Exceptional. Consider flagship programs.

**Step 0.4 — Agency & Program Recommendation**

Based on track, field, career stage, and ROI score, recommend 1-3 programs:

*US Track Programs:*
| Agency | Program | Best For |
|--------|---------|----------|
| NSF | CAREER | Early-career faculty, broad impact |
| NSF | Standard/Collaborative | Established investigators |
| NIH | R01 | Biomedical, 4-5 year projects |
| NIH | R21 | Exploratory/high-risk biomedical |
| DOE | Early Career | Energy/physics early-career |
| DARPA | Young Faculty Award | Defense-relevant, high-risk |
| NASA | FINESST | Graduate student fellowships |

*CN Track Programs (NSFC):*
| Program | Chinese Name | Best For |
|---------|-------------|----------|
| Youth Fund | 青年科学基金 | Under 35 (male) / 40 (female), first NSFC |
| General Program | 面上项目 | Established researchers, broad |
| Regional Fund | 地区科学基金 | Researchers at western/regional institutions |
| Key Program | 重点项目 | Senior PIs, larger scope |

Present recommendation with reasoning. Get user confirmation before proceeding.

**Step 0.5 — Initialize State**

Create `GRANT_STATE.json` with profile, track, agency, program. Set `current_phase: "1"`.

### Exit Criteria
- `GRANT_STATE.json` exists with completed profile section.
- User has confirmed agency/program selection.

---

## Phase 1: Structure Planning

### Entry Criteria
- Phase 0 complete. `GRANT_STATE.json` has profile and agency/program.

### Reference Loading
- Read `references/us/nsf_guide.md` or `references/us/nih_guide.md` (US track) or `references/cn/nsfc_guide.md` (CN track) depending on the selected agency.
- Read `references/common/common_mistakes.md` for pitfalls to avoid during planning.

### Workflow

**Step 1.1 — Title Crafting**

Generate 3-5 candidate titles following agency conventions:
- US: Typically "Action-Oriented Noun Phrase: Specific Technical Approach"
  - NSF CAREER example: "CAREER: Enabling Scalable X Through Novel Y"
- CN: Typically "基于[方法]的[对象][目标]研究"
  - NSFC example: "基于深度学习的城市地表温度时空精细化反演研究"

User selects or modifies. Save to state.

**Step 1.2 — Claims-Aims-Evidence Matrix**

Build a matrix connecting the argument structure:

```
| Claim (Why it matters) | Aim/Objective | Key Evidence | Gap Addressed |
|------------------------|---------------|--------------|---------------|
| Claim 1: ...           | Aim 1: ...    | Prelim data, lit | Gap 1: ... |
| Claim 2: ...           | Aim 2: ...    | Method validation | Gap 2: ... |
| Claim 3: ...           | Aim 3: ...    | Pilot study  | Gap 3: ...    |
```

Rules:
- Every claim must have at least one piece of evidence.
- Every aim must address at least one gap.
- 2-4 aims is typical. More than 4 signals scope creep.
- Aims should be independent enough that failure of one does not block others.

Save matrix to state.

**Step 1.3 — Outline Generation**

*US Track — Generate skeleton for:*

For NIH R01/R21:
1. Specific Aims (1 page)
   - Opening paragraph: significance + gap
   - Long-term goal + objective of this application
   - Central hypothesis + rationale
   - Aim 1 with hypothesis and approach summary
   - Aim 2 with hypothesis and approach summary
   - Aim 3 (if applicable)
   - Payoff paragraph
2. Research Strategy
   - Significance (establish importance, identify gap, state contribution)
   - Innovation (conceptual, technical, methodological novelty)
   - Approach (per aim: rationale, methods, expected outcomes, pitfalls,
     alternatives, timeline)
3. Project Summary / Abstract

For NSF:
1. Project Summary (1 page: overview, intellectual merit, broader impacts)
2. Project Description (15 pages max)
   - Introduction + background
   - Proposed research (per aim)
   - Broader impacts
   - Results from prior support
   - Timeline / milestones
3. References Cited

*CN Track — Generate skeleton for NSFC:*

**Page Budget (Golden Ratio):** Cite these benchmarks explicitly when planning:
- 立项依据 ≈ 30% of total pages (including references; actual text ~4-6 pages)
- 研究内容+创新+年度计划 ≈ 50% (figure-heavy, 10-20 figures)
- 研究基础+工作条件 ≈ 20%
- Total target: 12,000-15,000 characters, 12-15 pages, under 28 pages hard limit

1. Title and basic info (项目名称、基本信息)
2. Project rationale (立项依据) — use the four-paragraph closure model:
   - Para 1: Field significance + macro context (大背景)
   - Para 2: Current state of research + what has been achieved (研究现状)
   - Para 3: Remaining problems + specific gaps (存在问题)
   - Para 4: This project's entry point + why it will work (本项目切入点)
   The four paragraphs must form a logical closure: significance → progress →
   gaps → your solution. The reader should feel "of course this is the next
   step" by paragraph 4.
3. Research content (研究内容) — internal planning uses S1-S4 structure.
   **S1-S4 are planning DIMENSIONS, not timeline phases:**
   - S1: Problem decomposition (问题分解) — break the core question into
     3-4 researchable modules, each mapping to a research content section
   - S2: Feasibility pre-check (可行性预评估) — for each module, assess
     key technique maturity (high/medium/low), risk points, backup plans
   - S3: Dependency mapping (依赖关系) — which module outputs feed into
     which module inputs? What can run in parallel? Define milestones.
   - S4: Innovation audit (创新点验证) — for each claimed innovation,
     self-check: has anyone done similar work? Is it method-level or
     conceptual-level? Can it be stated in one clear sentence?
   **IMPORTANT:** S1-S4 markers are for internal planning ONLY. They are purged
   before producing any user-facing output. The final text flows as continuous
   prose organized by sub-topic headings. Do NOT present S1-S4 as Year 1/2/3/4.
4. Key scientific questions (拟解决的关键科学问题, 2-3 items)
5. Research plan and timeline (研究方案及可行性分析)
6. Innovation points (特色与创新之处, 2-3 bullet points)
7. Expected outcomes (预期研究成果)
8. Research foundation (研究基础与工作条件)
9. Budget justification (经费预算说明)

**Step 1.4 — Figure Planning**

Every proposal needs figures. Plan at minimum:
- 1 conceptual/overview figure (research framework or hypothesis model)
- 1 preliminary data figure (or technical approach diagram if no prelim data)

For each planned figure, note:
- Purpose (what argument does it support?)
- Placement (which section?)
- Data source (existing or to be created?)

Save figure plan to state.

**Step 1.5 — Save & Checkpoint**

Write full outline and matrix to `GRANT_STATE.json`. Set `current_phase: "2"`.
Summarize the plan to the user and ask for approval before moving to drafting.

### Exit Criteria
- Outline approved by user.
- Claims-Aims-Evidence matrix complete.
- Figure plan documented.
- `GRANT_STATE.json` updated with structure section.

---

## Phase 2: Section-by-Section Drafting

### Entry Criteria
- Phase 1 complete. Outline approved. State file has structure.

### Reference Loading
- Read the appropriate templates from `templates/us/` (US track) or `templates/cn/` (CN track) for the sections being drafted.
- Read `references/common/common_mistakes.md` for common drafting pitfalls.

### General Drafting Protocol

For EVERY section, follow the two-phase model:

**Planning Phase (internal, not shown to user as final output):**
1. Identify the section's argumentative role in the overall proposal.
2. List the key points that must appear, with evidence for each.
3. Note the review criteria this section addresses.
4. Set target length based on agency page limits and golden-ratio benchmarks.
5. For CN: use S1-S4 internal numbering to organize thoughts.

**Narrative Phase (user-facing output):**
1. Write flowing, expert-level prose. No bullet lists in narrative sections
   unless the agency template calls for them.
2. Purge all internal planning markers (S1, S2, etc.).
3. Ensure every paragraph has a topic sentence and advances the argument.
4. Include figure references where planned.
5. Match the voice and tone conventions of the target agency.

### Section-Specific Guidance

**US Track: Specific Aims / Project Summary**

The Specific Aims page is the most important page in any NIH proposal.
Structure:
- Opening hook: one sentence establishing the big problem.
- Narrow to the specific gap (2-3 sentences with citations).
- "The long-term goal of [PI] is... The objective of this application is..."
- "Our central hypothesis is... This hypothesis is based on..."
- Aim 1: [action verb] [what] [method] [expected outcome]
- Aim 2: same pattern
- Aim 3: same pattern (optional)
- Payoff paragraph: what changes if this succeeds?

For NSF Project Summary: three separate sections clearly labeled Overview,
Intellectual Merit, Broader Impacts. Each ~200 words. No jargon in Broader
Impacts — a program officer outside your subfield will read it.

**CN Track: Project Rationale (立项依据)**

Follow the four-paragraph closure model from Step 1.3. Additional rules:
- Citation density: aim for 30-50 references. Under 20 signals shallow review.
- Include both international and domestic (Chinese) references.
- Do not merely list references — synthesize and critique.
- End with a clear statement: "因此，本项目拟..." connecting rationale to your
  proposed work.

**CN Track: Research Content (研究内容)**

Internal planning (S1-S4) guides the structure, but output is organized by
research sub-topics. Each sub-topic section includes:
- What will be studied (研究对象)
- How it connects to the scientific question
- Methods to be used
- Expected results for this sub-topic

**Agency-Specific Templates**

Load the appropriate template from `templates/` for the target agency/program.
If a template exists, use it as the structural scaffold. Key templates:

- `templates/us/nih_specific_aims.md` — NIH Specific Aims page template
- `templates/us/nsf_project_summary.md` — NSF Project Summary template
- `templates/us/budget_justification.md` — US budget justification template
- `templates/cn/nsfc_justification.md` — NSFC project rationale (立项依据) template
- `templates/cn/nsfc_research_content.md` — NSFC research content (研究内容) template
- `templates/cn/nsfc_abstract_5sentence.md` — NSFC five-sentence abstract (五句模型) template

### Review Criteria Alignment

While drafting each section, keep the relevant review criteria visible:

*NIH (Scored Review Criteria):*
- Significance, Investigator(s), Innovation, Approach, Environment

*NSF (Merit Review Criteria):*
- Intellectual Merit, Broader Impacts

*NSFC (评审要点):*
- 科学意义 (Scientific significance)
- 创新性 (Innovation)
- 研究方案可行性 (Feasibility of research plan)
- 研究基础 (Research foundation)

After drafting each section, do a self-check: "Does this section explicitly
address the review criteria it should? If a reviewer is scoring criterion X,
what in this section earns a high score?"

### Figures

At least 1-2 figures are mandatory. When drafting reaches a section where a
figure was planned:
1. Describe the figure in detail (what it shows, layout, labels).
2. If the user can provide the figure, request it.
3. If generating a conceptual diagram, describe it precisely so the user can
   create or commission it.
4. Insert a placeholder: `[FIGURE X: description]` in the draft.

### Auto-Backup & Checkpoints

- Before writing any section draft to a file, back up the previous version:
  `backups/<section_name>_v<N>.<timestamp>.txt`
- After completing each section, update `GRANT_STATE.json`:
  - Set section status to "drafting" or "polished"
  - Increment version number
  - Record backup path
- After completing ALL sections for a major component (e.g., all of Research
  Strategy), pause and checkpoint: summarize what was written, ask user to
  review before proceeding.

### Exit Criteria
- All sections drafted according to the outline.
- At least 1-2 figure placeholders inserted.
- Each section backed up and tracked in state.
- `current_phase` set to `"3"` in state.

---

## Phase 3: Quality Review

### Entry Criteria
- Phase 2 complete. All sections drafted.

### Reference Loading
- Read `references/common/common_mistakes.md` for known quality issues to check.
- Read the agency guide (`references/us/nsf_guide.md`, `references/us/nih_guide.md`, or `references/cn/nsfc_guide.md`) to verify compliance requirements.

### Tier 1: Deterministic Checks

Run scripts from the `scripts/` directory for automated checks. If a script is
not available, perform the check manually.

**Length vs. Golden Ratio**
- Check each section's length against agency page/word limits.
- Compare to golden-ratio benchmarks (e.g., for NIH R01 Research Strategy 12
  pages: Significance ~2.5pp, Innovation ~1.5pp, Approach ~8pp).
- Flag sections that deviate more than 5% from benchmark ratios (matches
  `scripts/validate_length.py` threshold).

**Citation Consistency**
- Every in-text citation has a matching entry in the reference list.
- No orphaned references (listed but never cited).
- Citation format matches agency requirements (e.g., NIH uses numbered,
  NSF uses author-year typically).
- For CN: check that both Chinese and international references are included.

**Format Compliance**
- Font size, margins, page limits per agency specs.
- Required sections present (e.g., NSF requires Data Management Plan,
  Postdoctoral Mentoring Plan if applicable).
- Budget numbers consistent between narrative and budget forms.
- For CN: character count limits for abstract (400 characters), keywords (3-5).

Run checks using scripts if available:
```bash
python3 scripts/validate_length.py <proposal_dir> --mode cn|us --json
python3 scripts/validate_citations.py <file_or_dir> --mode cn|us --json
python3 scripts/compliance_check.py <file> --agency nsf|nih|nsfc --json
```

If scripts are not available or fail, perform these checks manually by reading
the draft files and applying the rules from the agency guide. Document findings
in the same P0/P1/P2 format regardless of check method.

### Tier 2: AI Semantic Checks

**Logic Coherence**
- Read the full proposal start-to-finish.
- Check: Does the rationale logically lead to the proposed work?
- Check: Are aims independent but synergistic?
- Check: Do methods match objectives?
- Check: Does the timeline align with scope?
- Check: Does the budget align with the proposed activities?

**AI-Flavor Detection (16-Item Checklist)**

Scan the draft for these common AI-writing markers. Flag any found:

Read the full 24-item checklist from `references/common/ai_flavor_checklist.md`
(items 1-16 for English, 17-24 for Chinese). For each flagged item, provide
the specific location and a concrete revision.

**Cross-Section Terminology Consistency**
- Key terms, abbreviations, and acronyms are used consistently throughout.
- The same concept is not called different names in different sections.
- Abbreviations are defined at first use.

### Severity Report

Classify every finding by severity:

- **P0 (Critical):** Will likely cause rejection. Must fix before submission.
  Examples: missing required section, exceeding page limit, contradictory aims.
- **P1 (Major):** Significantly weakens the proposal. Should fix.
  Examples: weak rationale, unclear methods, AI-flavor detected.
- **P2 (Minor):** Polish items. Fix if time permits.
  Examples: awkward phrasing, minor formatting, citation style inconsistency.

Present as a structured table:

```
| # | Severity | Section | Issue | Recommendation |
|---|----------|---------|-------|----------------|
| 1 | P0 | Specific Aims | Aim 3 overlaps with Aim 1 scope | Merge or differentiate |
| 2 | P1 | Significance | No quantitative impact data | Add statistics from ... |
| 3 | P2 | Approach | "Delve" used 4 times | Replace with varied verbs |
```

Save full report to `GRANT_STATE.json` review section.

### Exit Criteria
- All Tier 1 checks run and results documented.
- All Tier 2 checks run and results documented.
- Severity report generated with P0/P1/P2 classifications.
- `current_phase` set to `"4"` in state.
- User has reviewed the report and decided which items to address.

---

## Phase 4: Simulated Review

### Entry Criteria
- Phase 3 complete. Quality issues addressed (at minimum all P0 items).

### Reference Loading
- Read the appropriate rubric: `references/rubrics/nsf_rubric.json`, `references/rubrics/nih_rubric.json`, or `references/rubrics/nsfc_rubric.json`.
- Read `references/common/reviewer_personas.md` for detailed persona definitions and scoring guidance.
- If resubmission, also read `references/common/resubmission.md`.
- **Always include AI-flavor detection** as part of the simulated review — use the
  24-item checklist from Phase 3 (items 1-16 for English, 17-24 for Chinese).
  This is a distinct value-add that reviewers increasingly notice.

### US Track: Three-Pass Reviewer Simulation

Simulate the actual NIH/NSF review process:

**Pass 1 — Triage Scan (2-minute read)**
- Read only: title, abstract/project summary, specific aims.
- Gut reaction: Is this interesting? Is it clear? Would I keep reading?
- Score: Triage pass/fail. If fail, explain why a reviewer would stop here.

**Pass 2 — Detailed Review (15-minute read)**
- Read full proposal as assigned reviewer.
- For each review criterion (per agency), provide:
  - Strengths (numbered list)
  - Weaknesses (numbered list)
  - Score (1-9 NIH scale, or Excellent/Very Good/Good/Fair/Poor for NSF)
- Draft a mock reviewer summary statement (2-3 paragraphs).

**Pass 3 — Overall Scoring**
- Assign overall impact/merit score.
- Identify the #1 weakness that would lower the score most.
- Identify the #1 strength that carries the proposal.
- Predict a funding percentile range (approximate).

### CN Track: Seven-Persona Expert Panel (专家评审模拟)

Simulate an NSFC review panel with seven distinct reviewer personas as defined
in `references/common/reviewer_personas.md` (CN Track section). Each persona
provides 2-3 strengths, 2-3 weaknesses, a score (A/B/C/D = 优/良/中/差), and
one key question for the applicant.

**Panel Verdict:**
- 5+ personas score A or B → PASS (建议资助)
- 3+ personas score C or D → FAIL (不建议资助)
- Otherwise → BORDERLINE (建议修改后资助)

### JSON Rubric Auto-Scoring

Produce a structured scoring JSON:

```json
{
  "track": "US|CN",
  "overall_score": "number or letter",
  "criteria": [
    {
      "name": "criterion name",
      "score": "value",
      "strengths": ["..."],
      "weaknesses": ["..."]
    }
  ],
  "top_weakness": "...",
  "top_strength": "...",
  "verdict": "fund | revise | decline",
  "confidence": "high | medium | low"
}
```

### Weakness Diagnosis & Revision Suggestions

For each identified weakness:
1. Diagnose the root cause (structural, argumentative, evidential, stylistic).
2. Provide a specific, actionable revision suggestion.
3. Estimate effort (quick fix / moderate rewrite / major revision).
4. Prioritize: which fixes yield the biggest score improvement?

### Resubmission Strategy (if applicable)

If the user is working on a resubmission:
- Analyze prior review comments (user must provide).
- Map each reviewer critique to a specific section.
- Draft an "Introduction to Revised Application" (NIH) or response letter.
- For CN: prepare the 修改说明 (revision explanation).
- Strategy: address every point, but distinguish between "we revised" and
  "we respectfully disagree because..."

Save all results to `GRANT_STATE.json` simulated_review section.

### Exit Criteria
- Full simulated review complete (US: 3-pass; CN: 7-persona panel).
- Scoring JSON generated.
- Weakness diagnosis and revision suggestions documented.
- `current_phase` set to `"5"` in state.

---

## Phase 5: Final Optimization & Submission Prep

### Entry Criteria
- Phase 4 complete. Revision suggestions addressed.

### Reference Loading
- Read the appropriate templates from `templates/us/` or `templates/cn/` for final formatting.
- Read the agency guide for final compliance verification.

### Step 5.1 — Humanization / De-AI Polish

Perform a final pass to eliminate all remaining AI-flavor markers:
- Replace generic verbs with field-specific verbs.
- Add PI-specific voice markers (references to PI's own prior work, lab-specific
  terminology, institutional context).
- Vary sentence length and structure (mix short punchy sentences with longer
  analytical ones).
- Ensure specificity: replace "significant improvement" with "32% reduction
  in error rate (p < 0.01, n=200)."
- Re-run the 16-item AI-flavor checklist from Phase 3. All items must pass.

### Step 5.2 — Abstract Generation

**CN Mode — Five-Sentence Model (五句模型, ~400 characters):**
1. Sentence 1: Research background and significance (研究背景与意义)
2. Sentence 2: Core scientific question (核心科学问题)
3. Sentence 3: Research content and methods (研究内容与方法)
4. Sentence 4: Expected results (预期成果)
5. Sentence 5: Scientific significance or application value (科学意义/应用价值)

Constraint: total <=400 Chinese characters. Each sentence should be 60-100
characters. The abstract must be self-contained — a reviewer should understand
the entire project from these five sentences alone.

**US Mode — Per-Agency Format:**
- NIH: Project Summary/Abstract. 30 lines max. Structured: background, objective,
  specific aims, methods, significance.
- NSF: Project Summary. 1 page, three sections: Overview, Intellectual Merit,
  Broader Impacts. Each ~200 words.
- DOE: Abstract, typically 1 page, emphasis on energy relevance.
- DARPA: Executive summary, emphasis on military/defense relevance and technical
  risk mitigation.
- NASA: Summary, emphasis on NASA mission alignment.

### Step 5.3 — Budget Justification

Ensure budget-task traceability:

```
| Budget Item | Amount | Linked Task/Aim | Justification |
|-------------|--------|-----------------|---------------|
| Postdoc salary | $X | Aim 1, Aim 2 | Dr. Y, 100% effort, expertise in Z |
| Equipment | $X | Aim 3 | Instrument needed for measurement W |
| Travel | $X | All aims | 2 conferences/yr for dissemination |
| ...         | ...    | ...             | ...            |
```

Rules:
- Every expense must trace to at least one aim/task.
- Personnel effort percentages must sum correctly.
- For CN: follow NSFC budget categories (设备费、材料费、测试化验加工费、
  差旅费、会议费、劳务费、专家咨询费、其他).
- For US: follow agency-specific budget categories and salary caps (e.g.,
  NIH salary cap).

Load budget template from `templates/us/budget_justification.md` (US track).
For CN track, follow NSFC budget categories as described in `references/cn/nsfc_guide.md`.

### Step 5.4 — Final Compliance Check

Run a final comprehensive compliance check:

- [ ] All required sections present
- [ ] Page/word/character limits met
- [ ] Font, margins, spacing per agency specs
- [ ] All figures included and referenced
- [ ] References complete and consistently formatted
- [ ] Budget totals match between narrative and forms
- [ ] Biographical sketch / CV up to date
- [ ] Data management plan (US) or data sharing statement included
- [ ] Conflict of interest disclosures prepared
- [ ] Institutional approvals (IRB, IACUC, etc.) noted if applicable
- [ ] For CN: 400-character abstract limit met, 3-5 keywords listed
- [ ] For US: current and pending support updated
- [ ] File names follow agency naming conventions
- [ ] PDF generated and page count verified

### Step 5.5 — Post-Submission Checklist

Generate a post-submission checklist. Read `references/common/post_submission.md`
for the full US and CN track checklists. Customize for the specific agency.

### Exit Criteria
- All sections finalized and polished.
- Abstract generated per agency format.
- Budget justified with task traceability.
- Final compliance check passed (all items green).
- Post-submission checklist generated.
- `current_phase` set to "complete" in state.
- All files backed up.

---

## Command Reference

Users can jump to any phase or request specific actions:

| User Says | Action |
|-----------|--------|
| "Start a new proposal" | Begin Phase 0 |
| "Adapt my previous proposal" | Adapt from Previous Proposal workflow |
| "Based on this proposal, write a new one" | Adapt from Previous Proposal workflow |
| "Profile my project" | Phase 0 |
| "Plan the structure" | Phase 1 |
| "Draft [section name]" | Phase 2 for that section |
| "Review my draft" | Phase 3 |
| "Simulate review" | Phase 4 |
| "Polish for submission" | Phase 5 |
| "Check compliance" | Phase 5, Step 5.4 only |
| "Generate abstract" | Phase 5, Step 5.2 only |
| "Resume" | Read GRANT_STATE.json and continue from last checkpoint |
| "Status" | Report current phase, completed sections, pending items |

**Partial / Iterative Use:** If the user provides an existing draft and requests
review, skip to Phase 3. Populate `GRANT_STATE.json` with available information
and note any missing phases as gaps. Similarly, if the user already has a
structure and wants drafting help, start at Phase 2. Always inform the user
which phases were skipped and what information may be incomplete.

---

## Adapt from Previous Proposal (Most Common Workflow)

This is the most frequent use case: the user has a previous proposal (funded or
unfunded) and wants to write a new proposal for a different topic, program, or
agency. This workflow blends elements of all phases but shortcuts much of the
profiling work.

### When to Trigger
- User says "I have a previous proposal, help me write a new one"
- User provides a file path to an existing proposal
- User mentions adapting / rewriting / pivoting from earlier work

### Workflow

**Step A — Analyze Previous Proposal**
1. Read the provided file(s) thoroughly.
2. Extract and summarize:
   - Previous agency, program, and topic
   - Structure and section organization
   - Writing style and voice (this is the PI's natural voice — preserve it)
   - Key arguments, hypotheses, and methods
   - Strengths (what worked well in the writing)
   - Weaknesses or areas the user wants to change
3. If the previous proposal has reviewer comments, read those too and note
   patterns in the feedback.

**Step B — Define the Delta**
Ask the user to clarify what changes:
- Same agency, different topic? → Reuse structure, rewrite content
- Same topic, different agency? → Restructure for new agency's conventions
- Same topic, resubmission? → Jump to Phase 4 resubmission workflow
- Different topic AND different agency? → Treat as new proposal but borrow
  writing style and structural patterns

**Step C — Accelerated Planning (Modified Phase 0-1)**
- Skip detailed profiling — extract from the previous proposal
- Perform ROI scoring on the NEW project concept
- Generate new Claims-Aims-Evidence matrix
- Build new outline, but explicitly note what can be reused:
  - Methods sections that transfer (with modifications)
  - Broader impacts / education plans that can be adapted
  - Budget structures that apply
  - References that remain relevant
- For NSFC: if the previous was a Youth Fund and the new is a General Program,
  flag the key structural differences (4 years vs 3, higher expectations for
  研究基础, need for stronger preliminary data)

**Step D — Drafting with Voice Preservation**
- Use the PI's writing style from the previous proposal as the baseline voice.
  Match sentence structure, vocabulary level, and argumentation patterns.
- Do NOT start from templates for sections where the previous proposal provides
  a better starting point. Instead, adapt the previous text.
- Explicitly mark what is new vs. adapted in the draft (e.g., "[NEW]" and
  "[ADAPTED from previous §2.1]") so the PI can verify.
- Run AI-flavor detection comparing the new draft against the previous to ensure
  stylistic consistency.

**Step E — Continue with Standard Phases**
After drafting, proceed to Phase 3 (Quality Review) → Phase 4 (Simulated
Review) → Phase 5 (Final Optimization) as normal.

---

## Error Handling

- **Missing state file:** If user says "resume" but no `GRANT_STATE.json` exists,
  inform user and offer to start from Phase 0.
- **Incomplete phase:** If user tries to jump ahead (e.g., Phase 4 before Phase 2),
  warn that earlier phases have not been completed and list what is missing.
  Allow override if user insists.
- **Script failures:** If a script in `scripts/` fails or is missing, fall back
  to manual checks and note the gap.
- **Large proposals:** For proposals exceeding typical context limits, process
  section by section, using `GRANT_STATE.json` to maintain continuity.
- **Conflicting instructions:** If user instructions conflict with agency
  requirements, flag the conflict and defer to agency requirements unless
  user explicitly overrides.

---

## Credits

This skill was built by synthesizing best practices from multiple open-source
grant writing skills and resources. See `CREDITS.md` for full acknowledgments
and source attribution.
