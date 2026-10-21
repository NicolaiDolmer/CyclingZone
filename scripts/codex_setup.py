"""Narrow, validated Codex [agents] update; Python 3.11+ stdlib only."""
import argparse
import copy
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import tomllib

DEFAULTS = {
    'default_subagent_model': 'gpt-6.1-sol',
    'default_subagent_reasoning_effort': 'medium',
    'max_concurrent_threads_per_session': 3,
}


def toml_literal(value):
    return json.dumps(value)


def parse_config(text):
    try:
        return tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        # Parser errors can include source lines containing credentials.
        raise ValueError('Invalid TOML; no changes made. Validate config locally.') from None


def update_config(text):
    before = parse_config(text)
    agents = before.get('agents', {})
    if not isinstance(agents, dict):
        raise ValueError('Expected an agents table; no changes made.')
    if 'max_threads' in agents:
        raise ValueError('Migrate legacy max_threads manually before setup; no changes made.')
    if all(type(agents.get(k)) is type(v) and agents.get(k) == v for k, v in DEFAULTS.items()):
        return text
    eol = '\r\n' if '\r\n' in text else '\n'
    lines = text.splitlines(keepends=True)
    if 'agents' not in before:
        suffix = '' if not text or text.endswith('\n') else eol
        result = text + suffix + eol + '[agents]' + eol
        result += ''.join(f'{k} = {toml_literal(v)}{eol}' for k, v in DEFAULTS.items())
    else:
        # Refuse noncanonical table syntax and multiline values instead of guessing
        # whether a header-like line is inside a TOML string. No unrelated bytes change.
        if '\"\"\"' in text or "'''" in text:
            raise ValueError('Existing agents config with multiline strings needs manual editing; no changes made.')
        headers = [i for i, line in enumerate(lines) if re.fullmatch(r'\s*\[agents\]\s*(?:#.*)?', line.strip())]
        if len(headers) != 1:
            raise ValueError('Use a canonical [agents] table; no changes made.')
        if not lines[headers[0]].endswith('\n'):
            lines[headers[0]] += eol
        start = headers[0] + 1
        end = next((i for i in range(start, len(lines)) if lines[i].lstrip().startswith('[')), len(lines))
        section = lines[start:end]
        for key, value in DEFAULTS.items():
            pattern = re.compile(r'^(\s*' + key + r'\s*=\s*)(.*?)([ \t]+#.*)?(\r?\n)?$')
            indices = [i for i, line in enumerate(section) if pattern.match(line)]
            if len(indices) > 1 or (key in agents and not indices):
                raise ValueError('Ambiguous agents key syntax; no changes made.')
            if indices:
                index = indices[0]
                match = pattern.match(section[index])
                section[index] = match[1] + toml_literal(value) + (match[3] or '') + (match[4] or '')
            else:
                if section and not section[-1].endswith('\n'):
                    section[-1] += eol
                section.append(f'{key} = {toml_literal(value)}{eol}')
        result = ''.join(lines[:start] + section + lines[end:])
    expected = copy.deepcopy(before)
    expected.setdefault('agents', {}).update(DEFAULTS)
    if parse_config(result) != expected:
        raise ValueError('Update would change unrelated configuration; no changes made.')
    return result


def configure(path, *, apply=False):
    path = Path(path)
    if path.is_symlink():
        raise ValueError('Symlinked config needs manual editing; no changes made.')
    original = path.read_bytes() if path.exists() else None
    try:
        text = (original or b'').decode('utf-8-sig')
    except UnicodeError:
        raise ValueError('Config must be UTF-8; no changes made.') from None
    result = update_config(text)
    if result == text:
        return False
    if not apply:
        return True
    encoded = result.encode('utf-8')
    if original and original.startswith(b'\xef\xbb\xbf'):
        encoded = b'\xef\xbb\xbf' + encoded
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = stat.S_IMODE(path.stat().st_mode) if original is not None else 0o600
    descriptor, temp_name = tempfile.mkstemp(prefix='.codex-agents-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(encoded)
        os.chmod(temp_name, mode)
        if (path.read_bytes() if path.exists() else None) != original:
            raise ValueError('Config changed concurrently; no changes made.')
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        changed = configure(args.config, apply=args.apply)
    except (ValueError, OSError):
        # No source text, current settings, paths, or raw exception in public output.
        print('Setup refused: invalid, unsupported, inaccessible, or concurrently changed config. No requested update applied.', file=sys.stderr)
        return 1
    action = 'updated' if args.apply else 'would update (dry-run)'
    print(f'Codex agents: {action if changed else "already configured"}.')
    for key, value in DEFAULTS.items():
        print(f'  {key} = {toml_literal(value)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
