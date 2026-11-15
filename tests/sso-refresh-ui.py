"""Focused SSO refresh regressions; every /api request is intercepted in memory.
No real cookies, accounts, saved records, or database mutations are used.
Run against the local dev server: python3 tests/sso-refresh-ui.py
UI_TEST_ORIGIN and CHROMIUM_PATH optionally override the local defaults.
"""
import json
import os
import time
from copy import deepcopy
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("UI_TEST_ORIGIN", "http://127.0.0.1:3000")
SETTINGS = {
    "denomination": "한국 개신교 · 서방 그레고리력",
    "ashWednesday": False, "ascension": False,
    "thanksgiving": {"enabled": False, "rule": "nthSunday", "month": 11, "nth": 3, "day": 15},
    "reformationSunday": False, "newYear": False, "yearEnd": False,
}
A = {"id": "isolated-sso-a", "name": "격리 담당자 A", "role": "editor", "departmentIds": ["children"]}
B = {"id": "isolated-sso-b", "name": "격리 담당자 B", "role": "editor", "departmentIds": ["children"]}
EVENT = {
    "id": "isolated-public", "version": 1, "title": "격리 공개 일정",
    "organizationId": "children", "startDate": "2027-11-15", "endDate": "2027-11-15",
    "allDay": True, "startTime": None, "endTime": None, "audience": "all", "audienceIds": [],
    "visibility": "public", "locationId": None, "location": "", "description": "",
    "internalNote": "", "recurrence": None, "status": "confirmed", "cancelReason": "",
    "deleted": False, "createdAt": "2026-01-01T00:00:00.000Z", "createdBy": None,
    "updatedAt": None, "updatedBy": None, "exceptions": [],
}
SUMMARIES = [
    {"id": "isolated-draft-" + actor["id"], "ownerId": actor["id"], "version": version,
     "year": 2027, "organizationId": "children", "createdAt": "2026-11-15T00:00:00.000Z",
     "updatedAt": "2026-11-15T00:00:00.000Z", "rowCount": count, "publishedCount": 0}
    for actor, count, version in [(A, 2, 91), (B, 7, 3)]
]
errors, checks, requests_seen, mutations = [], [], [], []


def fulfill(route, payload, status=200):
    route.fulfill(status=status, content_type="application/json", body=json.dumps(payload, ensure_ascii=False))


class MockAPI:
    def __init__(self, actor=None, state="profile_incomplete"):
        self.actor = actor
        self.state = state
        self.checkins = 0
        self.draft_queries = []
        self.hold_boot = False
        self.hold_drafts = False
        self.pending_boot = []
        self.pending_drafts = []

    def bootstrap(self):
        return {"events": [deepcopy(EVENT)], "upcoming": [], "actor": deepcopy(self.actor),
                "venues": [], "settings": SETTINGS,
                "auth": {"configured": True, "onSharedDomain": True, "loginUrl": None,
                         "message": "격리 로그인 상태"}}

    def intercept(self, route, request):
        path = urlparse(request.url).path
        requests_seen.append({"path": path, "method": request.method})
        if request.method != "GET":
            mutations.append({"path": path, "method": request.method})
            fulfill(route, {"error": "격리 검사: 실제 저장을 수행하지 않습니다."}, 503)
            return
        if path == "/api/auth/checkin":
            self.checkins += 1
            message = {"profile_incomplete": "격리 검사: 교적부 프로필 작성을 완료해 주세요.",
                       "not_approved": "격리 검사: 교적부 계정 승인을 요청해 주세요."}.get(self.state, "")
            fulfill(route, {"authenticated": self.state == "authenticated", "state": self.state,
                            "message": message}, 403 if message else 200)
        elif path == "/api/bootstrap":
            payload = self.bootstrap()
            if self.hold_boot:
                self.hold_boot = False
                self.pending_boot.append((route, payload))
            else:
                fulfill(route, payload)
        elif path == "/api/annual":
            self.draft_queries.append(self.actor["id"] if self.actor else None)
            # Deliberately include both owners: UI must retain only the current owner.
            payload = {"drafts": deepcopy(SUMMARIES)}
            if self.hold_drafts:
                self.hold_drafts = False
                self.pending_drafts.append((route, payload))
            else:
                fulfill(route, payload)
        elif path == "/api/changes":
            fulfill(route, {"changes": []})
        elif path == "/api/trash":
            fulfill(route, {"events": []})
        else:
            fulfill(route, {"error": "Unexpected isolated API: " + path}, 404)
            errors.append("Unexpected isolated API: " + path)


def pump_until(page, predicate):
    deadline = time.monotonic() + 10
    while not predicate():
        assert time.monotonic() < deadline, "Timed out waiting for intercepted request"
        page.wait_for_timeout(25)


def session_changed(page):
    page.evaluate("window.dispatchEvent(new Event('yebom:session-changed'))")


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
                                args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1440, "height": 1100}, locale="ko-KR",
                                  service_workers="block")
    context.add_init_script("window.sessionChanges = 0; window.addEventListener('yebom:session-changed', () => window.sessionChanges++);")

    def new_page(mock):
        page = context.new_page()
        page.route("**/api/**", mock.intercept)
        page.on("pageerror", lambda error: errors.append(str(error)))
        return page

    for state, text in [("profile_incomplete", "프로필 작성을 완료"), ("not_approved", "계정 승인을 요청")]:
        mock = MockAPI(state=state)
        page = new_page(mock)
        page.goto(BASE + "/?year=2027&month=11&view=list")
        expect(page.get_by_text(text, exact=False)).to_be_visible()
        expect(page.locator(".agenda-event").filter(has_text="격리 공개 일정")).to_be_visible()
        expect(page.get_by_role("link", name="교적부 계정 확인", exact=True)).to_have_attribute("href", "https://saint.yebom.org/")
        checks.append(state + " 403 notice and fixed account link coexist with public calendar reads")
        if state == "profile_incomplete":
            before = mock.checkins
            page.evaluate("window.dispatchEvent(new Event('focus'))")
            page.wait_for_timeout(100)
            assert mock.checkins == before, "Ordinary focus must honor 60s throttle"
            mock.state = "authenticated"
            mock.actor = A
            page.evaluate("window.dispatchEvent(new Event('yebom:check-session'))")
            pump_until(page, lambda: mock.checkins > before)
            expect(page.get_by_text(text, exact=False)).to_have_count(0)
            page.wait_for_function("window.sessionChanges > 0")
            assert page.url.endswith("/?year=2027&month=11&view=list")
            checks.append("Explicit check-session bypasses throttle and emits session-changed without navigation")
        page.close()

    share_mock = MockAPI()
    share = new_page(share_mock)
    share.goto(BASE + "/share?year=2027&month=11&view=list")
    expect(share.locator(".agenda")).to_be_visible()
    share.evaluate("window.dispatchEvent(new Event('yebom:check-session')); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))")
    share.wait_for_timeout(150)
    assert share_mock.checkins == 0
    checks.append("Share registers no initial/focus/visibility/explicit checkin activity")
    share.close()

    mock = MockAPI(actor=A, state="authenticated")
    annual = new_page(mock)
    annual.goto(BASE + "/annual?year=2027&org=children")
    drafts = annual.locator(".annual-draft-list").first.locator(".annual-draft-item")
    expect(drafts).to_have_count(1)
    expect(drafts.first).to_contain_text("2행")
    annual.get_by_role("button", name="다음 일정 한 줄 추가", exact=True).click()
    row_name = annual.get_by_label("1행 일정 이름", exact=True)
    row_name.fill("계정이 바뀌어도 남을 미저장 입력")
    mock.hold_drafts = True
    session_changed(annual)
    pump_until(annual, lambda: bool(mock.pending_drafts))
    # Start B while the earlier A draft query is still in flight.
    mock.actor = B
    mock.hold_boot = True
    session_changed(annual)
    pump_until(annual, lambda: bool(mock.pending_boot))
    expect(drafts).to_have_count(0)
    expect(row_name).to_have_value("계정이 바뀌어도 남을 미저장 입력")
    fulfill(*mock.pending_boot.pop())
    expect(drafts).to_have_count(1)
    expect(drafts.first).to_contain_text("7행")
    expect(annual.locator(".signed-user")).to_contain_text(B["name"])
    fulfill(*mock.pending_drafts.pop())
    annual.wait_for_timeout(150)
    expect(drafts).to_have_count(1)
    expect(drafts.first).to_contain_text("7행")
    expect(row_name).to_have_value("계정이 바뀌어도 남을 미저장 입력")
    expect(annual.locator(".annual-toolbar")).to_contain_text("새 초안 (아직 서버 저장 전)")
    assert mock.draft_queries == [A["id"], A["id"], B["id"]], mock.draft_queries
    checks.append("A→B immediately clears summaries, fetches/filters B only, ignores late A query, preserves typed row and new-workspace metadata")
    annual.close()

    stale = MockAPI(actor=A, state="authenticated")
    stale.hold_boot = True
    initial = new_page(stale)
    initial.goto(BASE + "/annual?year=2027&org=children", wait_until="domcontentloaded")
    pump_until(initial, lambda: bool(stale.pending_boot))
    stale.actor = B
    session_changed(initial)
    initial_drafts = initial.locator(".annual-draft-list").first.locator(".annual-draft-item")
    expect(initial_drafts).to_have_count(1)
    expect(initial_drafts.first).to_contain_text("7행")
    fulfill(*stale.pending_boot.pop())
    initial.wait_for_timeout(150)
    expect(initial.locator(".signed-user")).to_contain_text(B["name"])
    expect(initial_drafts.first).to_contain_text("7행")
    assert stale.draft_queries == [B["id"]], stale.draft_queries
    checks.append("Late initial A bootstrap cannot overwrite B or start an obsolete A draft query")
    assert not mutations, mutations
    assert not errors, errors
    context.close()
    browser.close()

report = {"result": "pass", "checks": checks, "page_errors": errors,
          "database_test_writes": 0, "intercepted_request_count": len(requests_seen)}
Path("/tmp/yebom-sso-refresh-ui-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False, indent=2))
