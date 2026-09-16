import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TransitMY - Penjejak Transit Malaysia',
    short_name: 'TransitMY',
    description:
      'LRT, MRT, Monorel, KTM & bas Rapid dalam satu aplikasi - masa nyata, dengan resit.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f3f3f1',
    theme_color: '#f3f3f1',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
