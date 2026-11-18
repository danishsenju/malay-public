import type { Metadata } from 'next'
import { WeatherClient } from '@/components/weather/WeatherClient'

export const metadata: Metadata = {
  title: 'Cuaca & Banjir - TransitMY',
  description:
    'Paras sungai & hujan langsung dari stesen telemetri JPS, ramalan 7 hari & amaran MET Malaysia - dengan amaran banjir ke telefon. Tiada login.',
}

export default function WeatherPage() {
  return <WeatherClient />
}
