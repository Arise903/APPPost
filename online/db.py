"""Transactional storage for SQLite previews and PostgreSQL production."""
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 password_hash TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, document TEXT NOT NULL,
 permissions TEXT NOT NULL, review TEXT NOT NULL, version INTEGER NOT NULL,
 generation INTEGER NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
 PRIMARY KEY(project_id, user_id)
);
CREATE TABLE IF NOT EXISTS snapshots (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL REFERENCES users(id), label TEXT NOT NULL,
 state TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations (
 token_hash TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('editor','viewer')),
 expires_at BIGINT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS login_attempts (
 id TEXT PRIMARY KEY, bucket TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS snapshot_project ON snapshots(project_id,created_at);
CREATE INDEX IF NOT EXISTS attempts_bucket ON login_attempts(bucket,created_at);
"""


class Database:
    def __init__(self, url):
        self.url = url
        self.postgres = url.startswith(('postgres://', 'postgresql://'))

    @contextmanager
    def connect(self, write=False):
        if self.postgres:
            import psycopg
            from psycopg.rows import dict_row
            conn = psycopg.connect(self.url, row_factory=dict_row, connect_timeout=10)
        else:
            conn = sqlite3.connect(self.url.removeprefix('sqlite:///'), timeout=15)
            conn.row_factory = sqlite3.Row
            conn.execute('PRAGMA foreign_keys=ON')
            if write:
                conn.execute('BEGIN IMMEDIATE')
        try:
            yield Connection(conn, self.postgres)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def initialize(self):
        with self.connect(write=True) as conn:
            if self.postgres:
                conn.execute('SELECT pg_advisory_xact_lock(82409132)')
            for statement in SCHEMA.split(';'):
                if statement.strip():
                    conn.execute(statement)


class Connection:
    def __init__(self, conn, postgres):
        self.conn, self.postgres = conn, postgres

    def execute(self, sql, params=()):
        return self.conn.execute(sql.replace('?', '%s') if self.postgres else sql, params)

    def one(self, sql, params=()):
        row = self.execute(sql, params).fetchone()
        return dict(row) if row else None

    def all(self, sql, params=()):
        return [dict(row) for row in self.execute(sql, params).fetchall()]


def project_state(project):
    return {key: project[key] for key in ('name', 'document', 'permissions', 'review', 'generation')}


def snapshot(conn, project, actor, label):
    conn.execute('INSERT INTO snapshots VALUES (?,?,?,?,?,?)',
                 (f'{time.time_ns():020d}-' + uuid.uuid4().hex, project['id'], actor, label,
                  json.dumps(project_state(project), ensure_ascii=False), int(time.time())))
    # Keep the most recent 50 complete revisions for each project.
    old = conn.all('SELECT id FROM snapshots WHERE project_id=? ORDER BY created_at DESC,id DESC OFFSET 50' if conn.postgres else
                   'SELECT id FROM snapshots WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT -1 OFFSET 50', (project['id'],))
    for row in old:
        conn.execute('DELETE FROM snapshots WHERE id=?', (row['id'],))
