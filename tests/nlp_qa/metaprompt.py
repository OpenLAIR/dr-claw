TASK = r"""
Train a biomedical question answering (factoid QA) model using the BioASQ dataset.
Given a biomedical question and a supporting document (context), the model must generate or extract the correct factoid answer.
"""

DATASET = r"""
The dataset used for this task is **BioASQ Factoid QA** (Task B), consisting of biomedical questions and
supporting contexts. All JSON files have been downloaded into:

    /workplace/dataset_candidate/bioasq/

The dataset contains multiple versions of BioASQ factoid sets (4b, 5b, 6b, etc.), each stored as separate JSON files.
Example file names:

\begin{verbatim}
BioASQ-train-factoid-4b.json
BioASQ-train-factoid-5b.json
BioASQ-test-factoid-4b-1.json
BioASQ-test-factoid-6b-4.json
...
\end{verbatim}

Each JSON file follows the structure:

\begin{verbatim}
{
  "version": "BioASQ6b",
  "data": [
    {
      "title": "BioASQ6b",
      "paragraphs": [
        {
          "context": "... biomedical article text ...",
          "qas": [
            {
              "question": "To which family does the Zika virus belong?",
              "id": "56b76d916e3f8eaf4c000001_000"
            }
          ]
        },
        ...
      ]
    }
  ]
}
\end{verbatim}

Data fields:

- **context**: biomedical abstract or snippet from PubMed  
- **question**: biomedical factoid question  
- **id**: unique QA pair identifier  
- **answers** (for training files only):  
  includes:
  - `exact_answer`: list of gold answer strings  
  - `ideal_answer`: long-form answer used in other BioASQ tasks (not needed here)

To load a BioASQ JSON file:

\begin{verbatim}
import json

with open("/workplace/dataset_candidate/bioasq/BioASQ-train-factoid-6b.json") as f:
    data = json.load(f)

for article in data["data"]:
    for p in article["paragraphs"]:
        context = p["context"]
        for qa in p["qas"]:
            question = qa["question"]
            qid = qa["id"]
            # For training files (only), gold answers:
            # qa["answers"]["exact_answer"]
\end{verbatim}

Training data is found in files beginning with:

    BioASQ-train-factoid-*.json

Test data is found in files beginning with:

    BioASQ-test-factoid-*.json

These files correspond to different BioASQ challenge years (4b, 5b, 6b, 7b).
"""

BASELINE = r"""
Representative baseline methods for biomedical factoid QA include:

• IR-based and statistical baselines:
  - BM25 lexical retrieval + string matching [1].

• Neural retrieval + reading comprehension:
  - BiLSTM QA models [2].
  - DrQA-style document reader [3].

• Pretrained language models:
  - BERT fine-tuned for biomedical QA [4] (baseline in the BioASQ paper).

Note: ClinicalBERT and BioBERT results are usually reported, but **ClinicalBERT performance is omitted** in this benchmark.

References:
[1] Robertson et al. "Okapi BM25." SIGIR 1994.
[2] Lample et al. "Neural Architectures for Named Entity Recognition." NAACL 2016.
[3] Chen et al. "Reading Wikipedia to Answer Open-Domain Questions." ACL 2017.
[4] Devlin et al. "BERT: Pre-training of Deep Bidirectional Transformers." NAACL 2019.
"""

COMPARISON = r"""
\begin{table*}[htbp]
\centering
\caption{Performance comparison on BioASQ factoid QA datasets. Metrics are Strict Accuracy (SAcc),
Lenient Accuracy (LAcc), and Mean Reciprocal Rank (MRR).}
\begin{tabular}{lcccc}
\toprule[1.2pt]
Dataset & Metric & BERT & SOTA \\
\midrule
BioASQ 4b & SAcc & 27.33 & \textbf{34.76} \\
          & LAcc & 44.72 & \textbf{50.88} \\
          & MRR  & 33.77 & \textbf{41.34} \\
\midrule
BioASQ 5b & SAcc & 39.33 & \textbf{46.66} \\
          & LAcc & 52.67 & \textbf{60.38} \\
          & MRR  & 44.27 & \textbf{52.12} \\
\midrule
BioASQ 6b & SAcc & 33.54 & \textbf{42.86} \\
          & LAcc & 51.55 & \textbf{61.18} \\
          & MRR  & 40.88 & \textbf{49.05} \\
\midrule
BioASQ 7b & SAcc &  -    & \textbf{40.12} \\
          & LAcc &  -    & \textbf{61.11} \\
          & MRR  &  -    & \textbf{48.47} \\
\bottomrule[1.2pt]
\end{tabular}
\end{table*}
"""

EVALUATION = r"""
For factoid QA, evaluate the model using:

-----------------------------------------
1. **Strict Accuracy (SAcc)**
-----------------------------------------
Predict is correct **only if** it exactly matches one of the gold exact answers (case-insensitive).

\begin{verbatim}
def sacc(pred, golds):
    return int(pred.lower() in [g.lower() for g in golds])
\end{verbatim}

-----------------------------------------
2. **Lenient Accuracy (LAcc)**
-----------------------------------------
Accept partial matches (substring-level):

\begin{verbatim}
def lacc(pred, golds):
    pred = pred.lower()
    golds = [g.lower() for g in golds]
    return int(any(pred in g or g in pred for g in golds))
\end{verbatim}

-----------------------------------------
3. **Mean Reciprocal Rank (MRR)**
-----------------------------------------
The model outputs a ranked list of candidate answers; use the reciprocal rank of the first correct answer.

\begin{verbatim}
def mrr(pred_list, golds):
    golds = [g.lower() for g in golds]
    for i, p in enumerate(pred_list):
        if p.lower() in golds:
            return 1.0 / (i + 1)
    return 0.0
\end{verbatim}

-----------------------------------------

These metrics follow the official BioASQ evaluation protocol.
Evaluate separately on each dataset version (4b, 5b, 6b, etc.).
"""

REF = r"""
All information is based on the BioASQ Challenge (Tasks 4b–7b) and the official factoid QA task.
Raw dataset files are located in:

    /workplace/dataset_candidate/bioasq/

Each JSON corresponds to one version of BioASQ factoid data (train/test).
Follow the official evaluation metrics (SAcc, LAcc, MRR) for consistent comparison.
[IMPORTANT]
1. Do not shuffle or modify the factoid JSON structure.
2. Use the gold `exact_answer` list for all evaluations.
3. Ensure predictions are normalized (lowercase, trim whitespace) before metric computation.
"""
