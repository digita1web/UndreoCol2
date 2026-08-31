import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  { ignores: ['coverage/**', 'node_modules/**', 'supabase/**'] },
  ...nextVitals,
  ...nextTypescript,
];

export default config;
