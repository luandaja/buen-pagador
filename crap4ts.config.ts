import { defineConfig } from 'crap4ts';

// CRAP = complejidad² × (1 − cobertura)³ + complejidad. Ninguna función puede pasar de 10.
export default defineConfig({
  threshold: 10,
  coverageMetric: 'line',
  src: ['src'],
  exclude: ['**/*.test.*', '**/*.spec.*', '**/*.d.ts'],
  top: 15,
});
