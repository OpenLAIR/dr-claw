"""Auto-detect the type of single-cell biology data from file format and content."""

import os
import re


def detect_data_type(input_path):
    """Detect data type from file extension and content patterns.

    Args:
        input_path: Path to data file or directory

    Returns:
        str: One of 'cytof', 'scrnaseq', 'flow', 'unknown'
    """
    if os.path.isdir(input_path):
        return _detect_from_directory(input_path)

    ext = os.path.splitext(input_path)[1].lower()

    if ext == '.fcs':
        return 'flow'

    if ext == '.h5ad':
        return _detect_from_h5ad(input_path)

    if ext == '.h5':
        return 'scrnaseq'  # Likely 10X Genomics format

    if ext == '.csv':
        return _detect_from_csv(input_path)

    if ext == '.mtx':
        return 'scrnaseq'

    return 'unknown'


def _detect_from_directory(dir_path):
    """Detect data type from a directory of files."""
    files = os.listdir(dir_path)
    csv_files = [f for f in files if f.endswith('.csv')]
    fcs_files = [f for f in files if f.endswith('.fcs')]

    if fcs_files:
        return 'flow'

    if csv_files:
        # Check first CSV for CyTOF markers
        import pandas as pd
        sample = pd.read_csv(os.path.join(dir_path, csv_files[0]), nrows=5)
        if _has_cytof_markers(sample.columns):
            return 'cytof'
        return 'unknown'

    # Check for 10X-style directory (matrix.mtx + barcodes + features)
    mtx_files = [f for f in files if 'matrix' in f.lower() and f.endswith('.mtx')]
    if mtx_files:
        return 'scrnaseq'

    return 'unknown'


def _detect_from_h5ad(filepath):
    """Detect data type from h5ad file content."""
    try:
        import anndata as ad
        adata = ad.read_h5ad(filepath, backed='r')
        var_names = list(adata.var_names[:100])
        adata.file.close()

        if _has_cytof_markers(var_names):
            return 'cytof'

        # Check for gene names (alphabetic, 2+ characters)
        gene_pattern = re.compile(r'^[A-Za-z][A-Za-z0-9\-\.]+$')
        gene_count = sum(1 for v in var_names if gene_pattern.match(str(v)))
        if gene_count > len(var_names) * 0.5:
            return 'scrnaseq'

    except Exception:
        pass

    return 'unknown'


def _detect_from_csv(filepath):
    """Detect data type from CSV column names."""
    import pandas as pd
    try:
        df = pd.read_csv(filepath, nrows=2, encoding='latin1')
        if _has_cytof_markers(df.columns):
            return 'cytof'
    except Exception:
        pass
    return 'unknown'


def _has_cytof_markers(columns):
    """Check if column names contain typical CyTOF phospho-marker patterns."""
    cytof_patterns = [
        r'p\.ERK', r'p\.AKT', r'p\.MEK', r'p\.S6', r'p\.HER2',
        r'p\.STAT', r'p\.p38', r'p\.JNK', r'p\.SRC', r'p\.FAK',
        r'p\.PLCg', r'p\.NFkB', r'p\.CREB', r'p\.mTOR', r'p\.4EBP',
        r'Ki\.67', r'CyclinB', r'GAPDH', r'IdU',
    ]

    col_str = ' '.join(str(c) for c in columns)
    matches = sum(1 for p in cytof_patterns if re.search(p, col_str, re.IGNORECASE))
    return matches >= 3  # At least 3 CyTOF marker patterns


if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:
        dtype = detect_data_type(sys.argv[1])
        print(f"Detected data type: {dtype}")
    else:
        print("Usage: python detect_data_type.py <input_path>")
