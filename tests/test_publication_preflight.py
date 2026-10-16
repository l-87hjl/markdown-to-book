"""Synthetic-only negative controls for public Git content checks."""
import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / 'scripts/publication_preflight.py'

class PublicationPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='synthetic-publication-preflight-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git('init', '-q')
        (self.root / 'scripts').mkdir()
        shutil.copy2(SOURCE, self.root / 'scripts/publication_preflight.py')
        (self.root / 'README.md').write_text('Synthetic public source.\n')
        (self.root / '.gitignore').write_text('manuscripts/\n*.pdf\n')
        self.asset = b'%PDF-synthetic-negative-control\0'
        (self.root / 'approved-example.pdf').write_bytes(self.asset)
        files = {name: {'kind': 'source'} for name in ['README.md', '.gitignore',
            'scripts/publication_preflight.py', '.publication-allowlist.json', 'safe.js']}
        files['approved-example.pdf'] = {'kind': 'upstream-example', 'sha256': hashlib.sha256(self.asset).hexdigest()}
        (self.root / '.publication-allowlist.json').write_text(json.dumps({'files': files}))
        self.git('add', '--', 'README.md', '.gitignore', 'scripts/publication_preflight.py', '.publication-allowlist.json')
        self.git('add', '-f', '--', 'approved-example.pdf')
        self.commit('synthetic baseline')
        self.base = self.git('rev-parse', 'HEAD').strip()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], text=True, stderr=subprocess.DEVNULL)

    def commit(self, message):
        self.git('-c', 'user.name=Synthetic test', '-c', 'user.email=synthetic@users.noreply.github.com', 'commit', '-qm', message)

    def check(self, *args):
        return subprocess.run(['python3', str(self.root / 'scripts/publication_preflight.py'), *args], text=True, capture_output=True)

    def test_approved_source_and_original_binary_pass(self):
        self.assertEqual(self.check('--staged').returncode, 0)

    def test_force_added_ignored_private_path_is_rejected(self):
        (self.root / 'manuscripts').mkdir()
        (self.root / 'manuscripts/fake.md').write_text('Fictional negative-control content only.')
        self.git('add', '-f', '--', 'manuscripts/fake.md')
        self.assertNotEqual(self.check('--staged').returncode, 0)

    def test_index_bytes_not_restored_working_copy_are_checked(self):
        (self.root / 'approved-example.pdf').write_bytes(b'SYNTHETIC changed binary\0')
        self.git('add', '-f', '--', 'approved-example.pdf')
        (self.root / 'approved-example.pdf').write_bytes(self.asset)
        self.assertNotEqual(self.check('--staged').returncode, 0)

    def test_added_then_deleted_unsafe_history_is_rejected(self):
        (self.root / 'unexpected.md').write_text('Synthetic only.')
        self.git('add', '--', 'unexpected.md'); self.commit('synthetic unsafe addition')
        self.git('rm', '-q', '--', 'unexpected.md'); self.commit('synthetic later deletion')
        self.assertEqual(self.check('--tree', 'HEAD').returncode, 0)
        self.assertNotEqual(self.check('--range', self.base + '..HEAD').returncode, 0)

    def test_staged_network_code_path_is_rejected_without_execution(self):
        (self.root / 'safe.js').write_text("fetch('https://example.invalid/synthetic');\n")
        self.git('add', '--', 'safe.js')
        self.assertNotEqual(self.check('--staged').returncode, 0)

    def test_node_prefixed_network_module_is_rejected(self):
        (self.root / 'safe.js').write_text("const client = require('node:https');\n")
        self.git('add', '--', 'safe.js')
        self.assertNotEqual(self.check('--staged').returncode, 0)

    def test_symlink_is_rejected(self):
        (self.root / 'safe.js').symlink_to('README.md')
        self.git('add', '--', 'safe.js')
        self.assertNotEqual(self.check('--staged').returncode, 0)

if __name__ == '__main__':
    unittest.main()
