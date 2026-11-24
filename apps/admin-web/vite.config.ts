import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Admin/staff build. Deliberately no PWA plugin: the customer app is an
 * installable PWA, the staff console is a conventional web application
 * used on facility machines and phones. Nothing about the customer
 * app's service worker is touched or shared.
 */
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  preview: { port: 4174 },
});
