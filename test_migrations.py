"""Legacy database adoption, repeat startup, and future-version protection."""
import tempfile
import unittest
from pathlib import Path
from online.db import Database, SCHEMA, to_postgres
from release_policy import validate_review_record


class MigrationTests(unittest.TestCase):
    def test_legacy_adoption_preserves_data_and_is_repeatable(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Database('sqlite:///' + str(Path(directory) / 'legacy.db'))
            with db.connect(write=True) as conn:
                for statement in SCHEMA.split(';'):
                    if statement.strip():
                        conn.execute(statement)
                conn.execute('INSERT INTO users VALUES (?,?,?,?,?)', ('existing', 'owner@example.test', 'Owner', 'hash', 1))
            db.initialize()
            db.initialize()
            with db.connect() as conn:
                self.assertEqual(conn.one('SELECT name FROM users WHERE id=?', ('existing',))['name'], 'Owner')
                self.assertEqual([r['version'] for r in conn.all('SELECT version FROM schema_migrations ORDER BY version')], [1, 2])
                indexes = {r['name'] for r in conn.all("SELECT name FROM sqlite_master WHERE type='index'")}
                self.assertTrue({'sessions_expiry', 'invitations_expiry', 'member_user'} <= indexes)
            with db.connect(write=True) as conn:
                conn.execute('INSERT INTO schema_migrations VALUES (?,?)', (999, 1))
            with self.assertRaisesRegex(RuntimeError, '版本高于'):
                db.initialize()
            with db.connect() as conn:
                self.assertIsNotNone(conn.one('SELECT * FROM users WHERE id=?', ('existing',)))

    def test_placeholder_conversion_skips_string_literals(self):
        self.assertEqual(to_postgres("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?"),
                         "SELECT * FROM sessions WHERE token_hash=%s AND expires_at>%s")
        self.assertEqual(to_postgres("SELECT 'a?b', 'it''s ?' FROM t WHERE x=?"),
                         "SELECT 'a?b', 'it''s ?' FROM t WHERE x=%s")

    def test_file_and_cloud_contract_rejects_invalid_records(self):
        for value in ({'history': {}}, {'items': {'task': {'notes': 123}}}, {'items': {'task': {'reviewDue': '2026-02-30'}}}, {'subscriptions': [{'price': 1}]}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_review_record(value)
        validate_review_record({'release': {'timeZone': 'Asia/Shanghai'}, 'items': {'task': {'reviewDue': '2026-11-02'}}, 'history': []})
