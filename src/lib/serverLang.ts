import { cookies } from 'next/headers'
import { STRINGS, type StringKey } from './strings'
import type { Lang } from './i18n'

/**
 * Server-side counterpart of useLang for server components (/ktmb, /report,
 * /status). Reads the language from the cookie that setLang mirrors — the
 * localStorage value itself never reaches the server. Defaults to BM (brand
 * default), matching the client's server snapshot.
 */
export async function getServerLang(): Promise<Lang> {
  const jar = await cookies()
  return jar.get('transitmy-lang')?.value === 'en' ? 'en' : 'ms'
}

/** Translator bound to a language — same shape as useLang().t */
export function serverT(lang: Lang) {
  return (key: StringKey) => STRINGS[lang][key]
}
