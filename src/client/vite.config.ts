import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const monacoEditorModule = require('vite-plugin-monaco-editor');
const monacoEditor = monacoEditorModule.default || monacoEditorModule;

const monacoEditorPlugin = monacoEditor({
  languageWorkers: ['editorWorkerService', 'typescript', 'json', 'html', 'css']
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // 加载环境变量
  const env = loadEnv(mode, process.cwd(), '');
  
  // 解析允许的 hosts，支持从环境变量配置
  const allowedHosts = env.VITE_ALLOWED_HOSTS 
    ? env.VITE_ALLOWED_HOSTS.split(',').map(h => h.trim())
    : [];
  
  return {
    plugins: [
      react(),
      monacoEditorPlugin
    ],
    server: {
      port: 5173,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true
        },
        '/socket.io': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          ws: true
        }
      },
      allowedHosts
    },
    build: {
      outDir: '../../dist',
      emptyOutDir: true,
      sourcemap: true
    },
    // 配置 Monaco Editor 的 worker
    optimizeDeps: {
      include: ['monaco-editor']
    }
  }
});
