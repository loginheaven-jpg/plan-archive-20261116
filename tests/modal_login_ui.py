"""Targeted regressions for the observed login and cross-account overlay defects.
All API calls, including login, are intercepted. No real account/cookie/DB write.
"""
import json
import os
from copy import deepcopy
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('UI_TEST_ORIGIN', 'http://127.0.0.1:3000')
A = {'id': 'isolated-modal-a', 'name': '격리 담당자 A', 'role': 'admin', 'departmentIds': ['children']}
B = {'id': 'isolated-modal-b', 'name': '격리 담당자 B', 'role': 'admin', 'departmentIds': ['children']}
SETTINGS = {'denomination': '한국 개신교 · 서방 그레고리력', 'ashWednesday': False, 'ascension': False,
            'thanksgiving': {'enabled': False, 'rule': 'nthSunday', 'month': 11, 'nth': 3, 'day': 15},
            'reformationSunday': False, 'newYear': False, 'yearEnd': False}
EVENT = {'id': '11111111-1111-4111-8111-111111111111', 'version': 1, 'title': '격리 비공개 제목',
         'organizationId': 'children', 'startDate': '2027-03-10', 'endDate': '2027-03-10', 'allDay': True,
         'startTime': None, 'endTime': None, 'audience': 'all', 'audienceIds': [], 'visibility': 'members',
         'locationId': None, 'location': '', 'description': '격리 비공개 안내', 'internalNote': '',
         'recurrence': None, 'status': 'confirmed', 'cancelReason': '', 'deleted': False,
         'createdAt': '2026-01-01T00:00:00.000Z', 'createdBy': {'id': A['id'], 'name': A['name']},
         'updatedAt': None, 'updatedBy': None, 'exceptions': []}
errors, checks = [], []


def fulfill(route, body, status=200):
    route.fulfill(status=status, content_type='application/json', body=json.dumps(body, ensure_ascii=False))


class API:
    def __init__(self, actor=None, profile=False):
        self.actor = deepcopy(actor)
        self.profile = profile
        self.login_count = 0
        self.reject_first = False
        self.calls = []

    def snapshot(self):
        return {'authenticated': self.actor is not None,
                'identity': {'id': self.actor['id'], 'name': self.actor['name']} if self.actor else None,
                'state': 'profile_incomplete' if self.profile else 'authenticated' if self.actor else 'anonymous',
                'profileCompletionRequired': self.profile, 'passwordResetRequired': False,
                'profileMissingFields': ['phone'] if self.profile else [], 'message': '격리 확인'}

    def intercept(self, route, request):
        path = urlparse(request.url).path
        self.calls.append((path, request.method))
        if path == '/api/auth/checkin':
            fulfill(route, self.snapshot(), 200 if self.actor else 401)
        elif path == '/api/auth/login':
            self.login_count += 1
            if self.reject_first and self.login_count == 1:
                body = self.snapshot(); body['message'] = '계정 또는 비밀번호가 일치하지 않아요.'
                fulfill(route, body, 401)
            else:
                self.actor = deepcopy(A)
                fulfill(route, self.snapshot())
        elif path == '/api/bootstrap':
            active = self.actor if not self.profile else None
            events = [deepcopy(EVENT)] if active and active['id'] == A['id'] else []
            fulfill(route, {'events': events, 'upcoming': [], 'actor': active, 'venues': [], 'settings': SETTINGS,
                            'auth': {'configured': True, 'onSharedDomain': True,
                                     'loginUrl': 'https://plan.yebom.org/api/auth/sso', 'message': '격리 확인'}})
        elif path.startswith('/api/events/'):
            fulfill(route, {'event': deepcopy(EVENT), 'history': []})
        elif path == '/api/changes':
            fulfill(route, {'changes': []})
        elif path == '/api/trash':
            fulfill(route, {'events': []})
        else:
            fulfill(route, {'error': '격리 검사: 실제 요청을 수행하지 않습니다.'}, 503)


def new_page(browser, api):
    page = browser.new_page(viewport={'width': 1360, 'height': 900})
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/api/**', api.intercept)
    page.goto(BASE + '/?year=2027&month=3&view=month&org=children', wait_until='networkidle')
    return page


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),
                                headless=True, args=['--no-sandbox'])
    api = API(); api.reject_first = True
    page = new_page(browser, api)
    page.get_by_role('button', name='일정 등록', exact=True).click()
    dialog = page.get_by_role('dialog')
    email = dialog.get_by_label('이메일 또는 전화번호', exact=True)
    expect(email).to_be_visible()
    email.fill('fixture@example.invalid')
    dialog.get_by_label('비밀번호', exact=True).fill('isolated-incorrect')
    dialog.get_by_role('button', name='로그인', exact=True).click()
    expect(dialog.get_by_text('계정 또는 비밀번호가 일치하지 않아요.', exact=True)).to_be_visible()
    expect(email).to_have_value('fixture@example.invalid')
    expect(dialog.get_by_label('비밀번호', exact=True)).to_have_value('')
    dialog.get_by_label('비밀번호', exact=True).fill('isolated-correct')
    dialog.get_by_role('button', name='로그인', exact=True).click()
    expect(page.get_by_role('dialog').get_by_role('heading', name='새 일정 등록')).to_be_visible(timeout=15000)
    expect(page.get_by_role('dialog').get_by_label('일정 이름', exact=False)).to_be_visible()
    assert urlparse(page.url).path == '/' and 'year=2027' in page.url
    assert api.login_count == 2
    assert not any(path.startswith('/api/events') and method != 'GET' for path, method in api.calls)
    checks.append('모달 비밀번호 오류 재입력·이메일 보존·원래 등록 창 복귀·화면 이동 없음')
    page.close()

    api = API(A, True)
    page = new_page(browser, api)
    page.get_by_role('button', name='일정 등록', exact=True).click()
    dialog = page.get_by_role('dialog')
    expect(dialog.get_by_role('heading', name='필수 프로필 정보를 완료해 주세요')).to_be_visible()
    assert dialog.get_by_label('비밀번호', exact=True).count() == 0
    assert api.login_count == 0
    checks.append('프로필 미완료 신원 자동 연결·비밀번호 창 없음·편집 제한 유지')
    page.close()

    api = API(A)
    page = new_page(browser, api)
    expect(page.get_by_role('button', name='일정 등록', exact=True)).to_be_enabled()
    page.get_by_role('button', name='연간', exact=True).click()
    page.get_by_role('button', name='2027년 3월 10일', exact=False).first.click()
    expect(page.get_by_role('dialog').get_by_text('격리 비공개 안내', exact=True)).to_be_visible()
    api.actor = deepcopy(B)
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    expect(page.get_by_role('dialog')).to_have_count(0, timeout=15000)
    expect(page.get_by_text('격리 비공개 제목', exact=True)).to_have_count(0)
    expect(page.get_by_text('격리 비공개 안내', exact=True)).to_have_count(0)
    assert api.login_count == 0
    checks.append('다른 계정으로 바뀐 뒤 이전 비공개 상세·이력 닫기·추가 자격정보 없음')
    page.close()
    browser.close()

assert not errors, errors
print(json.dumps({'checks': checks, 'page_errors': errors, 'real_database_writes': 0}, ensure_ascii=False, indent=2))
