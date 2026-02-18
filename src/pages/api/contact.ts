import fs from 'fs';
import path from 'path';

interface LeadSubmission {
  id: string;
  listingSlug: string;
  name: string;
  email: string;
  budget: string;
  message: string;
  createdAt: string;
}

const LEADS_PATH = path.join(process.cwd(), 'data', 'leads.json');

function readLeads(): LeadSubmission[] {
  try {
    return JSON.parse(fs.readFileSync(LEADS_PATH, 'utf-8')) as LeadSubmission[];
  } catch {
    return [];
  }
}

function writeLeads(leads: LeadSubmission[]) {
  fs.writeFileSync(LEADS_PATH, JSON.stringify(leads, null, 2));
}

export async function POST({ request }: { request: Request }) {
  const form = await request.formData();

  const submission: LeadSubmission = {
    id: crypto.randomUUID(),
    listingSlug: String(form.get('listingSlug') || ''),
    name: String(form.get('name') || ''),
    email: String(form.get('email') || ''),
    budget: String(form.get('budget') || ''),
    message: String(form.get('message') || ''),
    createdAt: new Date().toISOString(),
  };

  if (!submission.listingSlug || !submission.name || !submission.email || !submission.message) {
    return new Response('Missing required fields', { status: 400 });
  }

  const leads = readLeads();
  leads.push(submission);
  writeLeads(leads);

  const referer = request.headers.get('referer') || '/contact';
  const redirectTarget = referer.includes('/listing/')
    ? `${referer}${referer.includes('?') ? '&' : '?'}lead=ok`
    : `${referer}${referer.includes('?') ? '&' : '?'}submitted=1`;

  return Response.redirect(redirectTarget, 303);
}
