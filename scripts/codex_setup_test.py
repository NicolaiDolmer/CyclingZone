import importlib.util
from pathlib import Path
import tempfile
import unittest
import tomllib

HELPER = Path(__file__).with_name('codex_setup.py')

class SetupTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('codex_setup', HELPER)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_missing_config_and_dry_run_never_create_directories(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'missing' / 'config.toml'
            self.assertTrue(self.module.configure(path, apply=False))
            self.assertFalse(path.parent.exists())
            self.module.configure(path, apply=True)
            self.assertEqual(tomllib.loads(path.read_text())['agents'], self.module.DEFAULTS)

    def test_preserves_other_bytes_and_is_idempotent(self):
        original = b'# private fixture\r\nmodel = "unchanged"\r\n[agents]\r\nmax_depth = 1\r\ndefault_subagent_model = "old" # retain comment\r\ninterrupt_message = false\r\n[other]\r\ntoken = "FAKE_ONLY"\r\n'
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'config.toml'
            path.write_bytes(original)
            self.module.configure(path, apply=False)
            self.assertEqual(path.read_bytes(), original)
            self.module.configure(path, apply=True)
            result = path.read_bytes()
            self.assertIn(b'model = "unchanged"\r\n', result)
            self.assertIn(b'# retain comment\r\n', result)
            self.assertIn(b'[other]\r\ntoken = "FAKE_ONLY"\r\n', result)
            parsed = tomllib.loads(result.decode())
            self.assertEqual(parsed['agents']['max_depth'], 1)
            for key, value in self.module.DEFAULTS.items():
                self.assertEqual(parsed['agents'][key], value)
            self.assertFalse(self.module.configure(path, apply=True))
            self.assertEqual(path.read_bytes(), result)

    def test_nested_agent_tables_preserved(self):
        original = '[agents]\ninterrupt_message = true\n[agents.legacy]\ndescription = "keep"\n'
        updated = self.module.update_config(original)
        self.assertEqual(tomllib.loads(updated)['agents']['legacy'], {'description': 'keep'})

    def test_rejects_ambiguous_or_malformed_config_without_write(self):
        examples = ['[agents]\nmax_threads = 8\n', '[agents]\nmax_threads=2\nmax_threads=3\n', 'agents = { max_threads = 2 }\n', '["agents"]\nmax_threads=2\n', '[agents]\nnote = """\n[agents]\n"""\n', '[agents\n']
        for content in examples:
            with self.subTest(content=content), tempfile.TemporaryDirectory() as folder:
                path = Path(folder) / 'config.toml'
                path.write_text(content)
                with self.assertRaises(ValueError):
                    self.module.configure(path, apply=True)
                self.assertEqual(path.read_text(), content)

    def test_append_with_unrelated_multiline_string_is_safe(self):
        original = 'note = """\n[agents]\n"""\n[other]\nx = 1\n'
        updated = self.module.update_config(original)
        self.assertEqual(tomllib.loads(updated)['agents'], self.module.DEFAULTS)
        self.assertTrue(updated.startswith(original))

    def test_bare_header_without_newline(self):
        updated = self.module.update_config('[agents]')
        self.assertEqual(tomllib.loads(updated)['agents'], self.module.DEFAULTS)

    def test_bom_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'config.toml'
            path.write_bytes(b'\xef\xbb\xbfmodel = "keep"\n')
            self.module.configure(path, apply=True)
            first = path.read_bytes()
            self.assertTrue(first.startswith(b'\xef\xbb\xbf'))
            self.assertFalse(self.module.configure(path, apply=True))
            self.assertEqual(path.read_bytes(), first)

    def test_cli_never_prints_unrelated_config_or_parser_source(self):
        import subprocess
        import sys
        for content in ['token = "FAKE_PRIVATE_FIXTURE"\n', 'token = "FAKE_PRIVATE_FIXTURE\n']:
            with self.subTest(content=content), tempfile.TemporaryDirectory() as folder:
                path = Path(folder) / 'config.toml'
                path.write_text(content)
                result = subprocess.run([sys.executable, str(HELPER), '--config', str(path)], capture_output=True, text=True)
                self.assertNotIn('FAKE_PRIVATE_FIXTURE', result.stdout + result.stderr)
                self.assertEqual(path.read_text(), content)

    def test_noop_with_multiline_string(self):
        original = '[agents]\n' + ''.join(f'{k} = {self.module.toml_literal(v)}\n' for k,v in self.module.DEFAULTS.items()) + 'note = """abc"""\n'
        self.assertEqual(self.module.update_config(original), original)

if __name__ == '__main__':
    unittest.main()
