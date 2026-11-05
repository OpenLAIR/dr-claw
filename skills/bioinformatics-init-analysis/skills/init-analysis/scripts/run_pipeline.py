#!/usr/bin/env python3
"""Main entry point: orchestrate the full 7-step analysis pipeline."""

import os
import sys
import argparse
import json
import traceback

# Add scripts directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from step1_load_data import load_data
from step2_qc import run_qc
from step3_normalize import normalize_data
from step4_dim_reduction import run_dim_reduction
from step5_clustering import run_clustering
from step6_marker_analysis import run_marker_analysis
from step7_report import generate_report


def main():
    parser = argparse.ArgumentParser(
        description='Bioinformatics Initial Data Analysis Pipeline',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # CyTOF data (auto-detected)
  python3 run_pipeline.py /path/to/cytof_csvs/

  # scRNA-seq data
  python3 run_pipeline.py /path/to/data.h5ad --data-type scrnaseq

  # With custom settings
  python3 run_pipeline.py /path/to/data.csv --subsample 1000 --output-dir ./results --report-style technical
        """
    )

    parser.add_argument('input_path', help='Path to data file or directory')
    parser.add_argument('--data-type', default='auto',
                        choices=['auto', 'cytof', 'scrnaseq', 'flow'],
                        help='Data type (default: auto-detect)')
    parser.add_argument('--subsample', type=int, default=500,
                        help='Max cells per group for subsampling (0=none, default=500)')
    parser.add_argument('--output-dir', default='./analysis_output',
                        help='Output directory (default: ./analysis_output)')
    parser.add_argument('--report-style', default='clinical',
                        choices=['clinical', 'technical'],
                        help='Report style (default: clinical)')
    parser.add_argument('--random-seed', type=int, default=42,
                        help='Random seed for reproducibility (default: 42)')

    args = parser.parse_args()

    # Validate input
    if not os.path.exists(args.input_path):
        print(f"Error: Input path does not exist: {args.input_path}")
        sys.exit(1)

    # Create output directories
    os.makedirs(args.output_dir, exist_ok=True)
    os.makedirs(os.path.join(args.output_dir, 'figures'), exist_ok=True)
    os.makedirs(os.path.join(args.output_dir, 'processed'), exist_ok=True)

    all_stats = {}

    print("=" * 60)
    print("  Bioinformatics Initial Data Analysis Pipeline")
    print("=" * 60)
    print(f"\nInput: {args.input_path}")
    print(f"Data type: {args.data_type}")
    print(f"Subsample: {args.subsample}")
    print(f"Output: {args.output_dir}")
    print(f"Report style: {args.report_style}")

    try:
        # Step 1: Load Data
        adata, data_type, load_stats = load_data(
            args.input_path, data_type=args.data_type,
            subsample=args.subsample, random_seed=args.random_seed
        )
        all_stats['loading'] = load_stats

        # Step 2: Quality Control
        qc_stats = run_qc(adata, data_type, args.output_dir)
        all_stats['qc'] = qc_stats

        # Step 3: Normalization
        norm_stats = normalize_data(adata, data_type, args.output_dir)
        all_stats['normalization'] = norm_stats

        # Step 4: Dimensionality Reduction
        dr_stats = run_dim_reduction(adata, data_type, args.output_dir)
        all_stats['dim_reduction'] = dr_stats

        # Step 5: Clustering
        clust_stats = run_clustering(adata, data_type, args.output_dir)
        all_stats['clustering'] = clust_stats

        # Step 6: Marker Analysis
        marker_stats = run_marker_analysis(adata, data_type, args.output_dir)
        all_stats['markers'] = marker_stats

        # Save processed AnnData
        processed_path = os.path.join(args.output_dir, 'processed', 'adata_processed.h5ad')
        print(f"\nSaving processed AnnData to {processed_path}...")
        adata.write_h5ad(processed_path)

        # Step 7: Report Generation
        report_path = generate_report(
            adata, data_type, args.output_dir, all_stats,
            report_style=args.report_style
        )

        print("\n" + "=" * 60)
        print("  Pipeline Complete!")
        print("=" * 60)
        print(f"\nOutputs:")
        print(f"  Report:    {report_path}")
        print(f"  Figures:   {args.output_dir}/figures/")
        print(f"  Data:      {processed_path}")
        print(f"  Summary:   {args.output_dir}/analysis_summary.json")

    except Exception as e:
        print(f"\n{'='*60}")
        print(f"  Pipeline Error")
        print(f"{'='*60}")
        print(f"\nError: {e}")
        traceback.print_exc()

        # Save partial results
        partial_path = os.path.join(args.output_dir, 'partial_summary.json')
        try:
            with open(partial_path, 'w') as f:
                json.dump(all_stats, f, indent=2, default=str)
            print(f"\nPartial results saved to: {partial_path}")
        except Exception:
            pass

        sys.exit(1)


if __name__ == '__main__':
    main()
