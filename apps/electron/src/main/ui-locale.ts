import en from '../../../../locales/en.json'
import zhCN from '../../../../locales/zh_CN.json'

export type SupportedLocale = 'en' | 'zh_CN'

export const localeResources: Record<SupportedLocale, Record<string, string>> = {
  en: en as Record<string, string>,
  zh_CN: zhCN as Record<string, string>
}

let currentLocale: SupportedLocale = 'en'

/** The product language last reported by the renderer; main-process copy follows it. */
export function getUiLocale(): SupportedLocale {
  return currentLocale
}

export function setUiLocale(locale: string): void {
  currentLocale = locale === 'zh_CN' ? 'zh_CN' : 'en'
}

export function translateUi(key: string, fallback: string): string {
  const resources = localeResources[currentLocale] ?? localeResources.en
  return resources[key] ?? localeResources.en[key] ?? fallback
}
