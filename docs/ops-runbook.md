# 운영 런북 (Phase 5 기반)

## 1) 배포 상태 확인

1. Cloudflare Pages 배포가 완료되면 먼저 다음을 확인합니다.
   - 사이트 오픈: `https://<your-domain>/`
   - robots: `https://<your-domain>/robots.txt`
   - sitemap: `https://<your-domain>/sitemap.xml`
   - 주요 페이지 404 점검: `/`, `/search`, `/zapier`, `/location/usa`, `/listing/{slug}`

## 2) API 헬스 체크

- 헬스: `GET /api/health`
  - 성공 응답(`ok: true, database: true`) 확인
  - DB 바인딩 미연결 시 `503`로 `database: false`

- 운영 메트릭: `GET /api/admin/metrics`
  - 헤더: `x-admin-key: <ADMIN_API_KEY>`
  - 반환값: `leads`, `ownershipRequests`, `events`

## 3) 리드/클레임 운영

- 리드 목록: `GET /api/admin/leads`
- 클레임 목록: `GET /api/admin/ownership-requests`
- 리드 상태 변경: `POST /api/admin/update-lead`
- 클레임 상태 변경: `POST /api/admin/update-ownership`

공통 요청 예시:

```bash
  curl -X POST "https://<your-domain>/api/admin/update-lead" \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{"id":"<lead-id>","status":"contacted"}'
```

## 3-1) 업체 등록 승인(Join) 운영

### 1. 환경변수/시크릿

- `PUBLIC_SITE_URL=https://automationagencydirectory.com`
- `TURNSTILE_SECRET_KEY`(선택)
- `ADMIN_API_KEY=admin-key` 를 Pages Secret으로 등록:
  ```bash
  echo "$ADMIN_API_KEY" | wrangler pages secret put ADMIN_API_KEY --project-name=dir-automation-agencies-01
  ```

### 2. 승인 절차

1. 신규 신청 수신:
   - `GET /api/admin/join-agencies?status=pending`
   - 헤더: `x-admin-key: $ADMIN_API_KEY`
2. 승인/거부:
   - 승인: `POST /api/admin/update-join`
   - 바디: `{"id":"<request-id>","status":"approved"}`
3. 즉시 확인:
   - 동일 id를 `/api/admin/join-agencies?status=approved&id=<id>`로 조회해 상태 전환 확인
4. 동기화 보정 단계 (필요 시):
   - 승인 응답에서 `slug` 추출 후 `GET /api/listings?slug=<slug>`로 노출 여부 확인
   - 응답에 `slug`가 비어 있거나 `join-agencies` 조회 기준값(`status=approved&id=<id>`)에서 `company_name`, `city` 기반 후보 slug를 생성해 fallback 재검증
   - 미반영 시 `POST /api/admin/update-join`를 한 번 더 호출해 재시도
   - 실패 패턴:
     - `200 + error`(권한/파싱): 즉시 조치 로그 확인
     - `200 + slug: ""`: 재처리 로그에서 fallback 후보 조회 및 `listings` 존재성 재확인
     - `5xx`: DB 바인딩 또는 SQL 실행 경로 점검(Cloudflare 로그)
5. 승인 완료 시:
   - `listings`에 verified 레코드가 생성/갱신됨(`verified=1`)
   - 승인된 slug는 `/listing/{slug}` 노출 대상이 됨

### 3. 권한 실패 대응

- `401` 응답이 오면 `x-admin-key` 누락/오입력 또는 Pages Secret 미배치 상태
- 응답이 계속 실패하면 Functions 로그에서 `ADMIN_API_KEY` 바인딩(Secret) 상태와 엔드포인트 배포 상태를 확인

### 3-2) 운영자 TUI 스크립트(권장)

- 파일: `scripts/admin-ops.sh`
- 실행:
  - `BASE_URL=https://automationagencydirectory.com ADMIN_API_KEY=<KEY> ./scripts/admin-ops.sh`
- 기능:
  - `1) 신규 신청 승인/거절`: `join` 대기 목록에서 항목을 골라 `update-join` 처리
  - `2) 기존 목록 verified 토글`: `/api/listings` 미검증 목록에서 `verified` 토글 (`/api/admin/listings`)
  - `3) approved 목록 listings 반영 점검/재처리`: `status=approved` 항목 대상으로 슬러그 존재성 확인 후 미반영 건을 재승인 1회 재호출

### 3-2-1) /join 신청 자동 승인(일일 크론)

- 대상: `GET /api/admin/join-agencies?status=pending`에서 `source_page`가 `/join` 계열인 항목
- 승인 조건:
  - `website` trim non-empty
  - `verification_evidence` trim non-empty
- 실행:
  - 매일 UTC 03:00 cron(`.github/workflows/auto-approve-joins.yml`)
  - `npm run approve:joins`
  - 드라이런: `npm run approve:joins:dry-run`
- 승인 엔드포인트:
  - `POST /api/admin/update-join` + `{ id, status: "approved" }`
- 재시도:
  - 최대 `3`회, 백오프 `300ms`, `600ms`, `1200ms`
- 실패 reason 분류:
  - `slugMissing` (slug 응답/파생 실패)
  - `listingNotFound` (DB 쓰기 실패 또는 미반영)
  - `retryableSyncLag` (즉시 조회에서 미반영)
  - `apiError` (네트워크/HTTP 오류)
- 출력:
  - 실행 요약: `total / evaluated / approved / skipped / failed`
  - reason별 집계 및 실패 항목의 `id`, `companyName`, `attempts`, `errorCode` 추적

### 3-3) D1 → 정적 데이터 동기화 (자동화)

- 수동:
  - `npm run sync:d1:listings`
  - `npm run sync-and-build`
  - `npm run sync-and-deploy` (동일 명령으로 동기화 + 빌드 + 배포)
- 자동:
  - `.github/workflows/sync-d1-listings.yml`를 통해 매일 00:00(KST) 1회 동기화
  - D1(`verified=1`)을 조회해 `data/listings.csv`를 재생성하고 빌드/배포 수행

### 3-4) 웹 파트너 후보 수집 배치

실행(Bing Web Search API 종료 대응 후, --source bing,duckduckgo에서 bing 우선, DDG 폴백):
  - `npm run collect:partners:dry-run -- --query-file data/partner-queries.sample.json --source bing,duckduckgo --verification-mode strict --min-score 45 --require-email`
  - 후보 검수 후 적재:
  - `npm run collect:partners:ingest -- --query-file data/partner-queries.sample.json --source bing,duckduckgo --append-to-listings --verification-mode strict --min-score 45 --require-email`
- 산출물:
  - `data/staging/partners_<YYYYMMDDHHmm>.csv` (적용 후보 CSV)
  - `data/staging/partners_<YYYYMMDDHHmm>.summary.json` (상태/점수/검수 로그)
- 기본 규칙:
  - 새 후보는 `source=public_api`, `verified=false`, `verification_method=api_match`
  - 중복 도메인/슬러그는 제외
  - 점수 미달/신호 미흡/이메일 미보유는 `pending_review` 또는 `rejected`
  - `accepted`만 자동 적재하고, 나머지는 수동 검토 큐 유지
- 운영 기준:
  - `--verification-mode strict`가 기본 (권장 `--min-score 45`, `--require-email`)
  - `summary.json`의 `qualityGate`를 확인해 `withEmail`, `validatedWebsite`, `blockedByDomain`, `avgVerificationScore`를 점검
  - `summary.json`의 `effectiveSources`와 `sourceErrors`를 확인해 실제 작동 소스를 점검

### 3-5) 파트너 메일링 실행

- dry-run:
  - `POST /api/admin/send-partner-mail`
  - body: `{"mode":"dry_run","sourceFile":"partners_YYYYMMDDHHMMSSsss.csv","campaignKey":"mail_20260225"}`
- 실제 발송:
  - 동일 요청에서 `mode`를 `send`로 변경
- 참고: `sourceFile` 모드는 Node 런타임에서만 처리되며, 운영 Pages 환경에서는 `candidates` 배열을 함께 전달해 발송 실행을 권장합니다.
- 확인 항목:
  - `sendSummary.total`, `sendSummary.accepted`, `sendSummary.alreadySent`, `sendSummary.queued`, `sendSummary.sent`, `sendSummary.failed`, `sendSummary.skippedInvalidEmail`
- 운영 제약:
  - `alreadySent`가 높으면 대상 재발송 가능성 낮음
  - `failed` 급증 시 OAuth 토큰/쿼터/도메인 제한 확인

### 3-6) 파트너 메일링 자동화(주기 크론)

- 실행 명령(로컬): `npm run send:vendors -- --base-url https://automationagencydirectory.com --admin-key <ADMIN_API_KEY>`
- 주간/일일 운영:
  - `.github/workflows/send-vendors-cron.yml`에서 매일 UTC 02:00에 `data/vendor-list-master.csv` 기준 자동 전송
  - 이미 발송 이력이 있으면 `/api/admin/send-partner-mail`의 내부 dedupe(`email_send_log`)로 `alreadySent` 처리되어 중복 발송이 차단됨
- 실패 대응:
  - 워크플로 로그에서 `send API failed` 또는 HTTP 4xx/5xx 발생 시, ADMIN_API_KEY/권한 확인 후 배포 URL(`/api/admin/send-partner-mail`) 재시도

## 4) 이벤트 추적

- 폼/CTA/클릭 추적: `POST /api/events`
- 이벤트 수집 실패가 발생해도 사용자 흐름에는 영향을 주지 않도록 비차단 방식으로 처리됨.

## 5) 장애 대응 우선순위

1. `api/health` 실패: Cloudflare Pages Functions 로그 확인
2. 5xx 증가: 최근 코드 배포/DB 스키마 변경 이력 확인
3. 폼 저장 실패 급증: `api/admin/metrics`와 `api/events` 상태 확인 후 DB 바인딩 점검
4. 404 급증: 최근 콘텐츠 배포 전/후 페이지 수 비교(검색된 페이지 수, 라우트 프리셋)

## 7) 알림 채널 정책 (Slack 전용)

- 목표: GitHub Actions, Cloudflare, Vercel의 배포/실패 알림을 **Slack만** 수신하고, Email 알림은 비활성화

### A. GitHub Actions (이 저장소)
- 워크플로 `.github/workflows/deploy-cloudflare-pages.yml`  
- 워크플로 `.github/workflows/sync-d1-listings.yml`
- 각 완료 이벤트(`always()`)에서 `SLACK_WEBHOOK_URL` 존재 시 Slack으로 결과 전송
- Repository Settings > Notifications(또는 조직/계정 알림)에서:
  - Email 알림 체크를 비활성화
  - Slack만 남김
  - 팀 단위 알림 정책을 우선 적용하면 개인 설정과 충돌 없이 일괄 관리 가능

- 필요 시 수동 테스트:
  - GitHub Secrets에 `SLACK_WEBHOOK_URL` 등록
  - `workflow_dispatch` 또는 `main` push로 워크플로 한 번 실행해 Slack 도착 확인

### B. Cloudflare Pages 알림
- Pages/Workers → Project Settings → Notifications(또는 프로젝트 알림 설정)
- Email 대상 채널 비활성화
- Slack Incoming Webhook/워크스페이스 연결(또는 Cloudflare가 제공하는 Slack 채널 연동 방식)
- 플랫폼 기본 알림은 비활성(또는 최소), 이 저장소는 GitHub Actions 알림을 주 채널로 사용

### C. Vercel 알림
- Vercel Dashboard → Project Settings → Integrations/Notifications
- Email 알림 off, Slack integration on
- 현재 배포는 Cloudflare Pages 중심이므로 Vercel은 보조 파이프라인으로만 운영 시 채널 정책 문서에 맞춰 비활성 권장

## 8) Phase 5 운영 점검 루틴

### 월 1회: 인덱싱/운영 정합성
- Cloudflare Pages 배포 상태 점검 (`Deployments`)
- `sitemap.xml`과 `robots.txt` 접근 확인
- 주요 페이지 1개 페이지 그룹(홈/카테고리/지역/조합/리스팅) 수동 접근 테스트
- Search Console 제출 상태(제외/누락 URL) 체크

### 주 2회: 리드 파이프라인 상태
- `/api/admin/leads?status=new`
- `/api/admin/ownership-requests?status=pending`
- `/api/admin/metrics?eventWindowMinutes=60`
- 신규 문의/클레임 지연 12시간 이상 여부 확인

### 일 1회: 보안/안전성
- `/api/health` 응답 상태(`ok: true`)
- 1시간 단위 폼 전송 실패율이 1% 이상이면 Turnstile/폼 검증 로그 원인 확인
- `/api/events` 5xx 발생 시 페이지 클릭/CTA 추적 임시 중단 플래그 검토
- 공개 폼은 `x-admin-key` 없이 admin endpoint 접근 실패 확인
