import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  adapter: vercel(),
  vite: {
    optimizeDeps: { include: ['@vladmandic/face-api', 'preact', 'preact/hooks', 'preact/jsx-runtime', '@preact/signals', 'idb'] },
  },
});
