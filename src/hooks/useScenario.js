import { useEffect, useRef } from 'react';
import yaml from 'js-yaml';
import i18n from '../i18n/i18n';
import useViewerStore from '../store/viewerStore';
import { normalizeScenario } from '../utils/normalizeScenario';
import { applyScenarioTranslation } from '../utils/scenarioTranslation';

export default function useScenario(slug) {
  const setScenario = useViewerStore(s => s.setScenario);

  // Keep the last normalized (English) scenario so we can re-translate
  // when the language changes without re-fetching the YAML.
  const normalizedRef = useRef(null);

  useEffect(() => {
    if (!slug) return;

    // Skip fetch for generated scenarios (e.g., from PCAP conversation)
    // The scenario is already set in the store before navigation
    if (slug.startsWith('_')) {
      const existing = useViewerStore.getState();
      if (existing.scenario && existing.currentSlug === slug) return;
    }

    let cancelled = false;

    async function load() {
      useViewerStore.setState({ loading: true, error: null, currentSlug: slug });

      try {
        // Fetch manifest
        const base = import.meta.env.BASE_URL;
        const manifestRes = await fetch(`${base}scenarios/index.json`);
        if (!manifestRes.ok) throw new Error(`Failed to fetch scenario manifest`);
        const manifest = await manifestRes.json();

        // Find scenario by slug
        const entry = manifest.scenarios.find(s => s.slug === slug);
        if (!entry) throw new Error(`Scenario "${slug}" not found`);

        // Fetch YAML
        const yamlRes = await fetch(`${base}scenarios/${entry.path}`);
        if (!yamlRes.ok) throw new Error(`Failed to fetch scenario YAML`);
        const yamlText = await yamlRes.text();

        // Parse and normalize
        const raw = yaml.load(yamlText);
        const normalized = normalizeScenario(raw);
        normalizedRef.current = normalized;

        // Apply translation overlay for the current language
        const locale = i18n.language || 'en';
        const translated = await applyScenarioTranslation(normalized, slug, locale);

        if (!cancelled) {
          setScenario(translated);
        }
      } catch (err) {
        if (!cancelled) {
          useViewerStore.setState({ error: err.message, loading: false });
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [slug, setScenario]);

  // Re-apply translation when the i18n language changes while a scenario is loaded.
  useEffect(() => {
    function onLanguageChanged(lng) {
      const normalized = normalizedRef.current;
      if (!normalized || !slug) return;

      applyScenarioTranslation(normalized, slug, lng).then(translated => {
        // Only update if we're still looking at the same scenario
        const current = useViewerStore.getState();
        if (current.currentSlug === slug) {
          setScenario(translated);
        }
      });
    }

    i18n.on('languageChanged', onLanguageChanged);
    return () => { i18n.off('languageChanged', onLanguageChanged); };
  }, [slug, setScenario]);
}
