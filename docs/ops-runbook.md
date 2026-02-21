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

## 4) 이벤트 추적

- 폼/CTA/클릭 추적: `POST /api/events`
- 이벤트 수집 실패가 발생해도 사용자 흐름에는 영향을 주지 않도록 비차단 방식으로 처리됨.

## 5) 장애 대응 우선순위

1. `api/health` 실패: Cloudflare Pages Functions 로그 확인
2. 5xx 증가: 최근 코드 배포/DB 스키마 변경 이력 확인
3. 폼 저장 실패 급증: `api/admin/metrics`와 `api/events` 상태 확인 후 DB 바인딩 점검
4. 404 급증: 최근 콘텐츠 배포 전/후 페이지 수 비교(검색된 페이지 수, 라우트 프리셋)

## 6) Phase 5 운영 점검 루틴

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
