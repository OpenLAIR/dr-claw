# Academic Writing Style Guide

This guide extracts writing conventions from high-quality academic papers on context-aware systems and large vision-language models.

## Voice and Tone

### Formal Academic Voice
- Use third-person perspective when possible
- Maintain objectivity and avoid emotional language
- Be precise and concise
- Example: "This paper presents..." rather than "We excitedly present..."

### Tense Usage
- **Present tense**: For established facts, general truths, and paper structure
  - "Context-aware systems adapt to user environments"
  - "This paper surveys recent advances in..."
- **Past tense**: For specific studies, experiments conducted, and historical events
  - "Smith et al. conducted experiments on..."
  - "The system was evaluated using..."
- **Future tense**: For planned work or implications
  - "Future research will explore..."

## Structural Patterns

### Abstract Writing
Pattern observed in successful papers:
1. **Opening sentence**: Broad context establishing importance
   - "Context-aware systems have become increasingly important in ubiquitous computing environments."
2. **Problem identification**: Specific gap or challenge
   - "However, engineering such systems poses significant challenges in requirements elicitation and validation."
3. **Solution/Approach**: What the paper does
   - "This paper presents a comprehensive survey of engineering practices for context-aware systems."
4. **Key findings/contributions**: Main results
   - "We identify 47 approaches across four lifecycle phases and provide a taxonomy of techniques."
5. **Implications**: Why it matters
   - "Our findings provide guidance for practitioners in selecting appropriate engineering methods."

### Introduction Structure
Observed effective pattern (inverted pyramid):
1. **Motivation paragraph**: Real-world context and importance
   - Start with broad domain relevance
   - Use concrete examples or scenarios
   - Establish "why should readers care?"

2. **Problem statement**: Specific challenges
   - Identify gaps in current approaches
   - Quantify the problem if possible
   - Show inadequacy of existing solutions

3. **Proposed solution**: High-level overview
   - Briefly describe approach without details
   - Highlight key innovations

4. **Contributions**: Numbered list (3-5 items)
   - Be specific: "A taxonomy of..." not "We discuss..."
   - Focus on tangible outputs: frameworks, algorithms, empirical findings

5. **Paper organization**: Roadmap
   - "The rest of this paper is organized as follows. Section 2..."

### Related Work Section
Effective patterns:
- **Thematic grouping**: Organize by approach type, not chronologically
  - "Requirements Engineering Approaches"
  - "Runtime Adaptation Techniques"
  - "Evaluation Methodologies"

- **Comparative analysis**: Explicitly compare
  - "Unlike [X] which focuses on Y, our approach..."
  - "[A] addresses Z but does not consider..."
  - "While [B] provides..., it requires..."

- **Gap identification**: Lead to your contribution
  - "However, these approaches share a common limitation..."
  - "To the best of our knowledge, no prior work has..."

### Methodology/Approach Section
Observed structure:
1. **Overview**: High-level description with diagrams
2. **Components**: Break down into subsystems/phases
3. **Details**: Algorithms, procedures, design decisions
4. **Rationale**: Justify choices made

Use subsections liberally:
- 4.1 System Architecture
- 4.2 Context Acquisition Module
- 4.3 Reasoning Engine
- 4.4 Adaptation Mechanism

### Results Section
Patterns from strong papers:
- **Lead with data**: Start with tables/figures
- **Describe objectively**: "Figure 3 shows that accuracy increases..."
- **Quantify everything**: Specific numbers, percentages, statistical significance
- **Compare baselines**: "Our approach achieves 94.2% accuracy compared to 87.3% for [baseline]"
- **Explain unexpected results**: Don't hide negative findings

### Discussion Section
Purpose: Interpret results, not just report them
- **Implications**: What do results mean?
- **Limitations**: Acknowledge threats to validity
- **Design choices**: Reflect on decisions made
- **Generalizability**: Where else does this apply?

### Conclusion Section
Effective pattern:
1. Restate the problem (1 sentence)
2. Summarize approach (1-2 sentences)
3. Key findings/contributions (2-3 sentences)
4. Broader impact (1 sentence)
5. Future directions (2-3 specific items)

Keep it concise (typically 1/2 to 3/4 page).

## Language Conventions

### Technical Precision

**Acronyms and Abbreviations:**
- Define on first use: "Context-Aware Systems (C-AS)"
- Use consistently throughout
- Common in field: LLM, API, ML, NLP, etc.

**Terminology Consistency:**
- Choose one term and stick with it
  - "user" vs "end-user" vs "actor"
  - "approach" vs "method" vs "technique"
- Create a terminology table if needed

**Quantification:**
- Avoid vague quantifiers without data
  - Bad: "significantly improved"
  - Good: "improved accuracy by 12.3% (p < 0.05)"
- Use precise numbers: "73 papers" not "many papers"

### Sentence Structure

**Complexity Balance:**
- Mix simple and complex sentences
- Use subordinate clauses for nuance
- Break up long sentences (>30 words typically too long)

**Active vs Passive Voice:**
- Prefer active for clarity: "We implemented..."
- Use passive when actor is unimportant: "Data was collected from..."
- Passive for objectivity: "The system was evaluated..."

**Transition Words:**
Observed frequent usage:
- Contrast: however, nevertheless, in contrast, conversely
- Addition: furthermore, moreover, additionally, similarly
- Causation: therefore, consequently, as a result, thus
- Example: for instance, for example, specifically, namely
- Summary: in summary, overall, in conclusion

### Common Phrases in Academic Writing

**Introducing work:**
- "This paper presents/proposes/introduces..."
- "We describe/investigate/analyze..."
- "Our work focuses on/addresses/tackles..."

**Stating problems:**
- "A key challenge is..."
- "However, this approach suffers from..."
- "Existing methods fail to..."

**Describing contributions:**
- "The main contribution of this work is..."
- "We make the following contributions:"
- "Our approach offers several advantages..."

**Referencing literature:**
- "Recent work has shown..." [1, 2]
- "Smith et al. demonstrated..." [3]
- "As noted by Jones [4]..."
- "Prior studies [5, 6, 7] have explored..."

**Presenting results:**
- "Our experiments demonstrate that..."
- "As shown in Table 2..."
- "Figure 4 illustrates..."
- "The results indicate that..."

**Expressing limitations:**
- "One limitation of our approach is..."
- "While our method shows promise, it..."
- "A potential threat to validity is..."

## Paragraph Construction

### Topic Sentences
- Start each paragraph with a clear topic sentence
- Make the main point immediately clear
- Use topic sentences to show logical flow

### Paragraph Length
- Typically 4-8 sentences
- One main idea per paragraph
- Use white space for readability

### Paragraph Transitions
- Link paragraphs logically
- Use transition sentences or phrases
- Create narrative flow

## Citation Practices

### When to Cite
- Any prior work that relates to yours
- Background information not common knowledge
- Methods or datasets from others
- Claims that need support
- Direct quotes (rare in technical papers)

### Citation Density
Observed patterns:
- Introduction: 5-10 citations
- Related Work: Heavy (30-50% of content)
- Methodology: Moderate (cite tools, algorithms used)
- Results: Light (cite baselines)
- Discussion: Moderate (compare with literature)

### Citation Integration
- **Parenthetical**: "Context awareness improves usability [1, 2]."
- **Narrative**: "Smith et al. [3] demonstrated that..."
- **Multiple**: Group related citations [4, 5, 6]

## Figures and Tables

### Purpose
- Figures: Show architecture, workflows, trends, comparisons
- Tables: Present structured data, results, comparisons

### Captions
- Self-contained: Readable without reading text
- Specific: "Accuracy comparison across three datasets" not "Results"
- Context: Explain abbreviations in caption

### In-text References
- Always reference: "as shown in Figure 3"
- Describe what to notice: "Figure 3 shows that accuracy increases with training data"
- Don't just state "see Figure 3" without context

## Domain-Specific Conventions

### Context-Aware Systems Literature
- Emphasize adaptability and personalization
- Discuss context acquisition, modeling, reasoning
- Address privacy and user trust
- Consider deployment challenges

### Machine Learning/AI Papers
- Report multiple metrics (accuracy, precision, recall, F1)
- Include ablation studies
- Discuss computational complexity
- Address ethical considerations
- Ensure reproducibility details

## Quality Indicators

Strong academic papers demonstrate:
1. **Clarity**: Ideas presented logically and understandably
2. **Rigor**: Thorough methodology and evaluation
3. **Originality**: Novel contribution clearly stated
4. **Relevance**: Connection to important problems
5. **Completeness**: All claims supported, limitations acknowledged
6. **Consistency**: Terminology, notation, style throughout
7. **Reproducibility**: Sufficient detail for replication

## Common Pitfalls to Avoid

1. **Overclaiming**: Avoid "revolutionary", "unprecedented" without strong evidence
2. **Vagueness**: Be specific about contributions and results
3. **Poor organization**: Ensure logical flow between sections
4. **Insufficient related work**: Show awareness of field
5. **Weak evaluation**: Need rigorous validation of claims
6. **Missing limitations**: Acknowledge weaknesses
7. **Inconsistent terminology**: Use terms consistently
8. **Unclear contributions**: State explicitly what is novel
9. **Excessive jargon**: Define technical terms appropriately
10. **No context**: Explain why the work matters

## Writing Process Tips

1. **Outline first**: Structure before writing
2. **Write iteratively**: Don't aim for perfection in first draft
3. **Start with easiest section**: Often methodology
4. **Write abstract last**: After content is finalized
5. **Get feedback early**: From colleagues or advisors
6. **Read aloud**: Catch awkward phrasing
7. **Edit ruthlessly**: Remove unnecessary words
8. **Check consistency**: Terminology, notation, citations
9. **Verify all claims**: Every statement should be defensible
10. **Polish formatting**: Final pass for consistency
