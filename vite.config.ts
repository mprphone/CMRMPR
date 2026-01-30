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
        // As variáveis com prefixo VITE_ são automaticamente expostas pelo Vite em `import.meta.env`.
        // As seguintes são para variáveis sem o prefixo que precisam de ser expostas no cliente.
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
