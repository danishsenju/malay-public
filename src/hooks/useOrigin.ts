'use client'

import { useSyncExternalStore } from 'react'

const emptySubscribe = () => () => {}
const getOrigin = () => window.location.origin
const getServerOrigin = () => ''

/** This site's origin (https://transitmy.example), '' during SSR - for building absolute share URLs. */
export function useOrigin(): string {
  return useSyncExternalStore(emptySubscribe, getOrigin, getServerOrigin)
}
