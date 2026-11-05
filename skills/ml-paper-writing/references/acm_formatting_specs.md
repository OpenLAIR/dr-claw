# ACM Paper Formatting Specifications

Complete formatting guide based on ACM conference/journal paper template.

## Page Setup

### Page Size and Orientation
- **Size**: US Letter (8.5" × 11") or A4 (210mm × 297mm)
- **Orientation**: Portrait

### Margins
- **Top**: 1 inch (25.4mm)
- **Bottom**: 1 inch (25.4mm)
- **Left**: 0.75 inch (19.05mm)
- **Right**: 0.75 inch (19.05mm)

### Column Layout
- **Abstract**: Single column
- **Body**: Two columns
- **Column separation**: 0.33 inches (8.38mm)

## Typography

### Font Family
- **Primary**: Libertine (Linux Libertine)
- **Monospace**: Inconsolata or Courier
- **Fallback**: Times New Roman acceptable

### Font Sizes and Styles

**Title:**
- Size: 17pt
- Weight: Bold
- Alignment: Left
- Spacing: 12pt after

**Subtitle (if any):**
- Size: 14pt
- Weight: Regular
- Alignment: Left

**Author Names:**
- Size: 12pt
- Weight: Regular
- Alignment: Left
- Format: One author per line or comma-separated

**Author Affiliations:**
- Size: 10pt
- Weight: Regular
- Alignment: Left
- Format: Institution, City, Country
- Email: 10pt, monospace font

**Abstract:**
- Single column
- Size: 10pt
- Weight: Regular
- Alignment: Justified
- Heading: "ABSTRACT" in bold, small caps

**CCS Concepts:**
- Section after abstract
- Format: Bulleted list with concept hierarchy
- Size: 9pt

**Keywords:**
- After CCS Concepts
- Format: Comma-separated list
- Size: 9pt

**Section Headings (Level 1):**
- Size: 11pt
- Weight: Bold
- Case: Title Case
- Alignment: Left
- Numbering: 1, 2, 3...
- Spacing: 12pt before, 6pt after

**Subsection Headings (Level 2):**
- Size: 10pt
- Weight: Bold
- Case: Title Case
- Alignment: Left
- Numbering: 1.1, 1.2, 1.3...
- Spacing: 9pt before, 3pt after

**Sub-subsection Headings (Level 3):**
- Size: 10pt
- Weight: Italic
- Case: Title Case
- Alignment: Left
- Numbering: 1.1.1, 1.1.2...
- Spacing: 6pt before, 3pt after

**Body Text:**
- Size: 10pt
- Weight: Regular
- Alignment: Justified
- Line spacing: Single (1.0)
- Paragraph spacing: 6pt after
- First paragraph after heading: No indent
- Subsequent paragraphs: 0.5 inch indent OR no indent with spacing

**Figure Captions:**
- Size: 9pt
- Weight: Regular
- Format: "Figure X:" in bold, followed by caption
- Alignment: Left (below figure)
- Spacing: 6pt above caption

**Table Captions:**
- Size: 9pt
- Weight: Regular
- Format: "Table X:" in bold, followed by caption
- Alignment: Left (above table)
- Spacing: 6pt below caption

**Footnotes:**
- Size: 8pt
- Weight: Regular
- Numbering: Superscript numbers
- Placement: Bottom of column with separator line

**References:**
- Size: 9pt
- Weight: Regular
- Alignment: Left
- Numbering: [1], [2], [3]...
- Indentation: Hanging indent
- Spacing: 2pt between references

## Document Structure

### Title and Metadata (Single Column)
1. Title
2. Subtitle (optional)
3. Authors and affiliations
4. Abstract
5. CCS Concepts
6. Keywords
7. ACM Reference Format

### Body (Two Columns)
8. Main content sections
9. Acknowledgments
10. References

## Special Sections

### Abstract
Format:
```
ABSTRACT
Context-aware systems have become increasingly important...
```

- Heading in bold, small caps
- 150-250 words
- Single paragraph
- No citations

### CCS Concepts
Required section listing ACM Computing Classification concepts.

Format:
```
CCS CONCEPTS
• Human-centered computing → Ubiquitous and mobile computing;
• Software and its engineering → Context specific languages.
```

- Use official ACM CCS taxonomy
- Organized hierarchically with bullet points
- 3-6 concepts typical

### Keywords
Format:
```
KEYWORDS
context-awareness, ubiquitous computing, adaptation, personalization
```

- 4-8 keywords
- Comma-separated
- Lowercase (except proper nouns)

### ACM Reference Format
Appears at end of first page or after keywords:

Format:
```
ACM Reference Format:
John Smith and Jane Doe. 2025. Title of Paper. In Proceedings of
Conference Name (CONF '25), Month Day-Day, Year, City, Country.
ACM, New York, NY, USA, XX pages. https://doi.org/10.1145/XXXXXX.XXXXXX
```

## Numbering Conventions

### Sections
```
1 INTRODUCTION
2 RELATED WORK
  2.1 Context Modeling
  2.2 Adaptation Techniques
3 PROPOSED APPROACH
  3.1 Architecture Overview
    3.1.1 Context Acquisition Module
```

### Figures and Tables
- **Figures**: Numbered sequentially (Figure 1, Figure 2...)
- **Tables**: Numbered sequentially (Table 1, Table 2...)
- **Equations**: Numbered on right margin (1), (2), (3)...

## Special Elements

### Equations
- **Display equations**: Centered on separate line
- **Numbering**: Right-aligned equation number
- **Spacing**: 6pt before and after

Example:
```
                    E = mc²                    (1)
```

### Code Listings
- **Font**: Inconsolata or Courier (monospace)
- **Size**: 9pt
- **Background**: Light gray background optional
- **Line numbers**: Optional, on left margin
- **Caption**: Same format as figures

Example:
```python
def context_aware_function(context):
    if context.location == "office":
        return set_work_mode()
    return set_personal_mode()
```

### Algorithms
- Use algorithm environment
- Line numbering on left
- Keywords in bold
- Comments in italic

### Lists
**Bulleted lists:**
- Use standard bullet (•)
- Indent 0.25 inches
- Spacing: 3pt between items

**Numbered lists:**
- Use (1), (2), (3) or 1., 2., 3.
- Indent 0.25 inches
- Spacing: 3pt between items

**Description lists:**
- Term in bold, followed by description
- Hanging indent for description

## Figures and Tables

### Figure Guidelines
- **Position**: Top or bottom of column
- **Width**: Single-column or double-column (spanning both)
- **Quality**: Vector graphics preferred (PDF, EPS)
- **Resolution**: Minimum 300 DPI for raster images
- **Color**: Full color acceptable for online; consider grayscale printing
- **Format**: PDF, PNG, JPG, EPS

### Figure Captions
Format:
```
Figure 1: System architecture showing the main components
including context acquisition, reasoning, and adaptation modules.
```

- "Figure X:" in bold
- Caption text follows
- Place below figure
- Can span multiple lines
- Left-aligned

### Table Guidelines
- **Border**: Minimal lines (top, bottom, below header)
- **Header**: Bold text
- **Alignment**: Numbers right-aligned, text left-aligned
- **Font**: Same as body or one size smaller
- **Shading**: Light gray for header row optional

### Table Captions
Format:
```
Table 1: Performance comparison across three datasets
```

- "Table X:" in bold
- Caption text follows
- Place above table
- Left-aligned

Example table:
```
Table 1: Accuracy Results

Dataset     Baseline    Proposed
────────────────────────────────
Dataset A      87.3%      94.2%
Dataset B      89.1%      95.7%
Dataset C      85.7%      93.4%
────────────────────────────────
```

## Citations and References

### In-Text Citations
ACM uses numbered citations in square brackets:

Examples:
- "Recent work has shown [1]..."
- "Several studies [2, 3, 4] demonstrate..."
- "As Smith et al. [5] noted..."

### Reference List Format

**Section title**: "REFERENCES" (all caps, bold)

**Journal article:**
```
[1] Author1 Name, Author2 Name, and Author3 Name. Year.
    Title of article. Journal Name Volume, Issue (Month Year),
    pages. DOI:10.1145/XXXXXXX
```

**Conference paper:**
```
[2] Author1 Name and Author2 Name. Year. Title of paper.
    In Proceedings of Conference Name (CONF 'YY), Month,
    City, Country. ACM, New York, NY, USA, pages.
    DOI:10.1145/XXXXXXX
```

**Book:**
```
[3] Author Name. Year. Book Title. Publisher, City, Country.
```

**Book chapter:**
```
[4] Author Name. Year. Chapter Title. In Book Title,
    Editor Name (Ed.). Publisher, City, Country, pages.
```

**Website/Online:**
```
[5] Author Name. Year. Page Title. Website Name.
    Retrieved Month Day, Year from URL
```

**Technical report:**
```
[6] Author Name. Year. Report Title. Technical Report Number.
    Institution, City, Country.
```

**Rules:**
- Full first and last names (not initials)
- Year after authors
- DOI required when available
- URLs should be hyperlinked
- Alphabetical by first author's last name
- Hanging indent format

## Additional Front Matter Elements

### Copyright Notice
Appears at bottom of first column on page 1:

Format depends on publication rights:
```
Permission to make digital or hard copies of all or part of this work...
© 2025 Association for Computing Machinery.
ACM ISBN 978-1-4503-XXXX-X/YY/MM...$15.00
https://doi.org/10.1145/XXXXXX.XXXXXX
```

(Usually auto-generated by ACM template)

### Conference Information
Top of first page:
```
CONF '25, Month Day-Day, Year, City, Country
© 2025 Copyright held by owner/author(s). Publication rights licensed to ACM.
```

## Acknowledgments

- Separate section before references
- **Heading**: "ACKNOWLEDGMENTS" (not "ACKNOWLEDGEMENTS")
- No section number
- Thank funding sources, contributors, reviewers
- Brief (1-2 paragraphs)

Example:
```
ACKNOWLEDGMENTS
This work was supported by NSF Grant No. XXXXXXX. We thank
the anonymous reviewers for their valuable feedback.
```

## Author Information

### Multiple Authors
Format options:

**Option 1: List format**
```
Author One
Institution
email@domain.com

Author Two
Institution
email@domain.com
```

**Option 2: Inline format**
```
Author One (email@domain.com), Institution;
Author Two (email@domain.com), Institution
```

### Author Footnotes
- Use superscript symbols (*, †, ‡)
- Explain equal contribution, corresponding author, etc.

## Special Content Types

### Sidebars and Boxes
- Light background color
- Border around content
- Used for examples, definitions, or supplementary material
- Same font size as body

### Theorems and Proofs
- **Theorem**: Bold heading, italic content
- **Proof**: Italic heading, regular content
- End proof with □ symbol

### Definitions
- **Format**: Bold term followed by definition
- Numbered if multiple definitions

## Color and Graphics

### Color Usage
- Full color accepted for digital publications
- Consider colorblind-friendly palettes
- Ensure legibility in grayscale for printing
- Use patterns/textures in addition to color

### Image Requirements
- **Resolution**: 300 DPI minimum
- **Format**: PDF, PNG (for screenshots), JPG
- **Vector preferred**: For diagrams, charts, graphs
- **File size**: Keep reasonable (< 5 MB per image)

## Two-Column Formatting Rules

### Column Breaks
- Columns should be approximately equal height
- Balance columns on final page
- Keep related content together (avoid splitting paragraphs)

### Spanning Columns
- Figures and tables can span both columns
- Use when content is too wide for single column
- Place at top or bottom of page

### Widows and Orphans
- Avoid single lines at top/bottom of columns
- Keep at least 2 lines of paragraph together

## File Preparation

### LaTeX
Use ACM Master Article Template:
```latex
\documentclass[sigconf]{acmart}
```

Common document classes:
- `sigconf`: Conference proceedings
- `sigplan`: SIGPLAN proceedings
- `acmsmall`: Small journal format
- `acmlarge`: Large journal format

### Microsoft Word
- Use official ACM Word template
- Available from ACM website
- Includes styles for all elements

### PDF Requirements
- **PDF/A compliant** preferred
- **Fonts embedded**: All fonts must be embedded
- **Hyperlinks**: Active and colored blue
- **Bookmarks**: Section headings as bookmarks
- **Metadata**: Include title, authors, keywords

## Common Mistakes to Avoid

1. **Missing required sections**: CCS Concepts, Keywords, ACM Reference Format
2. **Wrong font**: Using Times instead of Libertine
3. **Incorrect citation format**: Not following ACM style exactly
4. **Missing DOIs**: References should include DOIs when available
5. **Copyright notice**: Modifying or removing copyright block
6. **Column imbalance**: Large white space in columns
7. **Figure quality**: Low resolution or pixelated images
8. **Heading capitalization**: Using all caps instead of title case
9. **Author format**: Not following ACM author format
10. **Reference format**: Using abbreviated names instead of full names

## Checklist for Final Submission

- [ ] Correct document class for publication type
- [ ] Title and subtitle properly formatted
- [ ] All authors and affiliations included
- [ ] Abstract 150-250 words
- [ ] CCS Concepts section included with appropriate concepts
- [ ] Keywords section included (4-8 keywords)
- [ ] ACM Reference Format section included
- [ ] Two-column layout for body (single column for abstract)
- [ ] All section headings numbered and formatted correctly
- [ ] All figures have captions below
- [ ] All tables have captions above
- [ ] All figures and tables referenced in text
- [ ] All references follow ACM format
- [ ] Full author names in references (not initials)
- [ ] DOIs included for all references when available
- [ ] Acknowledgments section (if applicable)
- [ ] All fonts embedded in PDF
- [ ] Copyright notice included (if required)
- [ ] PDF hyperlinks working
- [ ] File size acceptable (< 25 MB typically)
- [ ] Spell-check completed
- [ ] Consistent terminology throughout

## Template Variations

### Conference Proceedings
- `\documentclass[sigconf]{acmart}`
- Two-column format
- Copyright block required
- Page limit enforced

### Journal Articles
- `\documentclass[acmsmall]{acmart}` or `acmlarge`
- More flexible length
- Different heading styles
- May include received/revised dates

### Extended Abstracts
- Shorter format (2-4 pages)
- May omit some sections
- Abbreviated evaluation

## ACM-Specific Style Conventions

### Terminology
- "Section" not "chapter"
- "Figure" not "Fig." in running text (though "Fig." in captions okay)
- Use em-dash (—) not double hyphen (--)
- Use proper quotation marks (" ") not straight quotes (")

### Capitalization
- Section titles: Title Case
- Figure/Table captions: Sentence case after "Figure X:" or "Table X:"
- CCS concepts: Follow official taxonomy capitalization

### Spacing
- One space after periods
- No space before punctuation
- Space after commas, colons, semicolons

## Additional Resources

- ACM Author Center: https://authors.acm.org/
- ACM Templates: https://www.acm.org/publications/proceedings-template
- ACM CCS Generator: https://dl.acm.org/ccs
- ACM Reference Format Guide: https://www.acm.org/publications/authors/reference-formatting
- LaTeX Template Documentation: https://www.ctan.org/pkg/acmart
