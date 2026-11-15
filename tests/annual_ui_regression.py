"""Focused regressions for confirmed annual-plan wiring defects.
All /api requests are intercepted in memory; no fake login or managed DB write.
Run with pnpm dev: python3 tests/annual_ui_regression.py
"""
import json
import os
import subprocess
from copy import deepcopy
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('UI_TEST_ORIGIN', 'http://127.0.0.1:3000')
ACTOR = {'id':'isolated-annual-ui','name':'격리 연간 검사','role':'editor','departmentIds':['children','youth']}
SETTINGS = json.loads(subprocess.check_output(['pnpm','exec','tsx','-e','import {DEFAULT_CHURCH_SETTINGS} from "./src/domain/church-year"; console.log(JSON.stringify(DEFAULT_CHURCH_SETTINGS));'],text=True))
DRAFTS, EVENTS = {}, {}
errors, checks, requests_seen = [], [], []
create_loss = True


def summary(draft):
    out={k:draft[k] for k in ['id','version','ownerId','year','organizationId','createdAt','updatedAt']}
    return dict(out,rowCount=len(draft['rows']),publishedCount=len(draft['publishedRowIds']))


def intercept(route, request):
    global create_loss
    path=urlparse(request.url).path
    method=request.method
    body=request.post_data_json if method!='GET' else None
    requests_seen.append({'path':path,'method':method})
    status=200
    if path=='/api/bootstrap':
        payload={'events':list(EVENTS.values()),'upcoming':[],'actor':ACTOR,'venues':[],'settings':SETTINGS,
                 'auth':{'configured':True,'onSharedDomain':False,'loginUrl':None,'message':'격리 API 응답'}}
    elif path=='/api/auth/checkin':payload={'authenticated':True,'state':'authenticated','identity':{'id':ACTOR['id'],'name':ACTOR['name']},'profileCompletionRequired':False,'passwordResetRequired':False,'profileMissingFields':[],'message':'격리 응답'}
    elif path=='/api/annual' and method=='GET':
        payload={'drafts':[summary(d) for d in DRAFTS.values()]}
    elif path=='/api/annual' and method=='POST':
        if body['id'] in DRAFTS:
            status=409
            payload={'error':'격리 검사: 생성 ID의 기존 입력과 다릅니다.','code':'ANNUAL_ID_CONFLICT'}
        else:
            draft=dict(deepcopy(body['input']),id=body['id'],version=1,ownerId=ACTOR['id'],
                       createdAt='2026-11-15T00:00:00.000Z',updatedAt='2026-11-15T00:00:00.000Z',publishedRowIds=[])
            DRAFTS[body['id']]=draft
            if create_loss:
                create_loss=False;status=503
                payload={'error':'격리 검사: 생성 후 응답이 유실됐어요.','code':'ISOLATED_LOSS'}
            else:payload={'draft':deepcopy(draft)}
    elif path.startswith('/api/annual/'):
        ident=path.split('/')[3]
        draft=DRAFTS[ident]
        if path.endswith('/publish'):
            for row in draft['rows']:
                if row['id'] not in body['rowIds']:continue
                event=deepcopy(row['input'])
                event.update(id=row['id'],version=1,createdAt='2026-11-15T00:00:00.000Z',createdBy={'id':ACTOR['id'],'name':ACTOR['name']},
                             updatedAt=None,updatedBy=None,deleted=False,cancelReason='',exceptions=[])
                EVENTS[row['id']]=event
            draft['publishedRowIds']=list(dict.fromkeys(draft['publishedRowIds']+body['rowIds']))
            draft['version']+=1
            payload={'draft':deepcopy(draft),'events':[EVENTS[i] for i in body['rowIds']],'warnings':[]}
        elif method=='PUT':
            draft.update(deepcopy(body['input']));draft['version']+=1
            payload={'draft':deepcopy(draft)}
        else:payload={'draft':deepcopy(draft)}
    elif path.startswith('/api/events/'):
        payload={'event':deepcopy(EVENTS[path.split('/')[3]]),'history':[]}
    elif path=='/api/changes':payload={'changes':[]}
    elif path=='/api/trash':payload={'events':[]}
    else:
        raise AssertionError('Unexpected isolated API path: '+path)
    route.fulfill(status=status,content_type='application/json',body=json.dumps(payload,ensure_ascii=False))


with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1100},locale='ko-KR')
    page.route('**/api/**',intercept)
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(BASE+'/annual?year=2027&org=children')
    page.get_by_role('button',name='다음 일정 한 줄 추가',exact=True).wait_for()
    expect(page.get_by_label('새 행의 입력 부서',exact=False)).to_have_value('children')
    page.get_by_role('button',name='다음 일정 한 줄 추가',exact=True).click()
    page.get_by_label('1행 날짜 표현',exact=True).fill('10/10부터 계속 수요일8시')
    page.get_by_label('1행 일정 이름',exact=True).fill('격리 검사 계속 모임')
    page.get_by_role('button',name='추가 설정',exact=True).first.click()
    dialog=page.get_by_role('dialog')
    dialog.get_by_role('spinbutton').first.fill('2')
    dialog.get_by_role('button',name='이 행에 적용',exact=True).click()
    assert '시' in page.get_by_label('1행 날짜 표현',exact=True).input_value()
    assert '오전' in page.locator('.annual-row-errors').first.inner_text()
    checks.append('반복 간격만 바꿔도 모호한 8시 확인을 우회하지 않음')
    page.get_by_label('1행 시작 시간',exact=True).fill('20:00')
    page.get_by_label('1행 종료 시간',exact=True).fill('21:00')
    page.get_by_label('시작 시각(오전/오후)을 확인했어요',exact=True).check()
    assert '20:00' in page.locator('.annual-preview').first.inner_text()
    assert page.locator('.annual-row-errors').count()==0
    checks.append('실제 오후20:00 선택·확인 후 문구가 시간 선택을 덮어쓰지 않음')

    page.get_by_role('button',name='초안 저장',exact=True).click()
    page.locator('.alert.error').filter(has_text='격리 검사: 생성 후 응답이 유실됐어요.').first.wait_for()
    assert page.get_by_label('1행 일정 이름',exact=True).input_value()=='격리 검사 계속 모임'
    page.get_by_label('1행 일정 이름',exact=True).fill('격리 검사 변경한 이름')
    page.get_by_role('button',name='초안 저장',exact=True).click()
    page.get_by_role('dialog').get_by_role('button',name='최신 서버 초안 확인',exact=True).click()
    page.get_by_role('dialog').get_by_text('서버 최신 개정 1',exact=True).wait_for()
    assert any(r['method']=='GET' and r['path'].startswith('/api/annual/') for r in requests_seen)
    page.get_by_role('dialog').get_by_role('button',name='미등록 입력을 새 초안으로 저장',exact=True).click()
    page.get_by_role('dialog').wait_for(state='hidden')
    assert page.get_by_label('1행 일정 이름',exact=True).input_value()=='격리 검사 변경한 이름'
    checks.append('초안 생성 응답 유실·수정 재시도 충돌도 creationId로 최신본 조회, 내 입력 보존')

    page.get_by_role('button',name='저장 후 등록 검토',exact=True).click()
    review=page.get_by_role('dialog')
    # The final confirmation button deliberately states a count.
    review.get_by_role('checkbox').last.check()
    review.get_by_role('button',name='등록',exact=False).last.click()
    page.get_by_role('dialog').wait_for(state='hidden')
    origin_link=page.get_by_role('link',name='원본 일정',exact=False).first
    origin_link.wait_for()
    href=origin_link.get_attribute('href')
    assert 'event=' in href and len(EVENTS)==1
    detail=browser.new_page(viewport={'width':1440,'height':1100},locale='ko-KR')
    detail.route('**/api/**',intercept)
    detail.on('pageerror',lambda error:errors.append(str(error)))
    detail.goto(BASE+href)
    detail.get_by_role('dialog').get_by_text('일정 자세히 보기',exact=True).wait_for()
    detail.get_by_role('dialog').get_by_text('격리 검사 변경한 이름',exact=True).wait_for()
    detail.get_by_text('2027-10-10부터 계속 반복',exact=False).wait_for()
    checks.append('등록 행 원본 링크 → 실제 상세, 현재 회차가 아닌 최초 반복 범위 표시')

    mobile=browser.new_page(viewport={'width':390,'height':844},locale='ko-KR',is_mobile=True,has_touch=True)
    mobile.route('**/api/**',intercept)
    mobile.on('pageerror',lambda error:errors.append(str(error)))
    mobile.goto(BASE+'/annual?year=2027&org=children')
    mobile.get_by_role('button',name='다음 일정 한 줄 추가',exact=True).click()
    mobile.get_by_label('1행 날짜 표현',exact=True).fill('7월')
    mobile.get_by_label('1행 일정 이름',exact=True).fill('격리 검사 날짜 미정 계획')
    mobile.get_by_role('button',name='저장하고 다음 일정',exact=True).first.click()
    mobile.get_by_label('2행 날짜 표현',exact=True).wait_for()
    assert mobile.get_by_label('1행 날짜 표현',exact=True).input_value()=='7월'
    assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert len(EVENTS)==1
    checks.append('모바일 큰 카드·저장하고 다음 일정은 서버 초안만 저장, 날짜 미정은 행사 미생성')
    assert not errors,errors
    browser.close()
report={'result':'pass','checks':checks,'page_errors':errors,'database_test_writes':0,'intercepted_request_count':len(requests_seen)}
Path('/tmp/yebom-annual-ui-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
