---
name: inno-paper-writing
description: Creates formal academic research papers following IEEE/ACM formatting standards with proper structure, citations, and scholarly writing style. Use when the user asks to write a research paper, academic paper, or conference paper on any topic.
---

# Research Paper Writer

## Overview

This skill guides the creation of formal academic research papers that meet publication standards for IEEE and ACM conferences/journals. It ensures proper structure, formatting, academic writing style, and comprehensive coverage of research topics.

## Workflow

### 1. Understanding the Research Topic

When asked to write a research paper:

1. **Clarify the topic and scope** with the user:
   - What is the main research question or contribution?
   - What is the target audience (conference, journal, general academic)?
   - What is the desired length (page count or word count)?
   - Are there specific sections required?
   - What formatting standard to use (IEEE or ACM)?

2. **Gather context** if needed:
   - Review any provided research materials, data, or references
   - Understand the domain and technical background
   - Identify key related work or existing research to reference

### 2. Paper Structure

Follow this standard academic paper structure:

```
1. Title and Abstract
   - Concise title reflecting the main contribution
   - Abstract: 150-250 words summarizing purpose, methods, results, conclusions

2. Introduction
   - Motivation and problem statement
   - Research gap and significance
   - Main contributions (typically 3-5 bullet points)
   - Paper organization paragraph

3. Related Work / Background
   - Literature review of relevant research
   - Comparison with existing approaches
   - Positioning of current work

4. Methodology / Approach / System Design
   - Detailed description of proposed method/system
   - Architecture diagrams if applicable
   - Algorithms or procedures
   - Design decisions and rationale

5. Implementation (if applicable)
   - Technical details
   - Tools and technologies used
   - Challenges and solutions

6. Evaluation / Experiments / Results
   - Experimental setup
   - Datasets or test scenarios
   - Performance metrics
   - Results presentation (tables, graphs)
   - Analysis and interpretation

7. Discussion
   - Implications of results
   - Limitations and threats to validity
   - Lessons learned

8. Conclusion and Future Work
   - Summary of contributions
   - Impact and significance
   - Future research directions

9. References
   - Comprehensive bibliography in proper citation format
```

### 3. Academic Writing Style

Apply these writing conventions from scholarly research:

**Tone and Voice:**
- Formal, objective, and precise language
- Third-person perspective (avoid "I" or "we" unless describing specific contributions)
- Present tense for established facts, past tense for specific studies
- Clear, direct statements without unnecessary complexity

**Technical Precision:**
- Define all acronyms on first use: "Context-Aware Systems (C-AS)"
- Use domain-specific terminology correctly and consistently
- Quantify claims with specific metrics or evidence
- Avoid vague terms like "very", "many", "significant" without data

**Argumentation:**
- State claims clearly, then support with evidence
- Use logical progression: motivation → problem → solution → validation
- Compare and contrast with related work explicitly
- Address limitations and counterarguments

**Section-Specific Guidelines:**

*Abstract:*
- First sentence: broad context and motivation
- Second/third: specific problem and gap
- Middle: approach and methodology
- End: key results and contributions
- Self-contained (readable without the full paper)

*Introduction:*
- Start with real-world motivation or compelling problem
- Build from general to specific (inverted pyramid)
- End with clear contribution list and paper roadmap
- Use examples to illustrate the problem

*Related Work:*
- Group related work by theme or approach
- Compare explicitly: "Unlike [X] which focuses on Y, our approach..."
- Identify gaps: "However, these approaches do not address..."
- Position your work clearly

*Results:*
- Present data clearly in tables/figures
- Describe trends and patterns objectively
- Compare with baselines quantitatively
- Acknowledge unexpected or negative results

### 4. Formatting Guidelines

**IEEE Format (default):**
- Page size: A4 (210mm × 297mm)
- Margins: Top 19mm, Bottom 43mm, Left/Right 14.32mm
- Two-column layout with 4.22mm column separation
- Font: Times New Roman throughout
  - Title: 24pt bold
  - Author names: 11pt
  - Section headings: 10pt bold, numbered (1., 1.1, 1.1.1)
  - Body text: 10pt
  - Figure/Table captions: 8pt
- Line spacing: Single
- Paragraph: No indentation, 3pt spacing between paragraphs
- Figures: Centered, with captions below
- Tables: Centered, with captions above

**ACM Format (alternative):**
- Standard ACM conference proceedings format
- Single-column abstract, two-column body
- Include CCS Concepts and Keywords sections after abstract
- Use ACM reference format for citations

### 5. Citations and References

**In-text citations:**
- Use numbered citations: "Recent work [1, 2] has shown..."
- Multiple citations in chronological order: [3, 7, 12]
- Reference specific sections: "As demonstrated in [5, Section 3]..."

**Reference formatting (IEEE style):**
```
[1] A. Author, B. Author, and C. Author, "Title of paper," in Proc. Conference Name, Year, pp. 123-456.
[2] D. Author, "Title of journal article," Journal Name, vol. X, no. Y, pp. 123-456, Month Year.
[3] E. Author, Book Title, Edition. City: Publisher, Year.
```

**Reference list requirements:**
- Alphabetically ordered by first author's last name (or numbered by citation order)
- Include DOI or URL when available
- Minimum 15-20 references for a full paper
- Mix of recent (last 5 years) and foundational works

### 6. Content Generation Process

**Step-by-step approach:**

1. **Create outline**
   - Develop detailed section-by-section outline
   - Define key points for each section
   - Identify where figures/tables are needed

2. **Draft sections iteratively**
   - Start with methodology (core contribution)
   - Then introduction (now that contribution is clear)
   - Related work (to position the contribution)
   - Results and evaluation
   - Discussion and conclusion
   - Abstract last (summary of complete paper)

3. **Add citations**
   - Reference related work throughout
   - Support claims with evidence from literature
   - Create comprehensive reference list

4. **Review and refine**
   - Check logical flow between sections
   - Ensure consistency in terminology
   - Verify all figures/tables are referenced in text
   - Confirm abstract matches content
   - Validate citation completeness

### 7. Citation Verification (Post-Writing)

After the paper draft is complete (all sections written, references listed), run citation verification before finalizing:

1. **Read and execute** the `inno-reference-audit` skill: read `.claude/skills/inno-reference-audit/SKILL.md` and follow its procedure.
2. **Verify every reference** in the bibliography using WebSearch:
   - Search for the exact paper title, authors, and publication venue
   - Confirm the year, volume/issue, page numbers, and DOI match
   - Verify that cited claims actually appear in the referenced work
3. **Replace unverifiable citations** — do NOT simply mark them with `[CITATION NEEDED]` and move on. For every reference that cannot be verified:
   - Use WebSearch to find a **real, verifiable paper** that supports the same claim
   - Replace the fabricated reference with the real one (title, authors, year, venue, DOI)
   - Rewrite the citing sentence if needed to accurately reflect what the real paper says
   - If no supporting paper can be found after thorough searching, remove the claim from the text entirely or rephrase it as a general observation without a citation
4. **Iterate until clean**: repeat verification on any newly added references. The final paper must contain **zero unverified references**.
5. **Report results** to the user: list which references were verified on first pass, which were replaced, and which claims were removed.

This step is mandatory — do not skip it. A paper must not be delivered with any unverified or fabricated references.

## Examples

**Example 1: User asks for a survey paper**
```
User: "Write a research paper surveying recent advances in context-aware systems"

Response:
1. Clarify scope: "I'll create a survey paper on context-aware systems. A few questions:
   - Should I focus on specific aspects (e.g., requirements engineering, implementation techniques)?
   - What time period for 'recent' (last 5 years, 10 years)?
   - Target length: 10-15 pages, or 20-30 pages comprehensive survey?
   - IEEE or ACM format?"

2. After clarification, create outline showing:
   - Taxonomy of context-aware systems
   - Survey methodology
   - Classification scheme
   - Section-by-section coverage of different aspects
   - Trends and future directions

3. Draft paper following survey structure with extensive related work coverage
```

**Example 2: User asks for an experimental paper**
```
User: "Write a paper about my new algorithm for detecting hallucinations in vision-language models"

Response:
1. Gather details about:
   - Algorithm approach and novelty
   - Experimental setup and datasets used
   - Results and metrics
   - Comparison baselines

2. Structure as experimental paper:
   - Introduction: motivation for hallucination detection
   - Related work: existing detection methods
   - Proposed method: detailed algorithm description
   - Experiments: datasets, metrics, setup
   - Results: quantitative comparison with baselines
   - Analysis: ablation studies, error analysis
   - Conclusion: contributions and future work

3. Emphasize reproducibility and empirical validation
```

## Resources

### references/
- `writing_style_guide.md`: Detailed academic writing conventions extracted from example papers
- `ieee_formatting_specs.md`: Complete IEEE formatting specifications
- `acm_formatting_specs.md`: Complete ACM formatting specifications

### assets/
- `full_paper_template.pdf`: IEEE paper template with formatting examples
- `interim-layout.pdf`: ACM paper template
- Reference these templates when discussing formatting requirements with users

## Important Notes

- **Always ask for clarification** on topic scope before starting
- **Quality over speed**: Take time to structure properly and write clearly
- **Cite appropriately**: Academic integrity requires proper attribution
- **Be honest about limitations**: Acknowledge gaps or constraints in the research
- **Maintain consistency**: Terminology, notation, and style throughout
- **User provides the research content**: This skill structures and writes; the user provides the technical contributions and findings
