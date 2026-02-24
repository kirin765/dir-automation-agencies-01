import { execSync } from 'node:child_process';
import { strict as assert } from 'node:assert';

const scripts = [
  'node scripts/test-pages-workflow.mjs',
  'node scripts/quality/test-smoke.mjs',
  'node scripts/quality/test-seo.mjs',
  'node scripts/quality/test-routes.mjs',
  'node scripts/quality/test-api.mjs',
  'node scripts/quality/test-journey.mjs',
];

for (const script of scripts) {
  execSync(script, { stdio: 'inherit' });
}

assert(scripts.length > 0);
console.log('quality gate passed');
