import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: './hub',
  envDir: '../',
  build: {
    outDir: '../dist-hub',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      '@hub': path.resolve(__dirname, './src'),
    },
  },
})
