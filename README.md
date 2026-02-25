# AI Automation Agencies Directory

A production-ready, SEO-focused directory website for AI automation agencies and experts (Zapier, Make.com, n8n).

## 🚀 Live Site

**URL:** https://automationagencydirectory.com
**Deployment URL:** Set `PUBLIC_SITE_URL` in Cloudflare deployment environment.

## 📋 Features

- **105+ Seed Listings** with real agency data
- **Platform Categories:** Zapier, Make.com, n8n, Custom Solutions
- **Location Pages:** USA, UK, Germany, India, Australia, and 40+ countries
- **Programmatic SEO Pages:**
  - `/[category]/` - Category pages (e.g., /zapier, /make, /n8n)
  - `/location/[location]` - Location pages (e.g., /location/usa, /location/uk)
  - `/[category]/[location]` - Category + country matrix pages (e.g., /zapier/usa)
  - `/listing/[slug]` - Individual listing pages
- **Fast Client-Side Search** with filters
- **SEO Optimized:**
  - sitemap.xml
  - robots.txt
  - Canonical URLs
  - OpenGraph meta tags
  - JSON-LD Schema (ProfessionalService, LocalBusiness)
- **Monetization MVP:**
  - Claim Listing form
  - Featured Placement inquiry

## 🛠️ Tech Stack

- **Framework:** Astro 4.x (Static Site Generation)
- **Styling:** Tailwind CSS
- **Data:** CSV → JSON transformation at build time
- **TypeScript:** Full type safety
- **Deploy:** Cloudflare Pages

## 📁 Project Structure

```
/
├── data/
│   ├── listings.csv          # Raw seed data (105 listings)
│   └── processed.json        # Transformed data (generated)
├── src/
│   ├── components/           # Astro components
│   │   ├── Header.astro
│   │   └── Footer.astro
│   ├── layouts/
│   │   └── Layout.astro      # Base layout with SEO
│   ├── pages/
│   │   ├── index.astro           # Homepage
│   │   ├── search.astro          # Search page
│   │   ├── claim.astro           # Claim listing form
│   │   ├── featured.astro        # Featured placement
│   │   ├── [category].astro      # Category pages
│   │   ├── [location].astro      # Location pages
│   │   ├── [category]/[location].astro # Category + location pages
│   │   ├── listing/[slug].astro
│   │   ├── sitemap.xml.ts
│   │   └── robots.txt.ts
├── scripts/
│   └── process-data.ts      # Data pipeline
├── functions/
│   ├── api/
│   │   ├── contact.ts
│   │   ├── claim.ts
│   │   ├── listings.ts
│   │   ├── admin/
│   │   │   ├── leads.ts
│   │   │   └── ownership-requests.ts
│   │   └── sitemap-refresh.ts
│   └── api/_shared/           # Shared validation/storage helpers
│       ├── validation.ts
│       └── storage.ts
├── docs/
│   └── d1-schema.sql           # D1 schema
├── public/
│   ├── favicon.svg
│   └── og-image.png
├── .github/workflows/
│   └── deploy-cloudflare-pages.yml  # CI/CD to Cloudflare Pages
├── astro.config.mjs
├── tailwind.config.mjs
└── package.json
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
# Clone the repo
git clone https://github.com/kirin765/dir-automation-agencies-01.git
cd dir-automation-agencies-01

# Install dependencies
npm install
```

### Development

```bash
npm run dev
```

Visit http://localhost:4321

### Build

```bash
npm run build
```

Output will be in the `dist/` directory.

### Preview

```bash
npm run preview
```

## 📊 Data Management

### Adding New Listings

1. Edit `data/listings.csv`
2. Add a new row with the following columns:

```csv
id,name,platforms,location,country,description,price_min,price_max,rating,review_count,featured,website,email
```

3. Rebuild the site:

```bash
npm run build
```

### Automated Partner Candidate Collection (Web Discovery)

Use `collect:partners` to generate partner candidates from public web discovery before manual review.

1. Prepare query templates: `data/partner-queries.sample.json` (edit/copy as needed).
2. Run discovery (dry run first):

```bash
npm run collect:partners:dry-run -- --source bing --query-file data/partner-queries.sample.json --verification-mode strict --min-score 45 --require-email
```

3. Inspect generated staging files:

```bash
ls data/staging/partners_*
```

4. Exporting rules

- `accepted`: 즉시 메일링용 추출 대상
  - 조건: `email` 존재, `website` 접근 정상, 업체 신호(컨택트/소개/서비스/워크/자동화) 1개 이상, 최소 점수 통과
- `pending_review`: 초기 자동 검수에서 제외하고 사후 수동 검토 필요
  - 예: 이메일은 존재하나 신호 부족, 사이트 접근성 미흡, 점수 미달
- `rejected`: 이메일 미보유/형식 오류, 중복 도메인/슬러그, 필수정보 누락

4. Merge accepted candidates into `data/listings.csv`:

```bash
npm run collect:partners:ingest -- --source bing --append-to-listings --query-file data/partner-queries.sample.json --verification-mode strict --min-score 45 --require-email
```

### 파트너 메일링 발송(accepted 기반)

1. 드라이런 후 생성된 `data/staging/partners_*.csv`에서 `verification_status=accepted`만 선별 발송 대상으로 사용합니다.
2. 관리자 API를 통해 dry-run 또는 실제 발송을 실행:

```bash
curl -X POST https://<your-domain>/api/admin/send-partner-mail \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{"mode":"dry_run","sourceFile":"partners_202602250847.csv","campaignKey":"campaign_2026_02"}'
```

- 참고: `sourceFile` 모드는 런타임이 Node 기반으로 실행되는 환경에서만 동작합니다.
- Pages/Workers 운영에서는 `candidates` 배열 입력으로 즉시 발송 대상을 전달하는 방식이 안전합니다.

3. 실발송:

```bash
curl -X POST https://<your-domain>/api/admin/send-partner-mail \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{"mode":"send","sourceFile":"partners_202602250847.csv","campaignKey":"campaign_2026_02"}'
```

- 운영 권장: `candidates`로 전달한 동일 배치 내 중복(`email`/`website`)은 API 레이어에서 1회로 축소되어 중복 발송을 방지합니다.

4. 응답의 `sendSummary` 항목(`alreadySent`, `queued`, `sent`, `failed`, `skippedInvalidEmail`)으로 결과 확인.

Notes:
- Candidates are written as `source=public_api`, `verified=false`, `verification_method=api_match`.
- `data/listings.csv` 노출 규칙은 기존 그대로 유지되어, `verified=true` 또는 `seed_generated`만 노출됩니다.
- 기본 검증은 중복, 도메인 유효성, 플랫폼 키워드 매칭, 휴리스틱 점수 + `email` 중심 신뢰 신호 기준으로 수행됩니다.
- `collect:partners:dry-run -- --max-results 50 --min-score 45 --verification-mode strict`는 검증된 후보 비율을 빠르게 점검하는 용도로 사용합니다.

### Data Fields

| Field | Type | Description |
|-------|------|-------------|
| id | number | Unique identifier |
| name | string | Agency name |
| platforms | string | Comma-separated (zapier,make,n8n) |
| location | string | City name |
| country | string | Country name |
| description | string | Agency description |
| price_min | number | Minimum project price ($) |
| price_max | number | Maximum project price ($) |
| rating | number | Average rating (0-5) |
| review_count | number | Number of reviews |
| featured | boolean | Featured listing (true/false) |
| website | string | Agency website URL |
| email | string | Contact email |

### Data Processing

The `scripts/process-data.ts` script:
- Normalizes platform names
- Creates URL-friendly slugs
- Deduplicates entries
- Validates data

## 🌐 Deployment

### Cloudflare Pages (Recommended)

1. Fork this repo
2. Go to Cloudflare Dashboard → Pages
3. Connect to GitHub
4. Select the repo
5. Build settings:
   - Build command: `npm run build`
   - Build output directory: `dist`
6. Leave "Deploy command" empty (this is a Pages project, do **not** use `wrangler deploy`).
7. Set environment values:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `PUBLIC_SITE_URL`
   - `PUBLIC_BASE_PATH` (optional)
   - `ADMIN_API_KEY` (admin endpoints)
   - `CLOUDFLARE_D1_DATABASE_ID`
   - `TURNSTILE_SECRET_KEY` (optional, anti-bot validation)
   - `TURNSTILE_SITE_KEY` (optional, pair with TURNSTILE_SECRET_KEY)
   - `BRAVE_WEB_SEARCH_API_KEY` (required for `collect:partners --source bing` after Bing retirement migration)
   - `BRAVE_WEB_SEARCH_ENDPOINT` (optional, default `https://api.search.brave.com/res/v1/web/search`)
   - `BRAVE_WEB_SEARCH_COUNTRY` (optional, default `us`)
   - `BRAVE_WEB_SEARCH_SAFE_SEARCH` (optional, default `strict`)
   - `BING_WEB_SEARCH_SAFE_SEARCH` is no longer used; keep `BRAVE_WEB_SEARCH_SAFE_SEARCH` for this pipeline
   - `GMAIL_CLIENT_ID` (OAuth2 Client ID)
   - `GMAIL_CLIENT_SECRET` (OAuth2 Client Secret)
   - `GMAIL_REFRESH_TOKEN` (OAuth2 Refresh Token)
   - `GMAIL_USER_EMAIL` (Gmail sender address)
   - `GMAIL_FROM_NAME` (optional display name)
   - `GMAIL_RATE_LIMIT_PER_MIN` (optional, default `120`)
8. Deploy!

If you deploy from CLI instead, use:

```bash
npm run deploy:pages
```

`npm run deploy:pages` is equivalent to:

```bash
npx wrangler pages deploy dist --project-name=dir-automation-agencies-01
```

### API behavior (Cloudflare Pages Functions)

- `/api/contact` (POST): write into `lead_submissions`
- `/api/claim` (POST): write into `ownership_requests`
- `/api/listings` (GET): optional listing feed with query filters
- `/api/admin/leads` (GET): admin-only list of leads using `x-admin-key`
- `/api/admin/ownership-requests` (GET): admin-only list using `x-admin-key`
- `/api/admin/update-lead` (POST): admin-only update lead status (`new|contacted|closed`)
- `/api/admin/update-ownership` (POST): admin-only update ownership request status (`pending|approved|rejected`)
- `/api/admin/listings` (POST): admin-only update listing flags (`featured`, `verified`, `featuredUntil`)
- `/api/admin/metrics` (GET): admin-only dashboard counters for lead/ownership/events
- `/api/events` (POST): internal behavior tracking endpoint (`listing_view`, `cta_click`, etc.)
- `/api/health` (GET): basic operational health and database status

### Vercel (Alternative)

```bash
npm i -g vercel
vercel
```

## 💰 Monetization

### Current MVP Features

1. **Claim Listing** - Free basic listing for agencies
2. **Featured Placement** - Paid premium placement
   - Basic: $29/month
   - Featured: $49/month
   - Premium: $99/month

### Future Ideas

- **Lead Generation** - $10-50 per qualified lead
- **Banner Ads** - $199-499/month
- **Newsletter Sponsorship** - $500/month
- **API Access** - $99/month for data access

## 📈 Analytics

Currently includes placeholder for:
- Google Analytics
- Plausible Analytics
- Custom event tracking

## 🧰 Operations

Runbook: [docs/ops-runbook.md](docs/ops-runbook.md)
Phase 5 운영 체크리스트: [docs/phase5-completion-checklist.md](docs/phase5-completion-checklist.md)

## 🔧 Maintenance

### Update Listings

1. Edit CSV
2. Rebuild
3. Deploy

### Add New Categories

1. Add platform to CSV data
2. The category page `/[category].astro` will auto-generate

### Add New Locations

1. Add location to CSV data
2. `/location/{slug}` and `/{category}/{slug}` pages auto-generate

## 📄 License

MIT License

## 🙏 Credits

Built with [Astro](https://astro.build) and [Tailwind CSS](https://tailwindcss.com)
