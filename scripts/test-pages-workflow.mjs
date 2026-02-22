import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const cloudflareWorkflowPath = new URL('../.github/workflows/deploy-cloudflare-pages.yml', import.meta.url);
const workflowContent = readFileSync(cloudflareWorkflowPath, 'utf8');

assert.match(
  workflowContent,
  /wrangler\s+pages\s+deploy\s+dist/, 
  'Cloudflare Pages deploy command must exist'
);

assert.match(
  workflowContent,
  /npx\s+wrangler\s+pages\s+deploy\s+dist/, 
  'Cloudflare Pages deploy should use wrangler CLI pages deploy dist'
);

assert.match(
  workflowContent,
  /on:\s*[\s\S]*?push:/,
  'Cloudflare Pages workflow should be trigger-driven'
);

const githubWorkflowPath = new URL('../.github/workflows/deploy.yml', import.meta.url);
const githubWorkflow = readFileSync(githubWorkflowPath, 'utf8');

assert.match(
  githubWorkflow,
  /workflow_dispatch:/,
  'legacy GitHub Pages workflow should remain intentionally limited'
);

console.log('cloudflare deployment workflow checks passed');

