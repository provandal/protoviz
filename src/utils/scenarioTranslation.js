/**
 * Scenario translation overlay system.
 *
 * Fetches a locale-specific JSON overlay from /scenario-i18n/{locale}/{slug}.json
 * and deep-merges translatable text fields onto the normalized scenario object.
 *
 * Only user-visible text is overridden — protocol fields, spec refs, abbreviations,
 * sequence numbers, and structural data are never touched.
 */

/**
 * Fetch and merge a translation overlay for a scenario.
 * Returns the translated scenario, or the original if no translation is available.
 *
 * @param {object} scenario - Normalized scenario object
 * @param {string} slug - Scenario slug (e.g. "tcp-3way-handshake-data-fin")
 * @param {string} locale - BCP 47 language tag (e.g. "es", "zh-CN")
 * @returns {Promise<object>} Translated scenario (or original on failure)
 */
export async function applyScenarioTranslation(scenario, slug, locale) {
  if (!locale || locale === 'en') return scenario;

  const base = import.meta.env.BASE_URL;
  try {
    const res = await fetch(`${base}scenario-i18n/${locale}/${slug}.json`);
    if (!res.ok) return scenario;
    const overlay = await res.json();
    return mergeOverlay(scenario, overlay);
  } catch {
    return scenario;
  }
}

/**
 * Deep-merge a translation overlay onto a normalized scenario.
 * Clones the scenario so the original is never mutated.
 *
 * @param {object} scenario - Normalized scenario
 * @param {object} overlay  - Translation overlay JSON
 * @returns {object} A new scenario with translated text fields
 */
export function mergeOverlay(scenario, overlay) {
  // Deep clone so we never mutate the original
  const out = structuredClone(scenario);

  // ── Meta ──────────────────────────────────────────────────────
  if (overlay.meta) {
    if (overlay.meta.title) out.meta.title = overlay.meta.title;
    if (overlay.meta.description) out.meta.description = overlay.meta.description;
    if (Array.isArray(overlay.meta.learning_objectives) && overlay.meta.learning_objectives.length > 0) {
      out.meta.learning_objectives = overlay.meta.learning_objectives;
    }
  }

  // ── Actors ────────────────────────────────────────────────────
  if (overlay.actors && Array.isArray(out.actors)) {
    for (const actor of out.actors) {
      const patch = overlay.actors[actor.id];
      if (!patch) continue;
      if (patch.label) actor.label = patch.label;
      if (patch.description) actor.description = patch.description;
    }
  }

  // ── Timeline ──────────────────────────────────────────────────
  if (overlay.timeline && Array.isArray(out.timeline)) {
    for (const [indexStr, patch] of Object.entries(overlay.timeline)) {
      const idx = parseInt(indexStr, 10);
      if (idx < 0 || idx >= out.timeline.length) continue;
      if (patch.text) out.timeline[idx].label = patch.text;
      if (patch.detail) out.timeline[idx].detail = patch.detail;
    }
  }

  // ── Walkthroughs ──────────────────────────────────────────────
  if (overlay.walkthroughs && Array.isArray(out.walkthroughs)) {
    for (const wt of out.walkthroughs) {
      const patch = overlay.walkthroughs[wt.id];
      if (!patch) continue;
      if (patch.title) wt.title = patch.title;
      if (patch.description) wt.description = patch.description;
      if (patch.steps && Array.isArray(wt.steps)) {
        for (const [stepIdxStr, narration] of Object.entries(patch.steps)) {
          const stepIdx = parseInt(stepIdxStr, 10);
          if (stepIdx >= 0 && stepIdx < wt.steps.length) {
            wt.steps[stepIdx].narration = narration;
          }
        }
      }
    }
  }

  // ── Glossary ──────────────────────────────────────────────────
  if (overlay.glossary && Array.isArray(out.glossary)) {
    for (const entry of out.glossary) {
      // Match by the original English term key
      const patch = overlay.glossary[entry.term];
      if (!patch) continue;
      if (patch.term) entry.term = patch.term;
      if (patch.definition) entry.definition = patch.definition;
    }
  }

  // ── Frames (inlined in timeline events as event.frame) ────────
  if (overlay.frames && Array.isArray(out.timeline)) {
    for (const ev of out.timeline) {
      if (!ev.frame || !ev.frame.id) continue;
      const patch = overlay.frames[ev.frame.id];
      if (patch && patch.name) {
        ev.frame.name = patch.name;
      }
    }
  }

  return out;
}
