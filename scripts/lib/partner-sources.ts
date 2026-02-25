import { URL } from 'node:url';

export interface SearchQuery {
  query: string;
  country?: string;
  platforms?: string[];
}

export interface VerificationSignals {
  websiteOk: boolean;
  websiteStatus: string;
  websiteStatusCode?: number;
  contactSignal: boolean;
  aboutSignal: boolean;
  automationSignal: boolean;
  servicesSignal: boolean;
  workSignal: boolean;
  socialSignal: boolean;
  mailtoSignal: boolean;
  emailFromSource: boolean;
}

export interface CandidateRaw {
  source: string;
  discoveredName: string;
  discoveredWebsite: string;
  sourceRef: string;
  snippet?: string;
  location?: string;
  country?: string;
  platforms?: string[];
  email?: string;
  query?: SearchQuery;
  verificationSignals?: VerificationSignals;
  discoveryFlags?: {
    blockedBySource?: boolean;
    rejectionReasons?: string[];
  };
}

export interface SourceAdapter {
  key: string;
  displayName: string;
  discover(query: SearchQuery, options: { maxResults: number }): Promise<CandidateRaw[]>;
  fetchDetails(candidate: CandidateRaw): Promise<CandidateRaw>;
}

const DIRECTORY_DOMAINS = new Set([
  'clutch.co',
  'goodfirms.com',
  'sortlist.com',
  'fiverr.com',
  'upwork.com',
  'trustpilot.com',
  'g2.com',
  'capterra.com',
  'softwareadvice.com',
  'yelp.com',
  'yellowpages.com',
  'agencyspotter.com',
  'agencyanalytics.com',
  'agencycentral.com',
  'agencylist.co',
  'freelancer.com',
]);

const DIRECTORY_PATH_HINTS = [
  '/directory',
  '/directories',
  '/listing',
  '/listings',
  '/find-a',
  '/find-an',
  '/marketplace',
  '/vendors',
  '/agency',
  '/question',
  '/questions',
  '/answers',
  '/forum',
  '/community',
  '/user',
  '/users',
  '/wiki',
  '/blog',
  '/docs',
  '/documentation',
  '/documentation/',
  '/help',
  '/tutorial',
  '/tutorials',
  '/guide',
  '/guides',
  '/post',
  '/posts',
  '/tags',
  '/tag/',
];

const NON_AGENCY_HOST_HINTS = new Set([
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'reddit.com',
  'quora.com',
  'stacker.news',
  'stackoverflow.com',
  'github.com',
  'gitlab.com',
  'discord.com',
  'wikipedia.org',
  'namu.wiki',
  'tistory.com',
  'magicaiprompts.com',
  'infograb.net',
  'aeiai.net',
  'medium.com',
  'zhihu.com',
  'youtube.com',
  'twitch.tv',
  'bilibili.com',
  'facebook.net',
  'wix.com',
  'wordpress.com',
  'wordpress.org',
  'blogspot.com',
  'soundcloud.com',
  'dribbble.com',
]);

const DIRECTORY_TEXT_HINTS = [
  'directory',
  'directory of',
  'list of',
  'best',
  'reviews',
  'reviewed',
  'top',
  'listing',
  'marketplace',
  'compare',
  'service directory',
  'directory listing',
  'question',
  'answers',
  'forum',
  'community',
  'review',
  'wiki',
  'blog',
  'tutorial',
  'guide',
  'documentation',
  'documentation page',
  'technical documentation',
  'questions',
  'profile',
];

const DUCKDUCKGO_SITE_EXCLUDES = [
  '-site:clutch.co',
  '-site:goodfirms.com',
  '-site:sortlist.com',
  '-site:fiverr.com',
  '-site:upwork.com',
  '-site:trustpilot.com',
  '-site:g2.com',
  '-site:capterra.com',
  '-site:softwareadvice.com',
  '-site:yellowpages.com',
].join(' ');

const BING_RSS_EXCLUDES = [
  'site:clutch.co',
  'site:goodfirms.com',
  'site:sortlist.com',
  'site:fiverr.com',
  'site:upwork.com',
  'site:trustpilot.com',
  'site:g2.com',
  'site:capterra.com',
  'site:softwareadvice.com',
  'site:yellowpages.com',
  'site:linkedin.com',
  'site:github.com',
  'site:clutch.co',
].map((entry) => `-${entry}`).join(' ');

function decodeEntity(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
}

function parseTagValue(xml: string, tagName: string): string {
  const regex = new RegExp(`<${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = regex.exec(xml);
  if (!match) return '';
  const raw = (match[1] || '').trim();
  return raw ? cleanText(decodeEntity(stripCdata(raw))) : '';
}

function parseRssItemsFromXml(xml: string, maxResults: number): { title: string; url: string; description: string }[] {
  const candidates: { title: string; url: string; description: string }[] = [];
  const chunks = xml.split('<item>');

  for (let i = 1; i < chunks.length && candidates.length < maxResults; i += 1) {
    const block = chunks[i].split('</item>')[0] || '';
    if (!block) continue;

    const title = parseTagValue(`<item>${block}`, 'title');
    const url = parseTagValue(`<item>${block}`, 'link');
    const description = parseTagValue(`<item>${block}`, 'description');

    if (url) {
      candidates.push({
        title,
        url,
        description,
      });
    }
  }

  return candidates;
}

function cleanText(value: string): string {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWebsite(value: string): string {
  const candidate = String(value || '').trim();
  if (!candidate) return '';

  try {
    const parsed = new URL(
      candidate.startsWith('http://') || candidate.startsWith('https://') ? candidate : `https://${candidate}`
    );
    if (!parsed.hostname) return '';
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname || ''}`.replace(/\/+$/g, '');
  } catch {
    return '';
  }
}

function getResultUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, 'https://duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) return uddg;

    const link = parsed.searchParams.get('uddg1');
    if (link) return link;
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function normalizeHostForFilter(input: string): string {
  const value = String(input || '').toLowerCase().trim();
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return value
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .split('?')[0]
      .replace(/^www\./i, '');
  }
}

function isKnownDirectoryHost(hostname: string): boolean {
  const host = normalizeHostForFilter(hostname);
  if (!host) return false;
  if (Array.from(DIRECTORY_DOMAINS).some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return true;
  }

  return Array.from(NON_AGENCY_HOST_HINTS).some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function isDirectoryCandidateUrl(candidate: CandidateRaw): { blocked: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const host = normalizeHostForFilter(candidate.discoveredWebsite || '');
  const candidateText = `${candidate.discoveredName || ''} ${candidate.snippet || ''}`.toLowerCase();
  const candidateUrl = String(candidate.discoveredWebsite || '').toLowerCase();

  if (/\bdocs?\b/.test(candidateText)) {
    reasons.push('non-business-content:text:docs');
  }

  if (/\bguide\b|\btutorial\b|\breference\b/.test(candidateText)) {
    reasons.push('non-business-content:text:guide');
  }

  if (/\.wiki$/.test(host) && !host.includes('wikipedia.org')) {
    reasons.push('non-business-content:wiki-host');
  }

  if (isKnownDirectoryHost(host)) {
    reasons.push(`blacklist_host:${host}`);
  }

  const pathHint = DIRECTORY_PATH_HINTS.find((pattern) => candidateUrl.includes(pattern));
  if (pathHint) {
    reasons.push(`directory_path:${pathHint}`);
  }

  const textHint = DIRECTORY_TEXT_HINTS.find((pattern) => candidateText.includes(pattern));
  if (textHint) {
    reasons.push(`directory_text:${textHint}`);
  }

  return { blocked: reasons.length > 0, reasons };
}

function evaluateSignalsFromText(
  text: string,
  sourceHtml: string
): Omit<VerificationSignals, 'websiteStatus' | 'websiteStatusCode' | 'websiteOk' | 'emailFromSource'> {
  const normalized = text.toLowerCase();
  return {
    contactSignal: /\bcontact\b|reach us|get in touch|contact us|contact information/.test(normalized),
    aboutSignal: /\babout\b|who we are|about us|our story/.test(normalized),
    automationSignal: /\bautomation\b|zapier|make\.com|n8n|workflow|integration/.test(normalized),
    servicesSignal: /\bservices?\b|what we do|offerings|solutions?/.test(normalized),
    workSignal: /\bwork\b|portfolio|case study|projects?/.test(normalized),
    socialSignal: /linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com/.test(normalized),
    mailtoSignal: /mailto:/i.test(sourceHtml),
  };
}

function parseEmailsFromHtml(html: string): string[] {
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const matches = html.match(emailRegex) || [];
  const normalized = matches.map((item) => item.toLowerCase());
  const unique: string[] = [];
  for (const item of normalized) {
    if (!unique.includes(item)) unique.push(item);
  }
  return unique;
}

function extractDetailsFromHtml(html: string): {
  name?: string;
  description?: string;
  email?: string;
  signals: VerificationSignals;
} {
  const lowered = html.toLowerCase();
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const descMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);

  const emails = parseEmailsFromHtml(html);
  const plainText = cleanText(html).toLowerCase();
  const signalFlags = evaluateSignalsFromText(plainText, lowered);

  return {
    name: titleMatch ? cleanText(titleMatch[1]) : undefined,
    description: descMatch ? cleanText(descMatch[1]) : undefined,
    email: emails.find((email) => !!email),
    signals: {
      websiteOk: true,
      websiteStatus: 'ok',
      websiteStatusCode: 200,
      contactSignal: signalFlags.contactSignal,
      aboutSignal: signalFlags.aboutSignal,
      automationSignal: signalFlags.automationSignal,
      servicesSignal: signalFlags.servicesSignal,
      workSignal: signalFlags.workSignal,
      socialSignal: signalFlags.socialSignal,
      mailtoSignal: signalFlags.mailtoSignal,
      emailFromSource: !!emails[0],
    },
  };
}

function mergeSignals(base: VerificationSignals, extra: VerificationSignals): VerificationSignals {
  return {
    websiteOk: base.websiteOk || extra.websiteOk,
    websiteStatus: base.websiteStatus || extra.websiteStatus,
    websiteStatusCode: base.websiteStatusCode || extra.websiteStatusCode,
    contactSignal: base.contactSignal || extra.contactSignal,
    aboutSignal: base.aboutSignal || extra.aboutSignal,
    automationSignal: base.automationSignal || extra.automationSignal,
    servicesSignal: base.servicesSignal || extra.servicesSignal,
    workSignal: base.workSignal || extra.workSignal,
    socialSignal: base.socialSignal || extra.socialSignal,
    mailtoSignal: base.mailtoSignal || extra.mailtoSignal,
    emailFromSource: base.emailFromSource || extra.emailFromSource,
  };
}

function collectContactLinks(baseUrl: string, html: string, maxLinks = 2): string[] {
  const links: string[] = [];
  const hrefRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  const allowedPaths = ['/contact', '/contact-us', '/about', '/about-us', '/aboutus'];

  const tryAdd = (href: string | null) => {
    if (!href) return;
    const raw = href.split('#')[0].trim();
    if (!raw) return;

    const lower = raw.toLowerCase();
    if (!allowedPaths.some((path) => lower.includes(path))) return;

    try {
      const target = new URL(raw, baseUrl);
      if (target.origin !== new URL(baseUrl).origin) return;
      const normalized = target.toString().replace(/\/+$/, '');
      if (!links.includes(normalized)) {
        links.push(normalized);
      }
    } catch {
      // ignore bad links
    }
  };

  let match = hrefRegex.exec(html);
  while (match !== null && links.length < maxLinks) {
    tryAdd(match[1]);
    match = hrefRegex.exec(html);
  }

  return links.slice(0, maxLinks);
}

function mergeEmail(base: string | undefined, fallback: string | undefined): string | undefined {
  if (base) return base;
  return fallback;
}

async function fetchWithTimeout(url: string, timeoutMs: number, options: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        ...(options.headers || {}),
        'user-agent':
          'Mozilla/5.0 (compatible; partner-discovery/1.0; +https://automationagencydirectory.com)',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function parseLinksFromDuckduckgo(html: string, maxResults: number) {
  const results: CandidateRaw[] = [];
  const seen = new Set<string>();
  const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g;
  const snippetRegex = /class="result__snippet"[^>]*>(.*?)<\/p>/g;
  const snippets: string[] = [];

  for (let index = 0; index < 400; index += 1) {
    const match = snippetRegex.exec(html);
    if (!match) break;
    snippets.push(cleanText(match[1] || ''));
  }

  for (let i = 0; i < maxResults; i += 1) {
    const match = linkRegex.exec(html);
    if (!match) break;

    const rawHref = match[1];
    const rawName = cleanText(match[2] || '');
    const website = normalizeWebsite(getResultUrl(rawHref));

    if (!website || seen.has(website)) continue;
    seen.add(website);

    results.push({
      source: 'duckduckgo',
      discoveredName: rawName || 'Unknown',
      discoveredWebsite: website,
      sourceRef: rawHref,
      snippet: snippets[i] || undefined,
    });
  }

  return results;
}

class DuckDuckGoSource implements SourceAdapter {
  key = 'duckduckgo';
  displayName = 'DuckDuckGo HTML Search';

  async discover(query: SearchQuery, options: { maxResults: number }): Promise<CandidateRaw[]> {
    const q = `${query.query} ${query.country || ''} "automation partner" ${DUCKDUCKGO_SITE_EXCLUDES}`.trim();
    const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const response = await fetchWithTimeout(searchUrl, 12000);
    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const rawResults = parseLinksFromDuckduckgo(html, options.maxResults).map((result) => ({
      ...result,
      query,
      country: result.country || query.country,
      platforms: query.platforms,
    }));

    return rawResults.filter((candidate) => {
      const check = isDirectoryCandidateUrl(candidate);
      if (check.blocked) {
        candidate.discoveryFlags = {
          blockedBySource: true,
          rejectionReasons: check.reasons,
        };
        return false;
      }
      return true;
    });
  }

  async fetchDetails(candidate: CandidateRaw): Promise<CandidateRaw> {
    try {
      const response = await fetchWithTimeout(candidate.discoveredWebsite, 10000, {
        headers: { 'accept-language': 'en-US,en;q=0.9' },
      });

      const normalizedWebsite = normalizeWebsite(candidate.discoveredWebsite);

      if (!response.ok) {
        return {
          ...candidate,
          discoveredWebsite: normalizedWebsite,
          sourceRef: candidate.sourceRef || candidate.discoveredWebsite,
          verificationSignals: {
            websiteOk: false,
            websiteStatus: `http_${response.status}`,
            websiteStatusCode: response.status,
            contactSignal: false,
            aboutSignal: false,
            automationSignal: false,
            servicesSignal: false,
            workSignal: false,
            socialSignal: false,
            mailtoSignal: false,
            emailFromSource: false,
          },
        };
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        return {
          ...candidate,
          discoveredWebsite: normalizedWebsite,
          sourceRef: candidate.sourceRef || candidate.discoveredWebsite,
          verificationSignals: {
            websiteOk: false,
            websiteStatus: 'non_html',
            contactSignal: false,
            aboutSignal: false,
            automationSignal: false,
            servicesSignal: false,
            workSignal: false,
            socialSignal: false,
            mailtoSignal: false,
            emailFromSource: false,
          },
        };
      }

      const homepageHtml = await response.text();
      const homepageDetails = extractDetailsFromHtml(homepageHtml);
      let mergedSignals: VerificationSignals = {
        ...homepageDetails.signals,
        websiteOk: true,
        websiteStatus: homepageDetails.signals.websiteStatus,
        websiteStatusCode: homepageDetails.signals.websiteStatusCode,
      };
      let mergedEmail = mergeEmail(candidate.email, homepageDetails.email);

      const extraLinks = collectContactLinks(normalizedWebsite, homepageHtml, 3);
      for (const link of extraLinks) {
        try {
          const extraResponse = await fetchWithTimeout(link, 9000);
          if (!extraResponse.ok) continue;

          const extraType = String(extraResponse.headers.get('content-type') || '').toLowerCase();
          if (!extraType.includes('text/html') && !extraType.includes('application/xhtml+xml')) {
            continue;
          }

          const extraHtml = await extraResponse.text();
          const extraDetails = extractDetailsFromHtml(extraHtml);
          mergedSignals = mergeSignals(mergedSignals, extraDetails.signals);
          mergedEmail = mergeEmail(mergedEmail, extraDetails.email);
        } catch {
          // best-effort only
        }
      }

      const name =
        candidate.discoveredName && candidate.discoveredName !== 'Unknown'
          ? candidate.discoveredName
          : homepageDetails.name || candidate.discoveredName;

      return {
        ...candidate,
        discoveredName: name || homepageDetails.name || 'Unknown',
        discoveredWebsite: normalizedWebsite,
        sourceRef: candidate.sourceRef || candidate.discoveredWebsite,
        snippet: candidate.snippet || homepageDetails.description,
        email: mergedEmail,
        verificationSignals: {
          ...mergedSignals,
          emailFromSource: !!mergedEmail,
        },
      };
    } catch {
      return {
        ...candidate,
        discoveredWebsite: normalizeWebsite(candidate.discoveredWebsite),
        sourceRef: candidate.sourceRef || candidate.discoveredWebsite,
        verificationSignals: {
          websiteOk: false,
          websiteStatus: 'error',
          contactSignal: false,
          aboutSignal: false,
          automationSignal: false,
          servicesSignal: false,
          workSignal: false,
          socialSignal: false,
          mailtoSignal: false,
          emailFromSource: !!candidate.email,
        },
      };
    }
  }
}

async function fetchWebsiteDetails(candidate: CandidateRaw): Promise<CandidateRaw> {
  try {
    const response = await fetchWithTimeout(candidate.discoveredWebsite, 10000, {
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });

    const normalizedWebsite = normalizeWebsite(candidate.discoveredWebsite);

    if (!response.ok) {
      return {
        ...candidate,
        discoveredWebsite: normalizedWebsite,
        sourceRef: candidate.sourceRef || candidate.discoveredWebsite,
        verificationSignals: {
          websiteOk: false,
          websiteStatus: `http_${response.status}`,
          websiteStatusCode: response.status,
          contactSignal: false,
          aboutSignal: false,
          automationSignal: false,
          servicesSignal: false,
          workSignal: false,
          socialSignal: false,
          mailtoSignal: false,
          emailFromSource: !!candidate.email,
        },
      };
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return {
        ...candidate,
        discoveredWebsite: normalizedWebsite,
        sourceRef: candidate.sourceRef || candidate.discoveredWebsite,
        verificationSignals: {
          websiteOk: false,
          websiteStatus: 'non_html',
          contactSignal: false,
          aboutSignal: false,
          automationSignal: false,
          servicesSignal: false,
          workSignal: false,
          socialSignal: false,
          mailtoSignal: false,
          emailFromSource: !!candidate.email,
        },
      };
    }

    const homepageHtml = await response.text();
    const homepageDetails = extractDetailsFromHtml(homepageHtml);
    let mergedSignals: VerificationSignals = {
      ...homepageDetails.signals,
      websiteOk: true,
      websiteStatus: homepageDetails.signals.websiteStatus,
      websiteStatusCode: homepageDetails.signals.websiteStatusCode,
    };
    let mergedEmail = mergeEmail(candidate.email, homepageDetails.email);

    const extraLinks = collectContactLinks(normalizedWebsite, homepageHtml, 3);
    for (const link of extraLinks) {
      try {
        const extraResponse = await fetchWithTimeout(link, 9000);
        if (!extraResponse.ok) continue;

        const extraType = String(extraResponse.headers.get('content-type') || '').toLowerCase();
        if (!extraType.includes('text/html') && !extraType.includes('application/xhtml+xml')) {
          continue;
        }

        const extraHtml = await extraResponse.text();
        const extraDetails = extractDetailsFromHtml(extraHtml);
        mergedSignals = mergeSignals(mergedSignals, extraDetails.signals);
        mergedEmail = mergeEmail(mergedEmail, extraDetails.email);
      } catch {
        // best-effort only
      }
    }

    const name =
      candidate.discoveredName && candidate.discoveredName !== 'Unknown'
        ? candidate.discoveredName
        : homepageDetails.name || candidate.discoveredName;

    return {
      ...candidate,
      discoveredName: name || homepageDetails.name || 'Unknown',
      discoveredWebsite: normalizedWebsite,
      sourceRef: candidate.sourceRef || candidate.discoveredWebsite,
      snippet: candidate.snippet || homepageDetails.description,
      email: mergedEmail,
      verificationSignals: {
        ...mergedSignals,
        emailFromSource: !!mergedEmail,
      },
    };
  } catch {
    return {
      ...candidate,
      discoveredWebsite: normalizeWebsite(candidate.discoveredWebsite),
      sourceRef: candidate.sourceRef || candidate.discoveredWebsite,
      verificationSignals: {
        websiteOk: false,
        websiteStatus: 'error',
        contactSignal: false,
        aboutSignal: false,
        automationSignal: false,
        servicesSignal: false,
        workSignal: false,
        socialSignal: false,
        mailtoSignal: false,
        emailFromSource: !!candidate.email,
      },
    };
  }
}

class BingSource implements SourceAdapter {
  key = 'bing';
  displayName = 'Bing RSS Search';

  async discover(query: SearchQuery, options: { maxResults: number }): Promise<CandidateRaw[]> {
    const keywordSuffix = query.platforms?.length
      ? `(${query.platforms.join(' OR ')})`
      : '("automation agency" OR "marketing automation agency" OR "zapier partner")';
    const q = `${query.query} ${query.country || ''} ${keywordSuffix} ${BING_RSS_EXCLUDES}`.trim();
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(q)}&format=rss`;
    const response = await fetchWithTimeout(searchUrl, 12000, {
      headers: {
        referer: 'https://www.bing.com/',
      },
    });

    if (!response.ok) {
      return [];
    }

    const xml = await response.text();
    const parsed = parseRssItemsFromXml(xml, options.maxResults);
    const seen = new Set<string>();
    const candidates: CandidateRaw[] = [];

    for (const item of parsed) {
      const website = normalizeWebsite(item.url);
      if (!website || seen.has(website)) continue;
      seen.add(website);

      candidates.push({
        source: this.key,
        discoveredName: cleanText(item.title) || 'Unknown',
        discoveredWebsite: website,
        sourceRef: item.url,
        snippet: item.description || undefined,
        country: query.country,
        platforms: query.platforms,
        query,
      });
    }

    return candidates.filter((candidate) => {
      const check = isDirectoryCandidateUrl(candidate);
      if (check.blocked) {
        candidate.discoveryFlags = {
          blockedBySource: true,
          rejectionReasons: check.reasons,
        };
        return false;
      }
      return true;
    });
  }

  async fetchDetails(candidate: CandidateRaw): Promise<CandidateRaw> {
    return fetchWebsiteDetails(candidate);
  }
}

class FallbackSeedSource implements SourceAdapter {
  key = 'seed';
  displayName = 'Manual Seed URLs';

  async discover(query: SearchQuery, _options: { maxResults: number }): Promise<CandidateRaw[]> {
    return (query.platforms || [])
      .filter(Boolean)
      .slice(0, 3)
      .map((platform) => ({
        source: this.key,
        discoveredName: `${platform.toUpperCase()} Partner`,
        discoveredWebsite: '',
        sourceRef: query.query,
        country: query.country,
        platforms: [platform],
        query,
      }));
  }

  async fetchDetails(candidate: CandidateRaw): Promise<CandidateRaw> {
    return candidate;
  }
}

export const sourceAdapters: Record<string, SourceAdapter> = {
  duckduckgo: new DuckDuckGoSource(),
  bing: new BingSource(),
  seed: new FallbackSeedSource(),
};
