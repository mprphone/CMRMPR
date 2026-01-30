import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_MODEL': JSON.stringify(env.GEMINI_MODEL || 'gemini-flash-latest'),
        'process.env.VITE_SUPABASE_URL_CMR': JSON.stringify(env.VITE_SUPABASE_URL_CMR),
        'process.env.VITE_SUPABASE_KEY_CMR': JSON.stringify(env.VITE_SUPABASE_KEY_CMR),
        'process.env.VITE_SUPABASE_URL_IMPORT': JSON.stringify(env.VITE_SUPABASE_URL_IMPORT),
        'process.env.VITE_SUPABASE_KEY_IMPORT': JSON.stringify(env.VITE_SUPABASE_KEY_IMPORT),
        'process.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL),
        'process.env.SUPABASE_SERVICE_ROLE_KEY': JSON.stringify(env.SUPABASE_SERVICE_ROLE_KEY),
        'process.env.SUPABASE_CLIENTS_SOURCE': JSON.stringify(env.SUPABASE_CLIENTS_SOURCE),
        'process.env.SUPABASE_STAFF_SOURCE': JSON.stringify(env.SUPABASE_FUNCIONARIOS_SOURCE || env.SUPABASE_STAFF_SOURCE),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
