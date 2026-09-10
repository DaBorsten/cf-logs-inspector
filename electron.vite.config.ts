import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const shared = { '@shared': resolve('src/shared') };

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    // Sandboxed renderers can only run CommonJS preload scripts; an ESM (.mjs) preload fails with
    // "Cannot use import statement outside a module" and leaves window.api undefined.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { ...shared, '@renderer': resolve('src/renderer/src') } },
    // Pre-bundle everything the renderer uses so Vite never re-optimises mid-session (which briefly
    // loads two copies of React and crashes hooks with "Invalid hook call").
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        '@tanstack/react-query',
        '@tanstack/react-table',
        '@tanstack/react-virtual',
        'radix-ui',
        'zustand',
        'zustand/middleware',
        'sonner',
        'lucide-react',
        'clsx',
        'tailwind-merge',
        'class-variance-authority',
      ],
    },
  },
});
