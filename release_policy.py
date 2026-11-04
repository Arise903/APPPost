"""Versioned readiness policy shared with release_readiness.js."""
import datetime
import json
import math
import re
try:
    from zoneinfo import ZoneInfo
except ImportError:  # Local file mode also supports Python 3.8.
    ZoneInfo = None

DEFAULT_TIME_ZONE = 'Asia/Shanghai'


def calendar_date(now=None, time_zone=None):
    time_zone = time_zone or DEFAULT_TIME_ZONE
    if ZoneInfo is not None:
        try:
            zone = ZoneInfo(time_zone)
        except (KeyError, ValueError, TypeError):
            raise ValueError('发布时区无效或时区数据库不可用：' + str(time_zone)) from None
    elif time_zone in ('Asia/Shanghai', 'UTC', 'Etc/UTC'):
        zone = datetime.timezone(datetime.timedelta(hours=8 if time_zone == 'Asia/Shanghai' else 0))
    else:
        raise ValueError('此发布时区需要 Python 3.9+ 和时区数据库')
    instant = now if now is not None else datetime.datetime.now(datetime.timezone.utc)
    if isinstance(instant, str):
        instant = datetime.datetime.fromisoformat(instant.replace('Z', '+00:00'))
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=datetime.timezone.utc)
    return instant.astimezone(zone).date().isoformat()


def basis(snapshot):
    release = snapshot.get('release') or {}
    value = {key: release.get(key) or default for key, default in (
        ('platform', ''), ('appIdIOS', ''), ('appIdAndroid', ''), ('version', ''),
        ('build', ''), ('environment', 'production'), ('apiBaseUrl', ''))}
    value['permissions'] = sorted(snapshot.get('selectedPermissions') or (snapshot.get('permissions') or {}).get('selected', []))
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


MODULE_FEATURES = ('hasSubscriptions', 'hasAdjust', 'hasFirebase', 'hasAnalysisApi', 'hasInitialization', 'hasSubscriptionEvents', 'hasPermissions')


def merge_review(current, patch):
    if not isinstance(patch, dict):
        return patch
    result = dict(current) if isinstance(current, dict) else {}
    for key, value in patch.items():
        if key in ('__proto__', 'constructor', 'prototype'):
            raise ValueError('不支持的记录字段')
        if value is None:
            result.pop(key, None)
        else:
            result[key] = merge_review(result.get(key), value)
    return result


def missing_module_items(module, ids):
    known = set(ids)
    return [item for item in module['items'] if item[0] not in known and not (module.get('legacyCoverage', {}).get(item[0]) and all(id in known for id in module['legacyCoverage'][item[0]]))]


def subscription_events(features):
    return bool(features.get('hasSubscriptions') and any(features.get(key) for key in ('hasAdjust', 'hasFirebase', 'hasAnalysisApi')))


def is_mandatory(item, snapshot):
    features = dict(snapshot.get('features') or {})
    features['hasInitialization'] = bool(features.get('hasAdjust') or features.get('hasAnalysisApi'))
    features['hasSubscriptionEvents'] = subscription_events(features)
    features['hasPermissions'] = bool(snapshot.get('selectedPermissions') or (snapshot.get('permissions') or {}).get('selected'))
    return bool(item.get('cond') in MODULE_FEATURES and features.get(item.get('cond')) or item.get('permissionRule') and features['hasPermissions'])


def required_config(snapshot):
    features, release = snapshot.get('features') or {}, snapshot.get('release') or {}
    fields = {}
    if any(features.get(key) for key in ('hasSubscriptions', 'hasAdjust', 'hasFirebase', 'hasAnalysisApi')):
        fields.update(platform='平台', environment='环境')
        platform = str(release.get('platform') or '').lower()
        if 'ios' in platform:
            fields['appIdIOS'] = 'iOS 应用标识'
        if 'android' in platform:
            fields['appIdAndroid'] = 'Android 应用标识'
    if features.get('hasAdjust'):
        fields['adjustAppToken'] = 'Adjust appToken'
    if features.get('hasFirebase'):
        fields.update(firebaseProjectId='Firebase projectId', firebaseAppId='Firebase appId', firebaseConfig='Firebase 配置信息')
    if features.get('hasAnalysisApi'):
        fields.update(analysisApiUrl='AnalysisApi 地址', analysisApiProjectId='AnalysisApi projectId')
    if subscription_events(features):
        fields['subscriptionEventConfig'] = '订阅事件统计配置'
    if snapshot.get('selectedPermissions') or (snapshot.get('permissions') or {}).get('selected'):
        fields['privacyPolicyUrl'] = '隐私政策地址'
    return fields


INTEGRATION_FIELDS = {'Adjust': {'appToken': 'adjustAppToken'}, 'Firebase': {'projectId': 'firebaseProjectId', 'appId': 'firebaseAppId', 'config': 'firebaseConfig'}, 'AnalysisApi': {'url': 'analysisApiUrl', 'projectId': 'analysisApiProjectId'}}
PROVIDER_FEATURES = {'Adjust': 'hasAdjust', 'Firebase': 'hasFirebase', 'AnalysisApi': 'hasAnalysisApi'}


def configuration_release(snapshot):
    release = dict(snapshot.get('release') or {})
    platform = str(release.get('platform') or '').lower()
    groups = {}
    for row in snapshot.get('integrations') or []:
        key = INTEGRATION_FIELDS.get(row.get('provider'), {}).get(row.get('key'))
        if key and row.get('value') and row.get('environment') == (release.get('environment') or 'production') and (platform == 'ios / android' or row.get('platform') == platform):
            groups.setdefault(key, {})[row['platform']] = row['value']
    for key, values in groups.items():
        release[key] = next(iter(values.values())) if len(values) == 1 else json.dumps(values, ensure_ascii=False, separators=(',', ':'))
    if snapshot.get('subscriptionEvents'):
        release['subscriptionEventConfig'] = json.dumps(snapshot['subscriptionEvents'], ensure_ascii=False)
    return release


def structured_issues(snapshot, add):
    release, features = snapshot.get('release') or {}, snapshot.get('features') or {}
    platform = str(release.get('platform') or '').lower()
    platforms = ['ios', 'android'] if platform == 'ios / android' else [platform] if platform in ('ios', 'android') else []
    rows, env = snapshot.get('integrations') or [], release.get('environment') or 'production'
    for provider, fields in INTEGRATION_FIELDS.items():
        if not features.get(PROVIDER_FEATURES[provider]) or not any(row.get('provider') == provider for row in rows):
            continue
        for target in platforms:
            for key in fields:
                matches = [row for row in rows if row.get('provider') == provider and row.get('platform') == target and row.get('environment') == env and row.get('key') == key]
                if len(matches) != 1 or not matches[0].get('value', '').strip() or matches[0].get('verification') != 'verified' or not matches[0].get('source', '').strip():
                    add('__integrations', provider + ' · ' + target + ' · ' + env + ' · ' + key, '存在重复配置' if len(matches) > 1 else '配置缺失或尚未核验')
    events = snapshot.get('subscriptionEvents') or []
    if subscription_events(features) and events:
        for provider, feature in PROVIDER_FEATURES.items():
            if not features.get(feature):
                continue
            for kind in ('purchase_success', 'purchase_failed', 'purchase_cancelled', 'restore'):
                matches = [row for row in events if row.get('target') == provider and row.get('kind') == kind]
                if not any(row.get('event', '').strip() and row.get('trigger', '').strip() and row.get('source', '').strip() and row.get('verification') == 'verified' and (kind not in ('purchase_success', 'restore') or row.get('dedup', '').strip() and row.get('productField', '').strip() and row.get('orderField', '').strip()) and (kind != 'purchase_success' or row.get('amountField', '').strip() and row.get('currencyField', '').strip()) for row in matches):
                    add('__events', provider + ' · ' + kind, '事件映射缺失或尚未核验')


def permission_texts(profiles, permissions):
    result = {}
    for id in permissions.get('selected', []):
        p = next((p for p in profiles.get('permissions', []) if p['id'] == id), {})
        ios, android = p.get('ios') or {}, p.get('android') or {}
        key = (ios.get('infoplist_keys') or [ios])[0]
        result[id] = {'zh': (permissions.get('descs') or {}).get(id) or key.get('desc') or android.get('desc') or (permissions.get('descsEn') or {}).get(id) or '', 'en': (permissions.get('descsEn') or {}).get(id) or key.get('desc_en') or android.get('desc_en') or (permissions.get('descs') or {}).get(id) or ''}
    return result


def assess(snapshot, now=None):
    time_zone = (snapshot.get('release') or {}).get('timeZone') or DEFAULT_TIME_ZONE
    today = calendar_date(now, time_zone)
    items = [i for i in snapshot.get('items', []) if not i.get('gate') and i.get('applicable') is not False]
    result = dict(policyVersion=6, timeZone=time_zone, assessedOn=today, total=len(items), done=0, skipped=0, pending=0, blockers=0, missingEvidence=0, ready=False, issues=[])

    def add(id, text, reason):
        if id == '__release' and any(issue['id'] == id and issue['text'] == text for issue in result['issues']):
            return
        result['issues'].append(dict(id=id, text=text, reason=reason))

    for item in items:
        state = item.get('state', 'todo')
        result[{'done': 'done', 'skip': 'skipped'}.get(state, 'pending')] += 1
        mandatory = is_mandatory(item, snapshot)
        if item.get('required') == 'off' and not mandatory:
            continue
        reason = ''
        if state not in ('done', 'skip'):
            reason = '必需项待检查'
        elif state == 'skip' and mandatory:
            reason = '启用模块的必检项不可跳过'
        elif state == 'skip':
            if not str(item.get('reason', '')).strip():
                reason = '跳过缺少原因'
            elif item.get('exceptionType') and item['exceptionType'] != 'legacy':
                if item['exceptionType'] not in ('not-applicable', 'deferred', 'risk-accepted'):
                    reason = '跳过类型无效'
                elif item['exceptionType'] == 'deferred':
                    reason = '暂缓项尚未解决'
                elif not str(item.get('exceptionOwner', '')).strip() or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', item.get('reviewDue', '')):
                    reason = '例外缺少负责人或复查期限'
                elif item['reviewDue'] < today:
                    reason = '例外已到期，需重新复查'
                elif item['exceptionType'] == 'risk-accepted' and (item.get('approvalStatus') != 'approved' or not str(item.get('approvalBy', '')).strip() or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', item.get('approvalDate', '')) or item['approvalDate'] > today):
                    reason = '风险接受缺少有效审批记录'
        elif state == 'done':
            try:
                ids = json.loads(item.get('attachmentIds') or '[]')
                if not isinstance(ids, list):
                    ids = []
            except (ValueError, TypeError):
                ids = []
            files = [(snapshot.get('evidenceFiles') or {}).get(id) for id in ids]
            def has_asset(file):
                return file and file.get('assetId') in snapshot.get('assetIds', [])
            valid_files = [f for f in files if has_asset(f) and (not f.get('expiresAt') or f['expiresAt'] >= today)]
            has_text = bool(str(item.get('evidence', '')).strip())
            text_valid = has_text and (not item.get('evidenceExpiresAt') or item['evidenceExpiresAt'] >= today)
            if any(not has_asset(f) for f in files):
                reason = '关联附件缺失'
            elif ((has_text and not text_valid) or any(f and f.get('expiresAt') and f['expiresAt'] < today for f in files)) and not text_valid and not valid_files:
                reason = '验证证据已过期'
            elif item.get('evidenceRequired') == 'on' and not text_valid and not valid_files:
                reason = '缺少必需证据'
        if reason:
            add(item['id'], item['text'], reason)
    for key, value in (snapshot.get('featureStates') or {}).items():
        if value == 'unknown':
            add('__features', {'hasSubscriptions': '订阅管理', 'hasAdjust': 'Adjust', 'hasFirebase': 'Firebase', 'hasAnalysisApi': 'AnalysisApi', 'hasAccountSystem': '账号系统', 'hasPush': '推送', 'hasFeedbackSystem': '反馈', 'targetMinors': '未成年用户'}.get(key, key), '功能使用情况待确认')
    for id in snapshot.get('selectedPermissions') or (snapshot.get('permissions') or {}).get('selected', []):
        record = ((snapshot.get('permissionReviews') or {}).get(id) or {}).get('zh') or {}
        text = ((snapshot.get('permissionTexts') or {}).get(id) or {}).get('zh')
        if record.get('state') != 'verified' or not record.get('source', '').strip() or not record.get('checkedAt') or not record.get('text', '').strip() or text is not None and record.get('text') != text:
            add('__permissions', id, '权限用途说明尚未核对或已变更')
    structured_issues(snapshot, add)
    release = configuration_release(snapshot)
    for key, label in required_config(snapshot).items():
        if not str(release.get(key) or '').strip():
            add('__release', label, '已启用模块缺少必需配置')
    if release.get('strictValidation') == 'on':
        for key, label in (('app', 'App 名称'), ('platform', '平台'), ('version', '版本号'), ('build', '构建号'), ('owner', '负责人')):
            if not str(release.get(key) or '').strip():
                add('__release', label, '发布信息不完整')
    if (snapshot.get('features') or {}).get('hasSubscriptions'):
        products = [p for p in snapshot.get('subscriptions', []) if p.get('status') != 'off']
        if not products:
            add('__subscriptions', '订阅商品', '尚未配置可发布商品')
        seen = set()
        for p in products:
            try:
                price_ok = p.get('price') is not None and p['price'] != '' and math.isfinite(float(p['price'])) and float(p['price']) >= 0
            except (ValueError, TypeError):
                price_ok = False
            try:
                period = float(p.get('periodCount', ''))
                period_ok = math.isfinite(period) and period.is_integer() and 1 <= period <= 9007199254740991
            except (ValueError, TypeError):
                period_ok = False
            project_platform = str(release.get('platform') or '').lower()
            platform = p.get('platform') or (project_platform if project_platform in ('ios', 'android') else 'both')
            if platform not in ('ios', 'android', 'both'):
                platform = 'both'
            error = not price_ok or not re.fullmatch(r'[A-Z]{3}', p.get('currency', '')) or not period_ok or p.get('period') not in ('day', 'week', 'month', 'year', 'custom') or (p.get('period') == 'custom' and not str(p.get('customPeriod') or '').strip())
            if platform in ('ios', 'both') and not str(p.get('iosProductId') or '').strip():
                error = True
            if platform in ('android', 'both') and not str(p.get('androidProductId') or '').strip():
                error = True
            for key in (('iosProductId',) if platform == 'ios' else ('androidProductId',) if platform == 'android' else ('iosProductId', 'androidProductId')):
                if p.get(key):
                    id = key + ':' + p[key] + (':' + p.get('basePlanId', '') if key == 'androidProductId' else '')
                    if id in seen:
                        error = True
                    seen.add(id)
            if error:
                add('__subscriptions', p.get('name') or '未命名商品', '商品配置不完整或重复')
    report = snapshot.get('preflight')
    if report:
        if report.get('basis') != basis(snapshot):
            add('__preflight', '配置预检', '发布配置已变化，预检结果需重新生成')
        elif report.get('errors', 0) > 0:
            add('__preflight', '配置预检', str(report['errors']) + ' 项配置预检错误未解决')
    result['blockers'] = len(result['issues'])
    result['missingEvidence'] = sum(i['reason'] == '缺少必需证据' for i in result['issues'])
    result['ready'] = bool(items) and not result['issues']
    return result


def validate_review_record(value):
    """Shared file/cloud contract; transport wrappers translate ValueError."""
    if not isinstance(value, dict) or not isinstance(value.get('release', {}), dict) or not isinstance(value.get('items', {}), dict) or not isinstance(value.get('history', []), list):
        raise ValueError('发布记录无效')
    calendar_date(time_zone=value.get('release', {}).get('timeZone'))
    report = value.get('preflight')
    if report is not None and (not isinstance(report, dict) or not isinstance(report.get('findings'), list) or type(report.get('errors')) is not int or report['errors'] < 0):
        raise ValueError('配置预检报告格式无效')
    products = value.get('subscriptions', [])
    if not isinstance(products, list) or len(products) > 100 or any(not isinstance(p, dict) or any(not isinstance(v, str) or len(v) > 4000 for v in p.values()) for p in products):
        raise ValueError('订阅商品配置无效')
    for key in ('integrations', 'subscriptionEvents'):
        rows = value.get(key, [])
        if not isinstance(rows, list) or len(rows) > 200 or any(not isinstance(row, dict) or any(not isinstance(v, str) or len(v) > 8000 for v in row.values()) for row in rows):
            raise ValueError('配置或事件表格格式无效')
    reviews = value.get('permissionReviews', {})
    if not isinstance(reviews, dict) or any(not isinstance(langs, dict) or any(not isinstance(row, dict) or any(not isinstance(v, str) or len(v) > 10000 for v in row.values()) for row in langs.values()) for langs in reviews.values()):
        raise ValueError('权限核对记录无效')
    for item in value.get('items', {}).values():
        if not isinstance(item, dict) or any(not isinstance(v, str) for v in item.values()):
            raise ValueError('备注和证据必须为文本')
        for key in ('reviewDue', 'approvalDate', 'reviewedAt', 'evidenceExpiresAt'):
            if item.get(key):
                try:
                    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', item[key]):
                        raise ValueError('date')
                    datetime.date.fromisoformat(item[key])
                except ValueError:
                    raise ValueError('日期应为有效的 YYYY-MM-DD') from None
