import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  adapter: vercel(),
  // Inline the CSS in the HTML: the page can never render without styles because a
  // separate /_astro/*.css request failed or arrived from another deployment.
  build: { inlineStylesheets: 'always' },
  vite: {
    optimizeDeps: { include: ['@vladmandic/face-api', 'preact', 'preact/hooks', 'preact/jsx-runtime', '@preact/signals', 'idb'] },
  },
});
