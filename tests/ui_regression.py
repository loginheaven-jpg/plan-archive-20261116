"""Focused UI regressions for reported calendar navigation defects.
All /api requests are intercepted. No test event or actor is stored in the app DB.
Run after pnpm dev: python3 tests/ui_regression.py
Requires Python playwright and Chromium (/usr/bin/chromium by default).
"""
import json
import os
from copy import deepcopy
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('UI_TEST_ORIGIN', 'http://127.0.0.1:3000')
REPORT = Path('/tmp/yebom-ui-report.json')
ACTOR = {'id': 'isolated-ui-test', 'name': '격리 검사 담당자', 'role': 'admin', 'departmentIds': ['worship']}
SETTINGS = {'denomination': '한국 개신교 · 서방 그레고리력', 'ashWednesday': False, 'ascension': False, 'thanksgiving': {'enabled': False, 'rule': 'nthSunday', 'month': 11, 'nth': 3, 'day': 15}, 'reformationSunday': False, 'newYear': False, 'yearEnd': False}

def event(key, date, title, end=None):
    return {'id': key, 'version': 1, 'title': title, 'organizationId': 'worship', 'startDate': date, 'endDate': end or date,
            'allDay': True, 'startTime': None, 'endTime': None, 'audience': 'all', 'audienceIds': [], 'visibility': 'public',
            'locationId': None, 'location': '격리 테스트 장소', 'description': '', 'internalNote': '', 'recurrence': None,
            'status': 'confirmed', 'cancelReason': '', 'deleted': False, 'createdAt': '2026-01-01T00:00:00.000Z',
            'createdBy': {'id': ACTOR['id'], 'name': ACTOR['name']}, 'updatedAt': None, 'updatedBy': None, 'exceptions': []}

EVENTS = [event('single', '2026-04-05', '격리 검사 부활절 행사'), event('multi-a', '2026-11-15', '격리 검사 행사 A'), event('multi-b', '2026-11-15', '격리 검사 행사 B'), event('span', '2026-06-10', '격리 검사 여러 날 일정', '2026-06-12')]
repeating = event('repeat', '2026-02-01', '격리 검사 반복 모임')
repeating['recurrence'] = {'frequency':'weekly','interval':1,'until':'2026-03-31'}
repeating['exceptions'] = [{'date':'2026-02-08','patch':{},'cancelled':True,'reason':'격리 검사 회차 취소 사유','updatedAt':'2026-02-02T00:00:00.000Z','updatedBy':{'id':ACTOR['id'],'name':ACTOR['name']}}]
EVENTS.append(repeating)
CHANGES = [{'id':'isolated-change','eventId':'repeat','title':'격리 검사 반복 모임','organizationId':'worship','kind':'cancel-occurrence','occurrenceDate':'2026-02-08','at':'2026-02-02T00:00:00.000Z','by':{'id':ACTOR['id'],'name':ACTOR['name']},'reason':'격리 검사 회차 취소 사유','changedFields':['exceptions'],'before':None,'after':None}]
errors, checks, writes = [], [], []

def intercept(route, request, actor=ACTOR):
    url = request.url
    if request.method != 'GET':
        writes.append({'url': url, 'method': request.method, 'body': request.post_data_json})
        route.fulfill(status=503, content_type='application/json', body=json.dumps({'error':'격리 검사에서는 저장 요청을 수행하지 않습니다.'}, ensure_ascii=False))
        return
    if '/api/bootstrap' in url:
        projected = deepcopy(EVENTS)
        if actor is None:
            for value in projected:
                value['createdBy'] = None; value['updatedBy'] = None; value['internalNote'] = ''
        payload = {'events': projected, 'upcoming': [], 'actor': actor, 'venues': [], 'settings': SETTINGS,
                   'auth': {'configured': False, 'onSharedDomain': False, 'loginUrl': None, 'message': '격리 검사 응답'}}
    elif '/api/auth/checkin' in url: payload = {'authenticated': actor is not None, 'state': 'authenticated' if actor else 'anonymous'}
    elif '/api/events/' in url:
        key = url.split('/api/events/')[1].split('?')[0]
        payload = {'event': next(e for e in EVENTS if e['id']==key), 'history': []}
    elif '/api/changes' in url: payload = {'changes': CHANGES}
    elif '/api/trash' in url: payload = {'events': []}
    else: payload = {}
    route.fulfill(status=200, content_type='application/json', body=json.dumps(payload, ensure_ascii=False))

def close_dialog(page):
    page.get_by_role('dialog').get_by_role('button', name='닫기', exact=True).first.click()

def activate_date(page, date):
    page.get_by_role('button', name=f'{date[0:4]}년 {int(date[5:7])}월 {int(date[8:10])}일', exact=False).first.click()

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'), args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1440,'height':1050},locale='ko-KR')
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.route('**/api/**', intercept)
    page.goto(BASE+'/?year=2026&month=11&view=year')
    page.wait_for_selector('.month-card')
    assert page.locator('.month-card').count()==12
    assert page.get_by_text('보고 싶은 부서',exact=True).count()==0
    allbox=page.locator('.all-select input').bounding_box()
    firstbox=page.locator('.department-options input').first.bounding_box()
    assert allbox['y'] < firstbox['y'] and abs(allbox['x']-firstbox['x'])<2
    checks.append('전체 선택 왼쪽·부서 위 정렬, 불필요 제목 제거')
    page.locator('.month-card').nth(3).click(position={'x':4,'y':4})
    assert page.get_by_role('button',name='월간',exact=True).get_attribute('aria-pressed')=='true'
    assert page.locator('.period-nav h2').inner_text()=='2026년 4월'
    checks.append('연간 월카드 빈 영역 → 정확한 월간')
    page.get_by_role('button',name='연간',exact=True).click()
    page.locator('.month-card').nth(10).focus(); page.keyboard.press('Enter')
    assert page.locator('.period-nav h2').inner_text()=='2026년 11월'
    checks.append('월카드 키보드 Enter 이동')
    page.get_by_role('button',name='연간',exact=True).click()
    activate_date(page,'2026-04-05')
    assert page.get_by_role('dialog').get_by_text('일정 자세히 보기',exact=True).is_visible()
    assert page.get_by_role('dialog').get_by_text('격리 검사 부활절 행사',exact=True).is_visible()
    assert page.locator('.view-tabs button').nth(0).get_attribute('aria-pressed')=='true'
    close_dialog(page)
    checks.append('연간 1개 일정 → 바로 상세, 교회력 미계산, 월카드로 전파 안 됨')
    activate_date(page,'2026-11-15')
    assert page.get_by_role('button',name='목록',exact=True).get_attribute('aria-pressed')=='true'
    assert page.locator('.agenda-event').count()==2
    assert '11월 15일' in page.locator('.day-focus').inner_text()
    checks.append('연간 복수 일정 → 해당 날짜 2개만 목록')
    page.get_by_role('button',name='연간',exact=True).click(); activate_date(page,'2026-11-16')
    assert page.get_by_role('dialog').get_by_text('새 일정 등록',exact=True).is_visible()
    assert page.get_by_role('dialog').locator('input[type=date]').first.input_value()=='2026-11-16'
    assert page.get_by_role('dialog').get_by_text(ACTOR['name'],exact=True).is_visible()
    close_dialog(page)
    checks.append('연간 빈 날짜 → 해당 날짜 입력, 작성자 자동 표시')
    page.locator('.month-card').nth(3).get_by_role('button').first.click()
    activate_date(page,'2026-04-05')
    assert page.get_by_role('dialog').get_by_text('격리 검사 부활절 행사',exact=True).is_visible()
    close_dialog(page)
    activate_date(page,'2026-04-06')
    assert page.get_by_role('dialog').locator('input[type=date]').first.input_value()=='2026-04-06'
    close_dialog(page)
    checks.append('월간 1개 바로 상세 / 0개 날짜 입력')
    page.get_by_role('button',name='연간',exact=True).click(); page.locator('.month-card').nth(10).get_by_role('button').first.click()
    activate_date(page,'2026-11-15'); assert page.locator('.agenda-event').count()==2
    checks.append('월간 복수도 정확한 하루 목록')
    page.get_by_role('button',name='연간',exact=True).click(); activate_date(page,'2026-06-11')
    assert page.get_by_role('dialog').get_by_text('격리 검사 여러 날 일정',exact=True).is_visible()
    close_dialog(page)
    checks.append('여러 날 일정의 중간 날짜 → 바로 상세')
    page.locator('.department-options input').first.uncheck()
    assert page.locator('.all-select input').evaluate('(e)=>e.indeterminate')
    checks.append('일부 선택 중간 체크 상태')
    page.get_by_role('button',name='최근 변경',exact=True).click()
    page.get_by_role('dialog').get_by_role('button',name='이번 회차 취소',exact=False).click()
    assert '2026년 2월 8일' in page.locator('.detail-facts').inner_text()
    assert '격리 검사 회차 취소 사유' in page.get_by_role('dialog').inner_text()
    assert '취소' in page.locator('.detail-badges').inner_text()
    page.get_by_role('dialog').get_by_role('button',name='다시 시작',exact=True).click()
    assert page.get_by_role('dialog').get_by_text('취소한 일정 다시 시작',exact=True).is_visible()
    resume_button=page.get_by_role('button',name='취소 해제하고 다시 시작',exact=True)
    assert resume_button.is_disabled()
    page.get_by_label('다시 진행하는 이유',exact=False).fill('격리 검사 명시적 재개 사유')
    assert resume_button.is_disabled()
    page.get_by_label('취소를 해제하고 이 일정을 다시 진행합니다',exact=True).check()
    assert resume_button.is_enabled()
    page.once('dialog',lambda dialog:dialog.accept()); close_dialog(page)
    checks.append('최근 회차 취소 → 실제 날짜·취소 사유 상세 / 확인+사유 후에만 재개 가능')
    page.locator('.department-options input').first.check()
    page.locator('.month-card').nth(3).get_by_role('button').first.click()
    activate_date(page,'2026-04-05')
    page.get_by_role('dialog').get_by_role('button',name='수정',exact=True).click()
    page.get_by_label('시간 없이 하루 종일',exact=True).uncheck()
    page.get_by_role('button',name='변경 저장',exact=True).click()
    page.get_by_role('dialog').get_by_text('격리 검사에서는 저장 요청을 수행하지 않습니다.',exact=True).wait_for()
    assert writes[-1]['body']['input']['startTime']=='09:00'
    assert writes[-1]['body']['input']['endTime']=='10:00'
    assert writes[-1]['body']['input']['allDay'] is False
    assert page.get_by_role('dialog').locator('input[type=time]').first.input_value()=='09:00'
    page.once('dialog',lambda dialog:dialog.accept()); close_dialog(page)
    checks.append('종일→시간 변경 실제 payload 09:00/10:00 · 저장 실패 입력 보존 · 서버 요청 격리')
    readonly=browser.new_page(viewport={'width':390,'height':844},locale='ko-KR',is_mobile=True,has_touch=True)
    readonly.route('**/api/**',lambda route,request:intercept(route,request,actor=None))
    readonly.on('pageerror',lambda err:errors.append(str(err)))
    readonly.goto(BASE+'/share?year=2026&month=11')
    readonly.wait_for_selector('.agenda')
    assert readonly.get_by_role('button',name='목록',exact=True).get_attribute('aria-pressed')=='true'
    assert readonly.evaluate('document.documentElement.scrollWidth <= innerWidth')
    readonly.get_by_role('button',name='연간',exact=True).click(); activate_date(readonly,'2026-11-16')
    assert readonly.get_by_role('dialog').get_by_text('이 날짜에는 일정이 없어요',exact=True).is_visible()
    assert readonly.get_by_role('dialog').locator('input[type=date]').count()==0
    close_dialog(readonly)
    readonly.get_by_role('button',name='부서 선택 메뉴',exact=True).click()
    assert readonly.locator('.sidebar.open .department-options input').count()==10
    checks.append('모바일 목록 기본·넘침 없음·공개 빈 날짜 입력 차단·10부서 메뉴')
    assert len(writes)==1 and writes[0]['method']=='PATCH' and '/api/events/single' in writes[0]['url'],writes
    assert not errors,errors
    browser.close()
REPORT.write_text(json.dumps({'result':'pass','checks':checks,'page_errors':errors,'database_test_writes':0,'intercepted_mutations':writes},ensure_ascii=False,indent=2)+'\n')
print(REPORT.read_text())
