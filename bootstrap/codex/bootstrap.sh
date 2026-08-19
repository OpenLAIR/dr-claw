#!/usr/bin/env bash
set -Eeuo pipefail

unset PYTHONHOME PYTHONPATH
export PYTHONNOUSERSITE=1
export PYTHONDONTWRITEBYTECODE=1

script_source=${BASH_SOURCE[0]}
case "$script_source" in
  */*) script_parent=${script_source%/*} ;;
  *) script_parent=. ;;
esac
SCRIPT_DIR=$(cd -- "$script_parent" && pwd -P)
exec python3 -I -S "$SCRIPT_DIR/bootstrap.py" "$@"
