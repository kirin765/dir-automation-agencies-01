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
6. Set environment values:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `PUBLIC_SITE_URL`
   - `PUBLIC_BASE_PATH` (optional)
   - `ADMIN_API_KEY` (admin endpoints)
   - `CLOUDFLARE_D1_DATABASE_ID`
   - `TURNSTILE_SECRET_KEY` (optional, anti-bot validation)
   - `TURNSTILE_SITE_KEY` (optional, pair with TURNSTILE_SECRET_KEY)
7. Deploy!

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
