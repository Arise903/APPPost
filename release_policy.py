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


def assess(snapshot, now=None):
    time_zone = (snapshot.get('release') or {}).get('timeZone') or DEFAULT_TIME_ZONE
    today = calendar_date(now, time_zone)
    items = [i for i in snapshot.get('items', []) if not i.get('gate') and i.get('applicable') is not False]
    result = dict(policyVersion=4, timeZone=time_zone, assessedOn=today, total=len(items), done=0, skipped=0, pending=0, blockers=0, missingEvidence=0, ready=False, issues=[])

    def add(id, text, reason):
        result['issues'].append(dict(id=id, text=text, reason=reason))

    for item in items:
        state = item.get('state', 'todo')
        result[{'done': 'done', 'skip': 'skipped'}.get(state, 'pending')] += 1
        if item.get('required') == 'off':
            continue
        reason = ''
        if state not in ('done', 'skip'):
            reason = '必需项待检查'
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
    release = snapshot.get('release') or {}
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
