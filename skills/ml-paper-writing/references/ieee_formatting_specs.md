# IEEE Paper Formatting Specifications

Complete formatting guide based on IEEE conference/journal paper template.

## Page Setup

### Page Size and Orientation
- **Size**: A4 (210mm × 297mm)
- **Orientation**: Portrait

### Margins
- **Top**: 19mm (0.75 inches)
- **Bottom**: 43mm (1.69 inches) - larger for page numbers
- **Left**: 14.32mm (0.564 inches)
- **Right**: 14.32mm (0.564 inches)

### Column Layout
- **Number of columns**: 2
- **Column width**: Calculated automatically based on page width minus margins
- **Column separation**: 4.22mm (0.166 inches)
- **Column balance**: Balance final page columns if possible

## Typography

### Font Family
- **All text**: Times New Roman
- **Fallback**: Times, serif

### Font Sizes and Styles

**Title:**
- Size: 24pt
- Weight: Bold
- Case: Title Case
- Alignment: Centered
- Spacing: 18pt after

**Author Names:**
- Size: 11pt
- Weight: Regular
- Alignment: Centered
- Spacing: 12pt after

**Author Affiliations:**
- Size: 10pt
- Weight: Regular (Italic for email)
- Alignment: Centered
- Spacing: 18pt after

**Abstract Heading:**
- Size: 10pt
- Weight: Bold
- Case: Title Case
- Alignment: Left
- Style: Italic

**Abstract Text:**
- Size: 10pt
- Weight: Regular (Bold for "Keywords:")
- Alignment: Justified
- Indentation: None
- Spacing: 18pt after

**Section Headings (Level 1):**
- Size: 10pt
- Weight: Bold
- Case: UPPERCASE
- Alignment: Left (centered also acceptable for IEEE)
- Numbering: Roman numerals (I, II, III) or Arabic (1, 2, 3)
- Spacing: 6pt before, 3pt after

**Subsection Headings (Level 2):**
- Size: 10pt
- Weight: Bold Italic
- Case: Title Case
- Alignment: Left
- Numbering: A, B, C or 1.1, 1.2, 1.3
- Spacing: 6pt before, 3pt after

**Sub-subsection Headings (Level 3):**
- Size: 10pt
- Weight: Regular Italic
- Case: Sentence case
- Alignment: Left
- Numbering: 1), 2), 3) or 1.1.1, 1.1.2
- Spacing: 3pt before, 3pt after

**Body Text:**
- Size: 10pt
- Weight: Regular
- Alignment: Justified
- Line spacing: Single (1.0)
- Paragraph spacing: 3pt after
- Indentation: None (block paragraphs)

**Figure Captions:**
- Size: 8pt
- Weight: Regular
- Format: "Fig. X." in bold, followed by caption text
- Alignment: Centered
- Spacing: 6pt before figure, 12pt after caption

**Table Captions:**
- Size: 8pt
- Weight: Regular
- Format: "TABLE X" in uppercase, centered above table; caption text below
- Alignment: Centered
- Spacing: 6pt before caption, 6pt after table

**Footnotes:**
- Size: 8pt
- Weight: Regular
- Numbering: Superscript numbers
- Placement: Bottom of column

**References:**
- Size: 10pt (reference number 8pt)
- Weight: Regular
- Alignment: Left
- Numbering: [1], [2], [3]...
- Indentation: Hanging indent after number
- Spacing: 0pt between references

## Numbering Conventions

### Sections
Two acceptable styles:

**Style 1: Roman numerals**
```
I. INTRODUCTION
II. RELATED WORK
   A. Context Modeling
   B. Adaptation Techniques
III. PROPOSED APPROACH
```

**Style 2: Arabic numerals**
```
1. INTRODUCTION
2. RELATED WORK
   2.1 Context Modeling
   2.2 Adaptation Techniques
3. PROPOSED APPROACH
```

### Figures and Tables
- **Figures**: Numbered sequentially (Fig. 1, Fig. 2, Fig. 3...)
- **Tables**: Numbered sequentially (TABLE I, TABLE II or Table 1, Table 2...)
- **Equations**: Numbered on right margin (1), (2), (3)...

## Special Elements

### Equations
- **Inline**: Use inline math for simple expressions: $x + y = z$
- **Display**: Center important equations on separate line
- **Numbering**: Right-aligned equation number in parentheses
- **Spacing**: 6pt before and after
- **Font**: Times New Roman or Symbol font for math

Example:
```
                    E = mc²                    (1)
```

### Algorithms and Code
- **Font**: Courier New or other monospace font
- **Size**: 9pt
- **Placement**: Within figure environment
- **Caption**: "Fig. X. Algorithm description"
- **Indentation**: Preserve code structure

### Lists
**Bulleted lists:**
- Use bullet points (•)
- Indent by 5mm from margin
- Spacing: 0pt between items

**Numbered lists:**
- Use 1), 2), 3) or 1., 2., 3.
- Indent by 5mm from margin
- Align text with item number

### Quotations
- Short quotes (< 3 lines): Inline with quotation marks
- Long quotes: Indented block, 9pt font, no quotes
- Always cite source

## Figures and Tables Guidelines

### Figure Placement
- **Position**: Top or bottom of column preferred
- **Width**: Single-column (width of one column) or double-column (spans both columns)
- **Centering**: Center within column or page
- **Quality**: Minimum 300 DPI for images
- **Format**: Vector (PDF, EPS) preferred; raster (PNG, JPG) acceptable
- **Color**: Use grayscale or ensure prints clearly in grayscale

### Figure Captions
Format:
```
Fig. 1. System architecture showing the three main components:
context acquisition, reasoning engine, and adaptation module.
```

**Rules:**
- "Fig." abbreviation, not "Figure"
- Number followed by period
- Caption text starts with capital letter
- Can be multiple sentences
- Place below figure

### Table Formatting
- **Border**: Use horizontal lines only (top, bottom, below header)
- **Header**: Bold text in first row
- **Alignment**: Numbers right-aligned, text left-aligned
- **Spacing**: Compact spacing within table
- **Font**: Same as body text (10pt) or slightly smaller (9pt)

Example:
```
TABLE I
PERFORMANCE COMPARISON

Method          Accuracy    Time (ms)
───────────────────────────────────
Baseline        87.3%       145
Proposed        94.2%       132
───────────────────────────────────
```

**Caption placement:**
- Table number and title above table (centered)
- Additional caption text below table (centered)

### Table Captions
Format:
```
TABLE I
PERFORMANCE COMPARISON ACROSS THREE DATASETS
```

## Header and Footer

### Running Headers
- **Odd pages**: Paper title (right-aligned)
- **Even pages**: Author names (left-aligned)
- **Font**: 8pt
- **Position**: Top margin area

(Note: Many IEEE conferences omit running headers)

### Page Numbers
- **Position**: Bottom center
- **Font**: 10pt
- **Format**: Simple number (1, 2, 3...)
- **Start**: Page 1 on title page (may be suppressed for submission)

## Citations and References

### In-Text Citations
Format: [1], [2, 3], [5-7]

Examples:
- "Recent work [1] has shown..."
- "Several studies [2, 3, 4] demonstrate..."
- "As noted in [5], context awareness..."

### Reference List

**Section title**: "REFERENCES" or "REFERENCES" (all caps, centered or left)

**Format by type:**

**Journal article:**
```
[1] A. Author, B. Author, and C. Author, "Title of paper,"
    Journal Name, vol. X, no. Y, pp. ZZZ-ZZZ, Month Year.
```

**Conference paper:**
```
[2] A. Author and B. Author, "Title of paper," in Proc.
    Conference Name (CONF 'YY), City, Country, Year,
    pp. XXX-XXX.
```

**Book:**
```
[3] A. Author, Book Title, Edition. City: Publisher, Year.
```

**Book chapter:**
```
[4] A. Author, "Chapter title," in Book Title, B. Editor, Ed.
    City: Publisher, Year, pp. XXX-XXX.
```

**Technical report:**
```
[5] A. Author, "Title," Company/Institution, City, State,
    Country, Tech. Rep. Number, Year.
```

**Website:**
```
[6] A. Author. "Page title." Website Name. Accessed: Month
    Day, Year. [Online]. Available: http://url
```

**Rules:**
- List references in order of first citation
- Use initials for first/middle names
- Italicize journal/book titles
- Use quotation marks for article/paper titles
- Include DOI if available: doi: 10.1234/example
- Hanging indent after reference number
- Abbreviate author names consistently

## Acronyms and Abbreviations

- Define on first use: "Context-Aware Systems (C-AS)"
- Use consistently after definition
- Common technical abbreviations okay: API, CPU, RAM, etc.
- Measurement units: use standard abbreviations (mm, kg, MHz)

## Hyphenation and Line Breaks

- **Hyphenation**: Automatic hyphenation allowed
- **Line breaks**: Avoid widows and orphans
- **Section breaks**: Major sections start at top of column when possible

## Color Usage

- Use color sparingly
- Ensure readability in grayscale
- Test figures print clearly in black and white
- Use patterns/textures in addition to color for distinction

## File Preparation

### Submission Format
- **PDF**: Primary format for submission
- **Source files**: LaTeX or Word source may be required
- **Figures**: Separate high-resolution files may be needed
- **Fonts**: Embed all fonts in PDF

### PDF Requirements
- **Version**: PDF 1.4 or higher
- **Fonts**: All fonts embedded
- **Images**: Minimum 300 DPI
- **Page size**: Exact A4 (no cropmarks)
- **Color space**: RGB or grayscale
- **File size**: Typically < 10 MB

## Common Mistakes to Avoid

1. **Wrong margins**: Using default Word/LaTeX margins
2. **Wrong font**: Using Arial or other sans-serif fonts
3. **Single column abstract**: Should be two-column
4. **Centered section headings**: Usually left-aligned
5. **Figure quality**: Low-resolution or pixelated images
6. **Caption format**: Wrong placement or format
7. **Reference format**: Inconsistent citation style
8. **Page numbers**: Wrong position or format
9. **Line spacing**: Using double-spacing instead of single
10. **Paragraph indentation**: Using indent instead of block style

## Tools and Templates

### LaTeX
Use IEEE conference/journal template:
```latex
\documentclass[conference]{IEEEtran}
```

### Microsoft Word
Download official IEEE Word template from IEEE website

### Formatting Checkers
- IEEE PDF eXpress for validation
- Online margin checkers
- Font embedding validators

## Checklist for Final Submission

- [ ] Page size: A4 (210mm × 297mm)
- [ ] Margins: 19mm top, 43mm bottom, 14.32mm left/right
- [ ] Font: Times New Roman throughout
- [ ] Two-column layout with 4.22mm spacing
- [ ] Section headings formatted correctly
- [ ] All figures have captions below
- [ ] All tables have captions above
- [ ] All figures/tables referenced in text
- [ ] Reference list formatted correctly
- [ ] All fonts embedded in PDF
- [ ] Page numbers included (if required)
- [ ] File size acceptable
- [ ] PDF prints correctly
- [ ] All acronyms defined on first use
- [ ] No orphan headings (heading alone at column bottom)

## Additional Resources

- IEEE Author Center: https://journals.ieeeauthorcenter.ieee.org/
- IEEE Templates: https://www.ieee.org/conferences/publishing/templates.html
- IEEE Reference Guide: https://journals.ieeeauthorcenter.ieee.org/create-your-ieee-article/authoring-tools-and-templates/ieee-reference-guide/
- IEEE PDF eXpress: Check with conference/journal for PDF validation service
