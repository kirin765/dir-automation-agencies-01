import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://kirin765.github.io',
  base: '/dir-automation-agencies-01/',
  output: 'static',
  integrations: [tailwind()],
  build: {
    format: 'file'
  },
  prefetch: true
});
