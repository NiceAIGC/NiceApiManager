import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://localhost:8000',
            '/health': 'http://localhost:8000',
        },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        chunkSizeWarningLimit: 900,
        rollupOptions: {
            output: {
                manualChunks: {
                    router: ['react-router-dom'],
                    query: ['@tanstack/react-query', 'axios'],
                },
            },
        },
    },
});
