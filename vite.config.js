import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Piso declarado, nao herdado: o default do Vite sobe a cada major
    // (safari14 na 6, safari16 na 7, safari16.4 na 8) e passaria por cima do
    // suporte real desta app, que para no Safari/iOS 15.4 - audiencia viva
    // (iPhone 6s/7/SE-1 morreram no iOS 15.8, backlog B33). Os numeros sao a
    // feature mais exigente SEM fallback: dvh (chrome/edge 108, 15x no
    // styles.css), :has() (firefox 121, 5x em body:has(.modal-backdrop)) e
    // .at() (App.jsx:244). color-mix() nao conta - styles.css:4225 tem
    // @supports not para ele. Precisa ser navegador e nao 'es2020' porque
    // build.cssTarget herda daqui, e o Lightning CSS (default de cssMinify na
    // Vite 8) le esse alvo para decidir o que reescrever no CSS.
    target: ['chrome108', 'edge108', 'firefox121', 'safari15.4', 'ios15.4'],
  },
  server: {
    port: 5173,
    open: true,
  },
})
