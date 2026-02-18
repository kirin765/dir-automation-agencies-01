import fs from 'fs';
import path from 'path';

interface OwnershipRequest {
  id: string;
  listingSlug: string;
  agencyName: string;
  requesterName: string;
  requesterEmail: string;
  website: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

const CLAIMS_PATH = path.join(process.cwd(), 'data', 'ownership-requests.json');

function readRequests(): OwnershipRequest[] {
  try {
    return JSON.parse(fs.readFileSync(CLAIMS_PATH, 'utf-8')) as OwnershipRequest[];
  } catch {
    return [];
  }
}

function writeRequests(requests: OwnershipRequest[]) {
  fs.writeFileSync(CLAIMS_PATH, JSON.stringify(requests, null, 2));
}

export async function POST({ request }: { request: Request }) {
  const form = await request.formData();

  const claim: OwnershipRequest = {
    id: crypto.randomUUID(),
    listingSlug: String(form.get('listingSlug') || ''),
    agencyName: String(form.get('agencyName') || ''),
    requesterName: String(form.get('requesterName') || ''),
    requesterEmail: String(form.get('requesterEmail') || ''),
    website: String(form.get('website') || ''),
    message: String(form.get('message') || ''),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  if (!claim.listingSlug || !claim.requesterName || !claim.requesterEmail || !claim.website || !claim.message) {
    return new Response('Missing required fields', { status: 400 });
  }

  const requests = readRequests();
  requests.push(claim);
  writeRequests(requests);

  return Response.redirect(`/claim?listing=${encodeURIComponent(claim.listingSlug)}&submitted=1`, 303);
}
