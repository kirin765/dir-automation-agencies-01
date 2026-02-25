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
}

export interface SourceAdapter {
  key: string;
  displayName: string;
  discover(query: SearchQuery, options: { maxResults: number }): Promise<CandidateRaw[]>;
  fetchDetails(candidate: CandidateRaw): Promise<CandidateRaw>;
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
    if (uddg) {
      return uddg;
    }

    const link = parsed.searchParams.get('uddg1');
    if (link) {
      return link;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function evaluateSignalsFromText(text: string, sourceHtml: string): Omit<VerificationSignals, 'websiteStatus' | 'websiteStatusCode' | 'websiteOk' | 'emailFromSource'> {
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

function extractDetailsFromHtml(html: string): { name?: string; description?: string; email?: string; signals: VerificationSignals } {
  const lowered = html.toLowerCase();
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);

  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const rawEmails = (html.match(emailRegex) || []).map((item) => item.toLowerCase());
  const visibleEmail = rawEmails.find((email) => !!email);

  const plainText = cleanText(html).toLowerCase();
  const signalFlags = evaluateSignalsFromText(plainText, lowered);

  return {
    name: titleMatch ? cleanText(titleMatch[1]) : undefined,
    description: descMatch ? cleanText(descMatch[1]) : undefined,
    email: visibleEmail,
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
      emailFromSource: !!visibleEmail,
    },
  };
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
    const q = `${query.query} ${query.country || ''}`.trim();
    const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const response = await fetchWithTimeout(searchUrl, 12000);
    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const results = parseLinksFromDuckduckgo(html, options.maxResults).map((result) => ({
      ...result,
      query,
      country: result.country || query.country,
      platforms: query.platforms,
    }));

    return results;
  }

  async fetchDetails(candidate: CandidateRaw): Promise<CandidateRaw> {
    try {
      const response = await fetchWithTimeout(candidate.discoveredWebsite, 10000, {
        headers: { 'accept-language': 'en-US,en;q=0.9' },
      });

      const normalizedWebsite = normalizeWebsite(candidate.discoveredWebsite);

      if (!response.ok) {
        const status = response.status;
        return {
          ...candidate,
          discoveredWebsite: normalizedWebsite,
          sourceRef: candidate.sourceRef || candidate.discoveredWebsite,
          verificationSignals: {
            websiteOk: false,
            websiteStatus: `http_${status}`,
            websiteStatusCode: status,
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

      const html = await response.text();
      const details = extractDetailsFromHtml(html);
      const name =
        candidate.discoveredName && candidate.discoveredName !== 'Unknown'
          ? candidate.discoveredName
          : details.name || candidate.discoveredName;

      return {
        ...candidate,
        discoveredName: name || details.name || 'Unknown',
        discoveredWebsite: normalizedWebsite,
        sourceRef: candidate.sourceRef || candidate.discoveredWebsite,
        snippet: candidate.snippet || details.description,
        email: candidate.email || details.email,
        verificationSignals: {
          ...details.signals,
          websiteOk: true,
          websiteStatus: details.signals.websiteStatus,
          websiteStatusCode: details.signals.websiteStatusCode,
          emailFromSource: !!(candidate.email || details.email),
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
  seed: new FallbackSeedSource(),
};
