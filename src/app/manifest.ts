import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sampai Bila? — Penjejak Transit Malaysia',
    short_name: 'Sampai Bila?',
    description:
      'LRT, MRT, Monorel, KTM & bas Rapid dalam satu aplikasi — masa nyata, dengan resit.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f3f3f1',
    theme_color: '#f3f3f1',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  }
}
