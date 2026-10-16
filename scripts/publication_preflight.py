#!/usr/bin/env python3
"""Check proposed public Git content. Detection layers, not a confidentiality guarantee."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DENIED_PARTS = {'private', 'manuscript', 'manuscripts', 'cover-assets', 'private-assets',
                'output', 'outputs', 'dist', 'build', 'node_modules', '.aws', '.ssh'}
NETWORK = re.compile(r"(?:(?:require|import)\s*\(\s*['\"](?:node:)?(?:https?|net|tls|undici|openai|axios|@anthropic-ai/sdk)['\"]|\bfrom\s*['\"](?:node:)?(?:https?|net|tls|undici|openai|axios|@anthropic-ai/sdk)['\"]|\b(?:fetch|WebSocket|EventSource|axios\.(?:get|post))\s*\(|^\s*(?:from|import)\s+(?:requests|urllib|httpx|http|socket|smtplib|openai|anthropic)\b)", re.M)
SECRET = re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{30,})')


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def manifest():
    # The index is the proposed publication boundary; do not trust a different disk copy.
    try:
        data = git('show', ':.publication-allowlist.json')
    except subprocess.CalledProcessError:
        data = (ROOT / '.publication-allowlist.json').read_bytes()
    return json.loads(data)['files']


def check_tree(tree, allowed):
    staged = tree == ':'
    raw = git('ls-files', '--stage', '-z') if staged else git('ls-tree', '-r', '-z', tree)
    errors = []
    for record in raw.split(b'\0'):
        if not record:
            continue
        meta, raw_path = record.split(b'\t', 1)
        path = raw_path.decode('utf-8', 'strict')
        fields = meta.decode().split()
        mode, oid = fields[0], fields[1] if staged else fields[2]
        if staged and fields[2] != '0':
            errors.append(path + ': unresolved index entry')
            continue
        if mode not in ('100644', '100755'):
            errors.append(path + ': symlink/submodule/nonregular publication is not allowed')
            continue
        if any(part.lower() in DENIED_PARTS for part in Path(path).parts):
            errors.append(path + ': private/generated path')
            continue
        rule = allowed.get(path)
        if rule is None:
            errors.append(path + ': not in reviewed path allowlist')
            continue
        content = git('cat-file', 'blob', oid)
        if rule.get('sha256') and hashlib.sha256(content).hexdigest() != rule['sha256']:
            errors.append(path + ': approved fixture/asset bytes changed; review required')
        if b'\0' in content and not rule.get('sha256'):
            errors.append(path + ': unapproved binary content')
        if SECRET.search(content):
            errors.append(path + ': credential-shaped bytes (content not printed)')
        # Tests contain inert negative-case strings. Reviewed fixture hashes protect data.
        if path.endswith(('.js', '.py')) and not path.startswith('tests/'):
            if NETWORK.search(content.decode('utf-8', 'replace')):
                errors.append(path + ': network/API code path needs separate review')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--staged', action='store_true')
    group.add_argument('--tree')
    group.add_argument('--range', dest='revision_range')
    args = parser.parse_args()
    allowed = manifest()
    trees = [args.tree or ':']
    if args.revision_range:
        # Scan every proposed commit, so adding then deleting private content is detected.
        trees = git('rev-list', '--reverse', args.revision_range).decode().splitlines()
    errors = []
    for tree in trees:
        errors.extend(tree + ': ' + error for error in check_tree(tree, allowed))
    if errors:
        print('\n'.join(errors))
        return 1
    print('Public-content preflight passed. Review allowlist changes and prose manually.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
