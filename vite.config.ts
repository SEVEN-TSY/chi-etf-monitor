import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { localDashboard } from './local/plugin.ts'

export default defineConfig(({ command }) => ({
  plugins: [vue(), localDashboard(fileURLToPath(new URL('../data/etf.sqlite3', import.meta.url)), fileURLToPath(new URL('./dist', import.meta.url)))],
  define: command === 'build' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  build: {
    lib: { entry: 'src/main.ts', name: 'EtfDashboard', formats: ['iife'], fileName: () => 'dashboard.js', cssFileName: 'dashboard' },
    emptyOutDir: true,
  },
}))
