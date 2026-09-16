import type { Metadata } from 'next'
import { MapClient } from '@/components/map/MapClient'

export const metadata: Metadata = {
  title: 'Peta Langsung - TransitMY',
  description:
    'Jejak kedudukan langsung tren KTM dan bas Rapid KL pada peta geografi sebenar.',
}

export default function MapPage() {
  return <MapClient />
}
