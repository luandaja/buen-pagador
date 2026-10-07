import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  // Las páginas son estáticas; solo /api/* corre como función en Vercel.
  adapter: vercel(),
  vite: {
    optimizeDeps: { include: ['@vladmandic/face-api'] },
  },
});
