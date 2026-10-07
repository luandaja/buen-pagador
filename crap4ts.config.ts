import { defineConfig } from 'crap4ts';

export default defineConfig({
  threshold: 10,
  coverageMetric: 'line',
  src: ['src'],
  exclude: ['**/*.test.*', '**/*.spec.*', '**/*.d.ts'],
  top: 15,
});
