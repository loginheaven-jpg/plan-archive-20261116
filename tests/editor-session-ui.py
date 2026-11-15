"""Regression for an unsaved editor across auth expiry. All API calls are synthetic.
Run with pnpm dev; no real account, cookie, schedule or database write is used.
"""
import json
import os
from playwright.sync_api import sync_playwright, expect

BASE = os.getenv('UI_TEST_ORIGIN', 'http://127.0.0.1:3000')
A = {'id': 'isolated-editor-a', 'name': '격리 입력 담당자 A', 'role': 'admin', 'departmentIds': ['worship']}
B = {'id': 'isolated-editor-b', 'name': '격리 입력 담당자 B', 'role': 'admin', 'departmentIds': ['worship']}
state = {'actor': A, 'writes': 0}
settings = {'denomination': '한국 개신교', 'ashWednesday': False, 'ascension': False, 'thanksgiving': {'enabled': False, 'rule': 'nthSunday', 'month': 11, 'nth': 3, 'day': 15}, 'reformationSunday': False, 'newYear': False, 'yearEnd': False}

def intercept(route, request):
    if request.method != 'GET':
        state['writes'] += 1
        route.fulfill(status=503, content_type='application/json', body='{"error":"isolated"}')
        return
    if '/api/bootstrap' in request.url:
        body = {'events': [], 'upcoming': [], 'actor': state['actor'], 'venues': [], 'settings': settings, 'auth': {'configured': True, 'onSharedDomain': True, 'loginUrl': '/api/auth/sso', 'message': '격리 응답'}}
    elif '/api/auth/checkin' in request.url:
        body = {'authenticated': state['actor'] is not None, 'state': 'authenticated' if state['actor'] else 'anonymous', 'message': '격리 응답'}
    else:
        body = {}
    route.fulfill(status=200, content_type='application/json', body=json.dumps(body, ensure_ascii=False))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1400, 'height': 1000}, locale='ko-KR')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/api/**', intercept)
    page.goto(BASE + '/')
    expect(page.locator('.signed-user')).to_contain_text(A['name'])
    page.get_by_role('button', name='일정 등록', exact=True).click()
    dialog = page.get_by_role('dialog')
    title = dialog.locator('input[placeholder="예: 온 교회 성탄 축하예배"]')
    title.fill('계정 만료 뒤에도 보존할 입력')
    original_date = dialog.locator('input[type=date]').first.input_value()
    state['actor'] = None
    page.evaluate("window.dispatchEvent(new Event('yebom:session-changed'))")
    expect(dialog.get_by_role('button', name='로그인 상태 다시 확인', exact=True)).to_be_visible()
    assert title.input_value() == '계정 만료 뒤에도 보존할 입력'
    assert title.is_hidden()
    expect(dialog.get_by_role('button', name='일정 등록', exact=True)).to_be_disabled()
    dialog.locator('form').evaluate("form => form.dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}))")
    assert state['writes'] == 0
    state['actor'] = B
    page.evaluate("window.dispatchEvent(new Event('yebom:session-changed'))")
    expect(page.locator('.signed-user')).to_contain_text(B['name'])
    assert title.is_hidden()
    expect(dialog.get_by_role('button', name='일정 등록', exact=True)).to_be_disabled()
    state['actor'] = A
    page.evaluate("window.dispatchEvent(new Event('yebom:session-changed'))")
    expect(title).to_be_visible()
    assert title.input_value() == '계정 만료 뒤에도 보존할 입력'
    assert dialog.locator('input[type=date]').first.input_value() == original_date
    expect(dialog.get_by_role('button', name='일정 등록', exact=True)).to_be_enabled()
    assert state['writes'] == 0 and errors == []
    print(json.dumps({'result':'pass', 'checks':['인증 만료 때 입력 컴포넌트 유지·내용 숨김·저장 차단', '다른 계정으로 입력 소유권 자동 이전하지 않음', '동일 계정 복귀 때 제목·날짜 보존', '실제 DB 쓰기와 브라우저 오류 없음'], 'database_test_writes':0}, ensure_ascii=False, indent=2))
    browser.close()
