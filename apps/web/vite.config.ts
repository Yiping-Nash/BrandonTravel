import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({plugins:[react(),tailwindcss()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},server:{port:5173,strictPort:true,proxy:{'/api':{target:process.env.WORKSPACE_API_TARGET||'http://127.0.0.1:8000',changeOrigin:false}}}});
