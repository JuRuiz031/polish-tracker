/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      // The domain layer is where the real logic lives, so it is the only thing
      // held to a coverage bar. UI coverage is chased in e2e instead.
      include: ['src/domain/**'],
      exclude: ['src/domain/__tests__/**'],
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
})
