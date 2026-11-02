"""Cross-backend parity: the local file service and the cloud API apply the same
operations to the same checklist and must produce the same project state."""
import http.client
import json
import os
import sys
import tempfile
import threading
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import checklist_tool as checklist
from online.app import create_app

DOCUMENT = (Path(__file__).resolve().parent / 'online' / 'default_checklist.md').read_text(encoding='utf-8')


def item_states(payload):
    return {item['id']: item['state'] for item in payload['items']}


class LocalBackend:
    """File-backed service, driven over HTTP exactly like the browser does."""

    def __init__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.md = self.root / 'checklist.md'
        self.md.write_text(DOCUMENT, encoding='utf-8')
        checklist.STATE_FILE = self.root / 'generation.json'
        checklist.EN_DOC_FILE = self.root / 'Privacy-and-Permissions-EN.md'
        self.server = checklist.ThreadingHTTPServer(('127.0.0.1', 0), checklist.make_handler())
        self.server.md_path = self.md
        self.server.html_path = self.md.with_suffix('.html')
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def get(self, path):
        status, body = self._request('GET', path)
        assert status == 200, (path, status, body)
        return body

    def post(self, path, data):
        status, body = self._request('POST', path, data)
        return status, body

    def _request(self, method, path, data=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        connection.request(method, path, None if data is None else json.dumps(data), {'Content-Type': 'application/json'})
        response = connection.getresponse()
        raw = json.loads(response.read() or b'{}')
        connection.close()
        return response.status, raw

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()


class CloudBackend:
    """Authenticated cloud API on a throwaway SQLite database."""

    def __init__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.email = uuid.uuid4().hex + '@example.test'
        self.app = create_app({'TESTING': True, 'COOKIE_SECURE': False,
                               'DATABASE_URL': os.getenv('TEST_DATABASE_URL') or 'sqlite:///' + self.tmp.name + '/parity.db',
                               'ADMIN_EMAIL': self.email, 'ADMIN_PASSWORD': 'test-password-long-123'})
        self.client = self.app.test_client()
        self.csrf = self.client.post('/api/auth/login', json={'email': self.email, 'password': 'test-password-long-123'}).json['csrf']
        project = self.client.post('/api/projects', json={'name': 'Parity', 'document': DOCUMENT}, headers=self.headers)
        assert project.status_code == 201, project.json
        self.prefix = '/api/projects/' + project.json['id']

    @property
    def headers(self):
        return {'X-CSRF-Token': self.csrf}

    def get(self, path):
        response = self.client.get(self.prefix + '/' + path)
        assert response.status_code == 200, (path, response.status_code, response.json)
        return response.json

    def post(self, path, data):
        response = self.client.post(self.prefix + '/' + path, json=data, headers=self.headers)
        return response.status_code, response.json

    def close(self):
        self.tmp.cleanup()


class OperationParityTests(unittest.TestCase):
    def setUp(self):
        self.local = LocalBackend()
        self.cloud = CloudBackend()
        self.addCleanup(self.local.close)
        self.addCleanup(self.cloud.close)
        self.checks = 0

    def apply(self, name, local_path, cloud_op, data=None):
        """Run one operation on both backends and return their payloads."""
        data = dict(data or {})
        local_status, local_body = self.local.post(local_path, {'revision': self.local_revision, **data})
        cloud_status, cloud_body = self.cloud.post(cloud_op, {'revision': self.cloud_revision, **data})
        self.assertEqual((local_status, cloud_status), (200, 200), name + ': ' + json.dumps([local_body, cloud_body], ensure_ascii=False)[:400])
        self.local_revision, self.cloud_revision = local_body['revision'], cloud_body['revision']
        self.checks += 1
        self.compare(name, local_body, cloud_body)
        return local_body, cloud_body

    def compare(self, name, local_body, cloud_body):
        self.assertEqual(item_states(local_body), item_states(cloud_body), name + ': item states diverge')
        self.assertEqual(local_body['total'], cloud_body['total'], name + ': total diverges')
        self.assertEqual(local_body['gateDone'], cloud_body['gateDone'], name + ': gate state diverges')
        self.assertEqual(local_body['features'], cloud_body['features'], name + ': features diverge')
        self.assertEqual(local_body['review'].get('release'), cloud_body['review'].get('release'), name + ': release info diverges')

    def test_operations_produce_identical_state(self):
        initial = self.local.get('/api/list')
        self.local_revision, self.cloud_revision = initial['revision'], self.cloud.get('list')['revision']
        self.compare('initial', initial, self.cloud.get('list'))

        self.apply('ack', '/api/ack', 'ack')

        first = next(item['id'] for item in self.local.get('/api/list')['items'] if not item['gate'])
        self.apply('write', '/api/write', 'write', {'states': {first: 'done'}})
        self.apply('review', '/api/review', 'review', {'review': {
            'release': {'app': 'Parity', 'platform': 'iOS', 'version': '1.0', 'build': '1', 'owner': 'QA'},
            'items': {first: {'notes': 'checked', 'evidence': 'shot.png'}},
            'history': [],
        }})
        self.apply('features', '/api/features', 'features', {'features': {'hasSubscriptions': False, 'hasAccountSystem': True}})
        self.apply('subscriptions', '/api/subscriptions', 'subscriptions', {
            'enabled': True,
            'products': [{'id': 'month', 'name': '月度', 'price': '6', 'currency': 'USD', 'period': 'month', 'periodCount': '1', 'iosProductId': 'm1'}],
        })
        _, english = self.apply('perm write', '/api/perm-write', 'perm-write', {'selected': ['camera'], 'descs': {}, 'descsEn': {}})
        self.assertIn('PERMISSION_APPENDIX', english['mdText'])
        self.assertEqual(self.local.md.read_text(encoding='utf-8').count('PERMISSION_APPENDIX'), english['mdText'].count('PERMISSION_APPENDIX'))
        self.apply('clear', '/api/clear', 'clear')
        self.apply('unack', '/api/unack', 'unack')

        final_local = self.local.get('/api/list')
        final_cloud = self.cloud.get('list')
        self.compare('final', final_local, final_cloud)
        self.assertEqual(len(final_local['review']['items']), len(final_cloud['review']['items']))
        self.assertEqual(final_local['review']['subscriptions'], final_cloud['review']['subscriptions'])
        self.assertGreater(self.checks, 0)
        print('Operation parity: %d shared operations produced identical state' % self.checks)


if __name__ == '__main__':
    unittest.main()
