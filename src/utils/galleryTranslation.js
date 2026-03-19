/**
 * Gallery scenario card translations.
 *
 * Loads per-language JSON overlays for scenario titles and descriptions
 * from public/gallery-i18n/{lang}.json. Falls back to English (original index.json).
 */

const cache = {};

/**
 * Load gallery translations for a given locale.
 * Returns a map: { [slug]: { title, description } }
 * Returns empty object for 'en' or on fetch failure (graceful fallback).
 */
export async function loadGalleryTranslations(locale) {
  if (!locale || locale === 'en') return {};
  if (cache[locale]) return cache[locale];

  try {
    const base = import.meta.env.BASE_URL;
    const resp = await fetch(`${base}gallery-i18n/${locale}.json`);
    if (!resp.ok) return {};
    const data = await resp.json();
    cache[locale] = data;
    return data;
  } catch {
    return {};
  }
}

/**
 * Apply gallery translations to a scenario object.
 * Returns a new object with translated title/description if available.
 */
export function translateScenario(scenario, translations) {
  if (!translations || !translations[scenario.slug]) return scenario;
  const t = translations[scenario.slug];
  return {
    ...scenario,
    title: t.title || scenario.title,
    description: t.description || scenario.description,
  };
}
