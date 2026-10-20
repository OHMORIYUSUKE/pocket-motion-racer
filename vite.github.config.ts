import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import path from 'node:path';

export default defineConfig({
  base: './',
  server: { allowedHosts: true },
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  build: { outDir: 'docs', emptyOutDir: true },
});
