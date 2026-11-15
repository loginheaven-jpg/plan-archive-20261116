# Railway 운영 배포

앱은 독립된 Railway 프로젝트의 웹 서비스와 전용 MySQL 8.4로 구성한다. MySQL에는 `/var/lib/mysql` 영구 볼륨을 연결하고 앱은 Railway 내부 네트워크로 접속한다. 운영 DB의 외부 공개 포트는 필요하지 않다.

## 웹 서비스

`Dockerfile`과 `railway.json`을 사용한다. 이미지에는 Next.js standalone 서버, 정적 파일, SQL 이력과 독립 실행 가능한 `scripts/migrate.cjs`가 포함된다. 빌드는 고정 pnpm과 frozen lockfile을 사용하며 마이그레이션 번들에는 필요한 드라이버를 포함한다.

Railway의 배포 전 작업은 `node scripts/migrate.cjs`다. 빈 DB에 스키마와 기본 설정만 준비하며 실제 일정·사용자·장소를 생성하지 않는다. 재실행하면 적용 이력·checksum을 확인하고 데이터를 보존한다. 앱 시작마다 초기화하거나 seed하지 않는다. `/api/health`의 200 응답을 받은 배포만 기동 완료로 처리한다.

서버 환경 설정:

| 이름 | 설정 |
| --- | --- |
| `DATABASE_URL` | 전용 MySQL의 내부 연결 URL. Railway 서비스 변수 참조로 연결하고 소스에 비밀값을 기록하지 않는다. |
| `APP_PUBLIC_ORIGIN` | `https://plan.yebom.org` |
| `PORT` | `3000` |
| `YEBOM_CALENDAR_ADMIN_IDS` | 최초 일정관리자의 검증된 실제 교적부 사용자 ID. 미지정 시 새 로그인 사용자는 조회자다. |

교적부의 봉인키를 복사하지 않는다. 공식 교적부 세션 API로 확인하며 실제 편집 권한은 일정 앱에서 별도로 관리한다. Railway 임시 주소는 공개 화면·DB 준비 확인용이고, 공유 SSO 검증은 `.yebom.org` 운영 주소에서 수행한다.

## 배포와 도메인 전환

해당 프로젝트에 접근 가능한 `RAILWAY_TOKEN`을 보안 환경 설정으로 주입한 셸에서 실행한다. 토큰은 배포 도구 전용이며 앱 컨테이너 변수로 전달하지 않는다.

```sh
railway up --project "$RAILWAY_PROJECT_ID" --service plan-web --environment production --detach
```

업로드 성공과 운영 기동 성공은 구분한다. Railway의 최종 배포 상태, `/api/health`, 공개 bootstrap, ICS 응답을 확인한다. 실제 일정이나 가상 사용자를 시험 등록하지 않는다.

Railway에 `plan.yebom.org` 사용자 도메인을 연결하고 발급된 CNAME 대상·인증 레코드를 확인한다. DNS 관리 화면에서 `plan` 레코드를 그 대상으로 전환한다. DNS 전파와 HTTPS 인증서가 준비되면 운영 origin 인식, 공통 로그인 진입과 원래 화면 복귀를 확인한다. 기존 서비스를 내리기 전에 새 운영 주소의 검증을 마친다.

2026-11-16 사용자는 현재 일정 데이터가 없으며 백업·데이터 복사 없이 새 DB로 구성하도록 지시했다. 배포별 실제 프로젝트·도메인·검증 결과는 별도 운영 기록에 남긴다.
