# Phase 5 완료 체크리스트 (운영 안정화 & 리스크 완화)

## 1) 모니터링 (주 1~2회)
- [ ] `/api/health`가 `ok: true`인지 확인
- [ ] `/api/admin/metrics`의 500/429 비율이 급증하지 않는지 확인
- [ ] `eventWindowMinutes=60` 기준 `events.search`/`cta_click`/`listing_view`의 체감이 비정상적으로 0으로 떨어지지 않는지 확인
- [ ] Cloudflare Pages 배포 로그에서 최근 빌드 실패/롤백 여부 확인

## 2) 품질 (매 배포 직후)
- [ ] `/sitemap.xml`이 404 없이 내려오는지 확인
- [ ] `/robots.txt` 내 `Sitemap:` URL과 실제 사이트 도메인이 일치
- [ ] `/location/<slug>`와 `/<category>/<slug>` 200 응답 샘플 10개 확인
- [ ] 랜딩/리스트/리스팅 페이지의 주요 CTA 링크가 404가 아닌지 점검

## 3) 리드 운영
- [ ] `/api/admin/leads?status=new` 주간 신규 증가 추이 확인
- [ ] `/api/admin/ownership-requests?status=pending` 처리 기한(72시간) 초과 항목 처리
- [ ] 리드 저장 실패(클라이언트 재시도율) 상승 원인 분석: Turnstile, origin 검증, DB 바인딩

## 4) 보안/안전
- [ ] `x-admin-key` 노출 여부 확인 (클라이언트 페이지에 하드코딩 금지)
- [ ] admin endpoint 응답에서 상세 DB/시스템 오류 메시지 노출 최소화
- [ ] 공개 폼(`POST /api/contact`, `POST /api/claim`)의 요청 origin/referer 정책 검토
- [ ] 입력값 길이 제한 및 이메일 형식 검사 유지(스키마 변경 시 재점검)

## 5) 성능
- [ ] 정적 페이지 핵심 지표(히어로/탑 30개 페이지) 스냅샷 측정
- [ ] 과도한 third-party 스크립트(추가 광고/추적)가 LCP/CLS를 악화하지 않도록 배치 유지
- [ ] 페이지 이미지/OG 이미지를 제외한 외부 리소스 호출 최소화

## 6) 롤백 절차
- [ ] 장애 발생 시 `CLOUDFLARE` Pages 이전 배포로 1회복구 가능한지 확인
- [ ] DB 스키마 변경 시 D1 마이그레이션 파일 버전 관리
- [ ] 환경변수 변경 시 재배포 후 health/metrics 연쇄 확인
