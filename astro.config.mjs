import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://automation-agencies.com',
  base: '/',
  output: 'static',
  integrations: [tailwind()],
  build: {
    format: 'file'
  },
  prefetch: true
});
