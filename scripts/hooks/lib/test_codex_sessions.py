import importlib.util
import json
import os
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('sessions', os.path.join(os.path.dirname(__file__), 'active_sessions_engine.py'))
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


class CodexSessions(unittest.TestCase):
    def test_codex_wave_visible_to_claude_even_when_owner_disappears(self):
        with tempfile.TemporaryDirectory() as root:
            run = os.path.join(root, '.claude', 'run')
            os.makedirs(run)
            with open(os.path.join(run, 'wave-active.json'), 'w') as f:
                json.dump({'runtime': 'codex', 'owner': 'codex-fixture', 'pid': 123, 'now': 1790000000000, 'waveId': 'fixture'}, f)
            with patch.object(engine, 'home_dir', return_value=root), patch.object(engine, 'is_pid_alive', return_value=False):
                alive, others = engine.collect_sessions(root, 'claude-fixture', now_ms=1790000000000)
            self.assertEqual(len(others), 1)
            self.assertIn('Codex', others[0]['name'])
            self.assertEqual(others[0]['sessionId'], 'codex-fixture')

    def test_regular_codex_claim_visible_without_pid_and_not_guessed_away(self):
        with tempfile.TemporaryDirectory() as root:
            claims = os.path.join(root, '.claude', 'run', 'agent-sessions')
            os.makedirs(claims)
            with open(os.path.join(claims, 'fixture.json'), 'w') as f:
                json.dump({'runtime': 'codex', 'sessionId': 'codex-fixture', 'cwd': root, 'startedAt': 1790000000000}, f)
            with patch.object(engine, 'home_dir', return_value=root):
                alive, others = engine.collect_sessions(root, '', now_ms=1790000000000)
            self.assertEqual(len(others), 1)
            self.assertEqual(others[0]['sessionId'], 'codex-fixture')


if __name__ == '__main__':
    unittest.main()
