import { useEffect } from 'react';
import yaml from 'js-yaml';
import useViewerStore from '../store/viewerStore';
import { normalizeScenario } from '../utils/normalizeScenario';

export default function useScenario(slug) {
  const setScenario = useViewerStore(s => s.setScenario);

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
        const scenario = normalizeScenario(raw);

        if (!cancelled) {
          setScenario(scenario);
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
}
