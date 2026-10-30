"""Cloud data isolation, transaction, authentication and migration tests."""
import json
import os
import tempfile
import unittest
import uuid

from online.app import create_app


class OnlineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.email = uuid.uuid4().hex + '@example.test'
        self.password = 'test-password-long-123'
        self.app = create_app({'TESTING':True, 'COOKIE_SECURE':False,
            'DATABASE_URL':os.getenv('TEST_DATABASE_URL') or 'sqlite:///'+self.tmp.name+'/test.db',
            'ADMIN_EMAIL':self.email, 'ADMIN_PASSWORD':self.password})
        self.client = self.app.test_client()
        self.csrf = self.login(self.client)
        self.headers = {'X-CSRF-Token':self.csrf}
        self.project = self.client.post('/api/projects', json={'name':'Test App'}, headers=self.headers).json['id']
        self.prefix = '/api/projects/'+self.project

    def test_subscription_settings_save_atomically_and_preserve_disabled_values(self):
        products = [{'id': 'month', 'name': '月订阅', 'trialEnabled': 'off', 'trialCount': '7', 'offerEnabled': 'off', 'offerPrice': '6'}]
        original = self.payload()
        saved = self.post('subscriptions', {'revision': original['revision'], 'enabled': False, 'products': products})
        self.assertEqual(saved.status_code, 200)
        self.assertFalse(saved.json['features']['hasSubscriptions'])
        self.assertEqual(saved.json['review']['subscriptions'], products)
        revision = saved.json['revision']
        bad = self.post('subscriptions', {'revision': revision, 'enabled': True, 'products': [{'price': 12}]})
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(self.payload()['revision'], revision)
        self.assertFalse(self.payload()['features']['hasSubscriptions'])
        stale = self.post('subscriptions', {'revision': original['revision'], 'enabled': True, 'products': []})
        self.assertEqual(stale.status_code, 409)
        restored = self.post('subscriptions', {'revision': revision, 'enabled': True, 'products': products})
        self.assertTrue(restored.json['features']['hasSubscriptions'])
        self.assertEqual(restored.json['review']['subscriptions'], products)

    def test_optional_sdk_modules_on_custom_document(self):
        created = self.client.post('/api/projects', json={'name': 'Custom', 'document': '# App\n## Checks\n- [ ] One\n'}, headers=self.headers)
        self.prefix = '/api/projects/' + created.json['id']
        original = self.payload()
        features = {**original['features'], 'hasAdjust': True, 'hasAnalysisApi': True}
        enabled = self.post('features', {'revision': original['revision'], 'features': features})
        self.assertEqual(enabled.status_code, 200)
        self.assertEqual(len(enabled.json['items']), 13)
        disabled = self.post('features', {'revision': enabled.json['revision'], 'features': {**features, 'hasAdjust': False}})
        self.assertEqual(disabled.json['total'], 9)
        back = self.post('features', {'revision': disabled.json['revision'], 'features': features})
        self.assertEqual(len(back.json['items']), 13)
        invalid = self.post('features', {'revision': back.json['revision'], 'features': {**features, 'hasAdjust': 'on'}})
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(self.payload()['revision'], back.json['revision'])

    def login(self, client):
        response = client.post('/api/auth/login',json={'email':self.email,'password':self.password})
        self.assertEqual(response.status_code,200)
        return response.json['csrf']

    def payload(self, client=None):
        return (client or self.client).get(self.prefix+'/list').json

    def post(self, operation, data, client=None, headers=None):
        return (client or self.client).post(self.prefix+'/'+operation,json=data,headers=self.headers if headers is None else headers)

    def invite_member(self, role):
        email = uuid.uuid4().hex+'@example.test'
        response = self.post('invite', {'email':email,'role':role})
        token = response.json['path'].split('#')[1]
        client = self.app.test_client()
        joined = client.post('/api/invitations/accept',json={'token':token,'name':'Member','password':self.password})
        self.assertEqual(joined.status_code,200)
        return client, {'X-CSRF-Token':joined.json['csrf']}, token

    def test_anonymous_and_private_files_blocked(self):
        anonymous = self.app.test_client()
        self.assertEqual(anonymous.get('/api/projects').status_code,401)
        self.assertEqual(anonymous.get(self.prefix+'/list').status_code,401)
        self.assertEqual(anonymous.get('/上架前App配置清单.md').status_code,404)
        self.assertEqual(anonymous.get('/login').status_code,200)

    def test_csrf_and_origin(self):
        self.assertEqual(self.client.post('/api/projects',json={'name':'bad'}).status_code,403)
        self.assertEqual(self.client.post('/api/projects',json={'name':'bad'},headers={**self.headers,'Origin':'https://evil.test'}).status_code,403)
        self.assertEqual(self.client.post('/api/projects',data='{}',headers=self.headers).status_code,415)

    def test_conflicting_save_and_full_restore(self):
        original = self.payload(); item = next(x['id'] for x in original['items'] if not x['gate'])
        saved = self.post('write', {'revision':original['revision'],'states':{item:'done'}})
        self.assertEqual(saved.status_code,200)
        conflict = self.post('clear', {'revision':original['revision']})
        self.assertEqual(conflict.status_code,409)
        review = {'release':{'version':'2'},'items':{},'history':[]}
        result = self.post('review',{'revision':saved.json['revision'],'review':review})
        backups = self.post('backups',{}).json['backups']
        before_write = next(row['id'] for row in self.post('backups',{}).json['entries'] if row['label']=='write')
        restored = self.post('restore',{'revision':result.json['revision'],'name':before_write})
        self.assertEqual(restored.status_code,200)
        self.assertEqual(restored.json['review']['release'],{})
        self.assertEqual(next(x for x in restored.json['items'] if x['id']==item)['state'],'todo')

    def test_invite_viewer_editor_and_revocation(self):
        viewer, headers, token = self.invite_member('viewer')
        self.assertEqual(viewer.get(self.prefix+'/list').status_code,200)
        self.assertEqual(viewer.post(self.prefix+'/clear',json={'revision':self.payload()['revision']},headers=headers).status_code,403)
        self.assertEqual(viewer.post('/api/invitations/accept',json={'token':token,'name':'again','password':self.password}).status_code,400)
        members = self.client.get(self.prefix+'/members').json['members']
        member_id = next(m['id'] for m in members if m['role']=='viewer')
        self.assertEqual(self.post('members',{'userId':member_id,'role':'editor'}).status_code,200)
        self.assertEqual(viewer.post(self.prefix+'/review',json={'revision':self.payload()['revision'],'review':{'release':{},'items':{},'history':[]}},headers=headers).status_code,200)
        self.assertEqual(self.post('members',{'userId':member_id,'role':'remove'}).status_code,200)
        self.assertEqual(viewer.get(self.prefix+'/list').status_code,404)

    def test_cross_project_isolation(self):
        member, headers, _ = self.invite_member('editor')
        own = member.post('/api/projects',json={'name':'Private to member'},headers=headers).json['id']
        self.assertEqual(self.client.get('/api/projects/'+own+'/list').status_code,404)
        self.assertEqual(self.client.get('/api/projects/'+own+'/export').status_code,404)
        self.assertEqual(self.client.get('/projects/'+own).status_code,404)

    def test_validation_and_atomic_rollback(self):
        original = self.payload()
        bad = self.post('write',{'revision':original['revision'],'states':{'unknown':'done'}})
        self.assertEqual(bad.status_code,409)
        self.assertEqual(self.post('backups',{}).json['backups'],[])
        self.assertEqual(self.payload()['revision'],original['revision'])
        self.assertEqual(self.post('perm-write',{'revision':original['revision'],'selected':['unknown']}).status_code,400)

    def test_export_import_preserves_data(self):
        original = self.payload()
        self.post('review',{'revision':original['revision'],'review':{'release':{'version':'3'},'items':{},'history':[]}})
        exported = self.client.get(self.prefix+'/export')
        self.assertEqual(exported.status_code,200)
        data = exported.json; data['name']='Imported'
        created = self.client.post('/api/projects',json=data,headers=self.headers)
        self.assertEqual(created.status_code,201)
        loaded = self.client.get('/api/projects/'+created.json['id']+'/list').json
        self.assertEqual(loaded['review']['release']['version'],'3')
        self.assertEqual(loaded['mdText'],data['document'])

    def test_password_reset_revokes_other_sessions(self):
        other = self.app.test_client();self.login(other)
        response=self.client.post('/api/auth/password',json={'current':self.password,'password':'new-long-password-1234'},headers=self.headers)
        self.assertEqual(response.status_code,200)
        self.assertEqual(other.get('/api/me').status_code,401)
        self.assertEqual(self.client.get('/api/me').status_code,200)

    def test_guide_and_board_are_scoped(self):
        response=self.client.get('/projects/'+self.project)
        self.assertEqual(response.status_code,200)
        self.assertIn(b'RELEASE_CLOUD',response.data)
        self.assertIn('frame-ancestors',response.headers['Content-Security-Policy'])
        guide=self.client.get('/projects/'+self.project+'/guide')
        self.assertEqual(guide.status_code,200)
        self.assertIn((self.prefix+'/ack').encode(),guide.data)

    def test_feedback_feature_is_optional(self):
        initial = self.payload()
        self.assertFalse(initial['features']['hasFeedbackSystem'])
        feedback = [x for x in initial['items'] if x['cond'] == 'hasFeedbackSystem']
        self.assertTrue(feedback)
        enabled = self.post('features', {'revision': initial['revision'], 'features': {'hasAccountSystem': True, 'targetMinors': True, 'hasFeedbackSystem': True}})
        self.assertEqual(enabled.status_code, 200)
        self.assertTrue(enabled.json['features']['hasFeedbackSystem'])
        self.assertEqual(enabled.json['total'], initial['total'] + len(feedback))

    def test_new_release_archives_and_resets_atomically(self):
        original=self.payload()
        task=next(x for x in original['items'] if not x['gate'])
        checked=self.post('write',{'revision':original['revision'],'states':{task['id']:'done'}}).json
        reviewed=self.post('review',{'revision':checked['revision'],'review':{'release':{'version':'1'},'items':{task['id']:{'notes':'keep','evidence':'drop','required':'on','evidenceRequired':'on'}},'history':[]}}).json
        next_release=self.post('new-release',{'revision':reviewed['revision'],'release':{'version':'2'},'keepNotes':True,'keepEvidence':False})
        self.assertEqual(next_release.status_code,200)
        data=next_release.json
        self.assertEqual(data['review']['history'][0]['release']['version'],'1')
        self.assertEqual(data['review']['history'][0]['readiness']['policyVersion'],4)
        self.assertFalse(data['review']['history'][0]['readiness']['ready'])
        self.assertEqual(data['review']['items'][task['id']],{'notes':'keep','required':'on','evidenceRequired':'on'})
        self.assertEqual(next(x for x in data['items'] if x['id']==task['id'])['state'],'todo')
        self.assertEqual(data['review']['release']['version'],'2')

    def test_release_timezone_validation_preserves_saved_project(self):
        original = self.payload()
        invalid = self.post('review', {'revision': original['revision'], 'review': {
            'release': {'timeZone': 'Invalid/Timezone'}, 'items': {}, 'history': []}})
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(self.payload()['revision'], original['revision'])
        saved = self.post('review', {'revision': original['revision'], 'review': {
            'release': {'timeZone': 'America/Los_Angeles'}, 'items': {}, 'history': []}})
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json['review']['release']['timeZone'], 'America/Los_Angeles')

    def test_login_throttle(self):
        anonymous=self.app.test_client()
        email=uuid.uuid4().hex+'@example.test'
        for _ in range(10):
            self.assertEqual(anonymous.post('/api/auth/login',json={'email':email,'password':'bad'}).status_code,401)
        self.assertEqual(anonymous.post('/api/auth/login',json={'email':email,'password':'bad'}).status_code,429)

if __name__=='__main__':unittest.main()
