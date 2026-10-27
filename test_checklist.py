import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
import checklist_tool as c
from storage_utils import atomic_write, revision, load_review, save_review

class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'check.md'
        self.path.write_text('# Test\n\n## Tasks\n- [ ] One\n- [x] Two\n', encoding='utf-8')

    def test_precise_state_write(self):
        text = self.path.read_text(); parsed = c.parse_md(text)
        result = c.apply_states(text, parsed, {parsed['items'][0]['id']: 'skip'})
        self.assertEqual(result, text.replace('[ ] One', '[-] One'))

    def test_appendix_retains_user_sections(self):
        self.path.write_text(self.path.read_text() + c.APPENDIX_MARK + '\n## '+c.APPENDIX_HEADING+'\nold\n## Notes\nKEEP\n')
        c.write_appendix(self.path, [], {})
        self.assertIn('## Notes\nKEEP', self.path.read_text())
        c.write_appendix(self.path, [], {})
        self.assertEqual(self.path.read_text().count('KEEP'), 1)
        self.assertEqual(self.path.read_text().count(c.APPENDIX_END), 1)

    def test_bilingual_appendix(self):
        text = c.build_appendix(c.load_profiles(), ['tracking'], {'tracking': '中文用途'}, {'tracking': 'Measure campaigns & improve ads.'})
        self.assertIn('英文权限用途说明', text)
        self.assertIn('Cross-App Tracking (ATT)', text)
        self.assertIn('Measure campaigns & improve ads.', text)
        self.assertIn('Measure campaigns &amp; improve ads.', text)
        self.assertIn('Cross-app tracking permission is used', text)
        self.assertIn('中文用途', text)

    def test_xml_escaping(self):
        profiles = c.load_profiles()
        key = next(p['id'] for p in profiles['permissions'] if c._ios_keys(p))
        cfg = c.generate_config(profiles, [key], {key:'A & B < C'})
        ET.fromstring('<dict>'+cfg['iosPlist']+'</dict>')
        self.assertIn('&amp;', cfg['iosPlist'])

    def test_revision_tracks_metadata(self):
        before = revision(self.path)
        save_review(self.path, {'release':{'version':'1'}, 'items':{}, 'history':[]})
        self.assertNotEqual(before, revision(self.path))
        self.assertEqual(load_review(self.path)['release']['version'], '1')

    def test_atomic_failure_keeps_original(self):
        before = self.path.read_bytes()
        with self.assertRaises(TypeError): atomic_write(self.path, None)
        self.assertEqual(before, self.path.read_bytes())
        self.assertEqual(len(list(self.path.parent.iterdir())), 1)

    def test_unique_backups(self):
        a = c.backup_md(self.path); b = c.backup_md(self.path)
        self.assertNotEqual(a,b)

    def test_reset(self):
        self.assertEqual(c.reset_md(self.path, backup=True), 1)
        self.assertNotIn('[x]', self.path.read_text())

if __name__ == '__main__': unittest.main()
