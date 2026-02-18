# AI Automation Agencies Directory - Project Plan

## Niche Selected: AI Automation Agencies (Zapier/Make.com/n8n)

**Rationale:**
- High project value: $500-$10,000 per project
- Multiple platforms = multiple categories
- No standard directory exists
- Strong monetization: featured listings, lead gen, ads

## Milestones

### M1: Repo Scaffold
- [x] GitHub repo created
- [ ] Astro project initialized with TypeScript + Tailwind
- [ ] Basic folder structure
- [ ] GitHub Actions for CI/CD

### M2: Data Pipeline
- [ ] Create seed dataset (100+ listings in CSV)
- [ ] Data transformation pipeline (normalize, dedupe, slug)
- [ ] TypeScript interfaces for Listing type

### M3: Page Generation
- [ ] Homepage with search/filter
- [ ] Category pages: /zapier/, /make/, /n8n/
- [ ] Location pages: /usa/, /uk/, /india/
- [ ] Combined: /zapier/usa/
- [ ] Listing detail: /listing/[slug]

### M4: SEO Implementation
- [ ] sitemap.xml generation
- [ ] robots.txt
- [ ] Canonical URLs
- [ ] OpenGraph meta tags
- [ ] JSON-LD LocalBusiness schema
- [ ] Dynamic meta tags per page

### M5: Deploy
- [ ] Cloudflare Pages configuration
- [ ] GitHub Actions workflow for auto-deploy
- [ ] Custom domain setup (optional)

### M6: Monetization MVP
- [ ] "Claim Listing" form
- [ ] "Featured Placement" inquiry
- [ ] Newsletter signup placeholder

### M7: Analytics
- [ ] Plausible/GA placeholder
- [ ] Basic event tracking

---

## Tech Stack
- **Framework:** Astro (SSG)
- **Styling:** Tailwind CSS
- **Data:** CSV/JSON in /data
- **Deploy:** Cloudflare Pages
- **TypeScript:** Full type safety

## Expected Output
- 100+ seed listings
- Programmatic pages for all category/location combos
- SEO-optimized with schema markup
- Fast client-side search
- Monetization inquiry flow
