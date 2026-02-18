import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const workflowPath = new URL('../.github/workflows/deploy.yml', import.meta.url);
const workflow = readFileSync(workflowPath, 'utf8');

assert.match(
  workflow,
  /uses:\s*actions\/configure-pages@v4/,
  'deploy workflow must configure GitHub Pages'
);

assert.doesNotMatch(
  workflow,
  /enablement:\s*true/,
  'deploy workflow must not use configure-pages enablement:true (requires admin and breaks with GITHUB_TOKEN)'
);

assert.match(
  workflow,
  /uses:\s*actions\/deploy-pages@v4/,
  'deploy workflow must deploy with actions/deploy-pages@v4'
);

console.log('pages workflow checks passed');
