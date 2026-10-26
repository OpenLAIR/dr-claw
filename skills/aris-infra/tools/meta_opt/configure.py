#!/usr/bin/env python3
"""Preview or explicitly merge Workflow M hooks into ONE project's settings.

No model calls, CLI registration, home-directory setup, or automatic activation.
Unrelated settings and hook entries are preserved. --apply creates a backup of
existing bytes before an atomic replacement. Repeating a configuration is a no-op.
"""
import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import shlex
import tempfile

INFRA = Path(__file__).resolve().parents[2]


def merge_hooks(settings, additions):
    if not isinstance(settings, dict):
        raise ValueError("settings must be a JSON object")
    merged = deepcopy(settings)
    hooks = merged.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError("settings.hooks must be a JSON object")
    for event, entries in additions.items():
        existing = hooks.setdefault(event, [])
        if not isinstance(existing, list):
            raise ValueError(f"hooks.{event} must be an array")
        for entry in entries:
            if entry not in existing:
                existing.append(entry)
    return merged


def configured_hooks(logging, guard, global_log):
    hooks = {}
    if logging:
        template = json.loads((INFRA / 'templates/claude-hooks/meta_logging.json').read_text())
        for event, entries in template['hooks'].items():
            for entry in entries:
                for hook in entry['hooks']:
                    name = 'check_ready.sh' if 'check_ready.sh' in hook['command'] else 'log_event.sh'
                    command = 'bash ' + shlex.quote(str(INFRA / 'tools/meta_opt' / name))
                    if name == 'log_event.sh':
                        command = f'ARIS_META_GLOBAL_LOG={int(global_log)} ' + command
                    hook['command'] = command
            hooks[event] = entries
    if guard:
        template = json.loads((INFRA / 'templates/claude-hooks/corpus_write_guard.json').read_text())
        template['hooks']['PreToolUse'][0]['hooks'][0]['command'] = (
            'python3 ' + shlex.quote(str(INFRA / 'templates/claude-hooks/corpus_write_guard.py')))
        hooks.update(template['hooks'])
    return hooks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, required=True, help='existing research project directory')
    parser.add_argument('--logging', action='store_true', help='opt in to local event logging')
    parser.add_argument('--guard', action='store_true', help='opt in to common Bash corpus-write filtering')
    parser.add_argument('--global-log', action='store_true', help='also log to ~/.aris/meta (requires --logging)')
    parser.add_argument('--apply', action='store_true', help='back up and merge; otherwise only print a preview')
    args = parser.parse_args()
    if not (args.logging or args.guard) or (args.global_log and not args.logging):
        parser.error('choose --logging and/or --guard; --global-log requires --logging')
    project = args.project.resolve()
    if not project.is_dir() or project == Path.home().resolve():
        parser.error('--project must be an existing project directory, not HOME')
    destination = project / '.claude/settings.json'
    # A project setting symlink might point into the user's global config.
    if destination.is_symlink() or destination.parent.is_symlink():
        parser.error('refusing symlinked settings directory/file; merge manually')
    try:
        original = destination.read_bytes() if destination.exists() else None
        settings = json.loads(original) if original is not None else {}
        merged = merge_hooks(settings, configured_hooks(args.logging, args.guard, args.global_log))
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    if merged == settings:
        print('Already configured; no changes.')
        return
    text = json.dumps(merged, ensure_ascii=False, indent=2) + '\n'
    if not args.apply:
        print(f'PREVIEW only: {destination}; rerun with --apply to back up and merge.')
        print(text, end='')
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    if original is not None:
        fd, backup = tempfile.mkstemp(prefix='settings.json.aris-backup-', dir=destination.parent)
        with os.fdopen(fd, 'wb') as out:
            out.write(original)
        print(f'Backup: {backup}')
    fd, pending = tempfile.mkstemp(prefix='.settings.aris-', dir=destination.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            out.write(text)
        if destination.exists():
            os.chmod(pending, destination.stat().st_mode & 0o777)
        os.replace(pending, destination)
    finally:
        if os.path.exists(pending):
            os.unlink(pending)
    print(f'Merged: {destination}. Restart Claude Code to activate. No workflow was run.')


if __name__ == '__main__':
    main()
