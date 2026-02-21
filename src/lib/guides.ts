export interface Guide {
  slug: string;
  title: string;
  summary: string;
  category: string;
  keywords: string[];
  bodyTitle: string;
  sections: Array<{
    heading: string;
    text: string;
  }>;
  relatedCategories: string[];
  featuredCountry?: string;
}

export const GUIDE_DATA: Guide[] = [
  {
    slug: 'automation-platforms-comparison',
    title: 'Zapier vs Make vs n8n Comparison (2026)',
    summary: 'Choose the right automation platform by team size, technical depth, budget, and scale.',
    category: 'strategy',
    keywords: ['zapier', 'make', 'n8n', 'comparison'],
    bodyTitle: 'Choose the right automation platform for your business',
    sections: [
      {
        heading: 'Which platform fits your workflow depth?',
        text: 'Zapier is strongest for fast startup onboarding. Make suits visual builders and complex automations. n8n gives stronger control and on-prem options for technical teams.',
      },
      {
        heading: 'Decision checklist',
        text: 'Start with 4 criteria: connector availability, pricing predictability, maintenance effort, and data/privacy requirements.',
      },
      {
        heading: 'Recommended next step',
        text: 'For each platform, shortlist 2–3 agencies with matching projects first, then compare implementation approach before pricing.',
      },
    ],
    relatedCategories: ['zapier', 'make', 'n8n'],
    featuredCountry: 'usa',
  },
  {
    slug: 'budget-planning-for-automation',
    title: 'Automation Budget Guide: $2k, $5k, $10k+',
    summary: 'A practical guide for agencies and SMEs to estimate project budget by scope and timeline.',
    category: 'pricing',
    keywords: ['budget', 'project planning', 'pricing'],
    bodyTitle: 'Set a realistic automation budget by expected scope',
    sections: [
      {
        heading: 'Core budget drivers',
        text: 'Expect a wide gap between simple trigger workflows and full process redesign. Integration count, data quality, and compliance requirements are key multipliers.',
      },
      {
        heading: 'Budget band signals',
        text: '$2k–$5k is common for small automations. $5k–$10k for multiple systems. $10k+ for enterprise process orchestration.',
      },
      {
        heading: 'How to reduce risk',
        text: 'Ask each agency for included deliverables, milestone checkpoints, and change request policy before signing.',
      },
    ],
    relatedCategories: ['zapier', 'make', 'n8n'],
  },
  {
    slug: 'hiring-automation-agencies-safely',
    title: 'How to Hire an Automation Agency Safely',
    summary: 'A practical due diligence list for contract scope, ownership, and quality checks.',
    category: 'hiring',
    keywords: ['agency hiring', 'due diligence', 'automation'],
    bodyTitle: 'Hire an automation agency with clear accountability',
    sections: [
      {
        heading: 'Checklist before onboarding',
        text: 'Confirm case studies, implementation process, and rollback behavior if the first rollout fails.',
      },
      {
        heading: 'Contract must-haves',
        text: 'SLA expectations, ownership of workflows, documentation format, and post-launch monitoring should be in writing.',
      },
      {
        heading: 'Safety signals',
        text: 'Verified contact info, transparent pricing, and willingness to provide a phased plan are strong quality indicators.',
      },
    ],
    relatedCategories: ['custom'],
    featuredCountry: 'germany',
  },
  {
    slug: 'internal-links-that-improve-directory-seo',
    title: 'Internal Linking for SEO in Directory Sites',
    summary: 'Use category/location matrix and lead CTAs to improve page relevance and CTR.',
    category: 'growth',
    keywords: ['seo', 'internal links', 'directory'],
    bodyTitle: 'Designing internal links for directory ranking gains',
    sections: [
      {
        heading: 'Page cluster design',
        text: 'Group pages by intent: category, location, and category+location pages should cross-link with clear anchors.',
      },
      {
        heading: 'Cross-linking rules',
        text: 'From each detail page, link to sibling pages and at least one strategic guide page.',
      },
      {
        heading: 'Conversion path',
        text: 'Place contact + claim CTAs in both top and bottom sections and keep listing filters visible on larger pages.',
      },
    ],
    relatedCategories: ['zapier'],
  },
  {
    slug: 'from-lead-to-project-checklist',
    title: 'From Lead Inquiry to Project Kickoff',
    summary: 'Convert submissions into productive briefs with a standardized project intake checklist.',
    category: 'operations',
    keywords: ['lead generation', 'inquiry', 'kickoff'],
    bodyTitle: 'Turn directory leads into qualified conversations',
    sections: [
      {
        heading: 'Immediate response',
        text: 'Confirm receipt within minutes and ask one qualification question in the same thread.',
      },
      {
        heading: 'Qualification stage',
        text: 'Capture platform, number of tools, expected ROI, and implementation window before deep scoping.',
      },
      {
        heading: 'Hand-off consistency',
        text: 'Use a fixed checklist and include deliverable expectations in the first response.',
      },
    ],
    relatedCategories: ['custom', 'make'],
  },
];

export const GUIDE_INDEX = GUIDE_DATA.map((guide) => ({
  slug: guide.slug,
  title: guide.title,
  summary: guide.summary,
  category: guide.category,
}));
