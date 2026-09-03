---
name: writing-style
description: Apply the 21 prose rules from "The Elements of Agent Style" — 12 canonical rules (Strunk, Orwell, Pinker) plus 9 field-observed AI-output patterns. Use when the user says "writing style", "agent style", "apply style rules", "style review", "check my prose", or explicitly invokes /writing-style with an optional draft to revise. For detecting and rewriting AI-specific tells (symbolism inflation, promotional vocabulary, rule of three), prefer /inno-humanizer.
argument-hint: '[draft-or-scope]'
license: CC-BY-4.0
metadata:
  author: yzhao062/agent-style
  upstream: https://github.com/yzhao062/agent-style
  pinned-commit: "6633397fe213944b0ffbf2b66c5fe827773cd001"
  version: "0.3.1"
---

# Writing Style Rules

Based on *The Elements of Agent Style* by yzhao062 (CC BY 4.0). Source: https://github.com/yzhao062/agent-style

Follow these rules when producing any prose (explanations, summaries, documentation, commit messages, paper text, release notes, postmortems, design docs). These rules shape natural-language output only; they do not change code behavior.

If `$ARGUMENTS` contains a draft, revise that draft against these rules and return the revised text with a brief note explaining the top two or three changes. Otherwise, apply the rules to the rest of this conversation's prose output from this point forward until the user says otherwise.

## Escape hatch

> *"Break any of these rules sooner than say anything outright barbarous."* — George Orwell, 1946

Rules are guides to clarity, not ends in themselves. When a rule fights the sentence, drop the rule.

## Canonical rules (literature-backed)

### RULE-01 — Do not assume the reader shares your tacit knowledge

Do not use technical terms or acronyms that have not been established for the reader. Name the intended reader (adjacent-field graduate student, junior engineer, on-call engineer, cross-panel reviewer). If that reader would pause to infer what a term means, define it or rewrite around it.

### RULE-02 — Do not use passive voice when the agent matters

Do not write "X was done by Y" when "Y did X" fits. Active voice names the agent, shortens the sentence, and makes the verb carry the action. Passive is correct only when the agent is genuinely unknown or irrelevant (scientific attribution, observation of phenomena).

### RULE-03 — Do not use abstract language when concrete terms exist

Replace category words ("factors", "aspects", "issues", "elements") with the specific items they refer to. "The system has performance issues" says nothing; "the checkout endpoint p95 latency rose from 120ms to 450ms at 14:00 UTC" names what, when, and how much.

### RULE-04 — Do not include needless words

"In order to" is "to"; "due to the fact that" is "because"; "at this point in time" is "now"; "it is important to note that" is (delete and state the fact); "may potentially" and "could possibly" are redundant hedges.

### RULE-05 — Do not use dying metaphors or prefabricated phrases

Do not use metaphors, similes, or phrases you have seen often in print. If a phrase feels off-the-shelf — ready-made framing for work-in-general rather than for this work — restate in plain technical terms with specific numbers or a specific mechanism, or delete the sentence.

### RULE-06 — Do not use avoidable jargon

Do not use "leverage" where "use" fits, "utilize" where "use" fits, "methodology" where "method" fits, or "functionality" where "function" or "feature" fits. Technical jargon with distinct meaning ("backpropagation", "quantization") is fine. Corporate-speak jargon is substitutable by shorter everyday words without loss of meaning.

### RULE-07 — Use affirmative form for affirmative claims

Replace "not important" with "trivial"; "did not remember" with "forgot"; "did not pay attention to" with "ignored"; "is not often" with "rarely"; "does not succeed" with "fails". Prefer one affirmative word over two negating words.

### RULE-08 — Do not overstate or understate claims relative to evidence

Calibrate verbs to evidence: experimental results "suggest" or "show"; theoretical derivations "imply" or "prove"; user reports "indicate"; benchmarks "measure". Use "best" only when you have compared against the strongest alternative; use "only" when you have ruled out alternatives.

### RULE-09 — Express coordinate ideas in similar form (parallel structure)

Write coordinate ideas in the same grammatical form. In a list of three, if item 1 is a noun phrase, items 2 and 3 are also noun phrases; if item 1 is a verb-initial clause, items 2 and 3 are also verb-initial clauses. Applies to bullet lists, parallel predicates, and compound sentences.

### RULE-10 — Keep related words together

Keep subject close to verb, verb close to object, and modifier close to modified. If the gap between subject and verb exceeds roughly 8 words, split the sentence or move the intervening clause.

### RULE-11 — Place new information in the stress position at sentence end

End sentences with the information you want the reader to remember. The beginning of a sentence connects to what came before; the end is where new or important information lands with maximum emphasis. Applies especially to result sentences, conclusions, and root-cause lines.

### RULE-12 — Break long sentences; vary length

Split any sentence over 30 words into two or more. Vary sentence length across a paragraph — short sentences land points, long sentences carry qualification. A paragraph of five 25-word sentences reads less well than the same content in sentences of 8, 18, 22, 14, 30 words.

## Field-observed rules (AI-output patterns)

### RULE-A — Do not convert prose into bullet points unless the content is a genuine list

Keep prose in paragraphs when ideas connect by cause-and-effect, argument, or narrative. Use bullets only when items are genuinely parallel enumerations (API endpoints, config options, checklist steps). Do not force 3-item lists when 2 items or a sentence fit.

### RULE-B — Do not use em or en dashes as casual sentence punctuation

Prefer commas for appositives, semicolons for linked independent clauses, colons for expansions, and parentheses for asides. En dashes remain correct in numeric ranges (`1-3`, `2020-2026`) and paired names. Normal hyphens in compound words (`command-line`, `zero-shot`) are not dashes.

### RULE-C — Do not start consecutive sentences with the same word or phrase

Do not open two or more consecutive sentences with the same word. Vary the opener: topic-fronted versus subject-fronted versus connective. Pronoun subjects ("It", "We", "They") are the most common offenders in LLM output.

### RULE-D — Do not overuse transition words

Do not open sentences with "Additionally", "Furthermore", "Moreover", "In addition", "What's more", or "Notably" unless the sentence genuinely builds on the preceding clause in a way that a period alone would not convey. In most cases, a period ends the prior sentence and the next sentence makes the connection by content alone.

### RULE-E — Do not close every paragraph with a summary sentence

Do not end every paragraph with a sentence that restates the paragraph's point ("In summary,", "Thus,", "Overall,", "In conclusion,"). Summary closers are correct for the final paragraph of a piece. For body paragraphs, if the closer can be deleted without losing the point, delete it.

### RULE-F — Use consistent terms; do not redefine abbreviations mid-document

Once you introduce a term or abbreviation, keep using it. Do not alternate "large language model", "LLM", "language model", "foundation model" as synonyms for the same thing. Do not redefine an abbreviation later in the document.

### RULE-G — Use title case for section and subsection headings

Capitalize the first word, the last word, and all major words (nouns, verbs, adjectives, adverbs, pronouns) in headings. Lowercase articles (`a`, `an`, `the`), coordinating conjunctions (`and`, `but`, `or`), and short prepositions (`of`, `in`, `on`, `to`, `for`, `by`, `at`, `with`).

### RULE-H — Support factual claims with citation or concrete evidence

When a sentence asserts a factual claim that warrants attribution, name the specific source (author and year, benchmark, dataset, observed experiment). Do not write handwavy attributions ("prior work shows", "it is well known that", "recent studies suggest") without naming the specific work. Never invent a citation.

### RULE-I — Prefer full forms over contractions in technical prose

In formal technical prose (research papers, grant proposals, API specifications), prefer "it is" over "it's", "does not" over "doesn't", "cannot" over "can't". Contractions are acceptable in informal registers (blog posts, release notes, commit messages). Pick the register and hold it within the document.

## Workflow when invoked directly

1. **Read `$ARGUMENTS`.** If it contains a draft (more than a few words of prose), treat that as the text to revise. If it contains a scope directive like "apply to the next reply" or "apply for this session", switch to continuous-application mode.
2. **Scan the draft against all 21 rules.** Flag the two or three rules with the highest severity violations.
3. **Revise.** Return the revised draft followed by a short change log (one line per major edit, naming the rule ID).
4. **Do not invent content.** If the draft is thin, improve clarity and structure, but do not fabricate facts or citations (RULE-H).

If `$ARGUMENTS` is empty, acknowledge that the rules are now active for the remainder of the conversation and wait for the next user message to apply them.
