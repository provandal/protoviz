import { useState, useCallback, useEffect } from 'react';

function getStorageKey(scenarioSlug) {
  return `protoviz_annotations_${scenarioSlug}`;
}

export default function useAnnotations(scenarioSlug) {
  const [annotations, setAnnotations] = useState({});

  // Load from localStorage
  useEffect(() => {
    if (!scenarioSlug) return;
    try {
      const stored = localStorage.getItem(getStorageKey(scenarioSlug));
      if (stored) setAnnotations(JSON.parse(stored));
      else setAnnotations({});
    } catch {
      setAnnotations({});
    }
  }, [scenarioSlug]);

  // Save to localStorage
  const save = useCallback((updated) => {
    setAnnotations(updated);
    if (scenarioSlug) {
      localStorage.setItem(getStorageKey(scenarioSlug), JSON.stringify(updated));
    }
  }, [scenarioSlug]);

  const setNote = useCallback((stepIdx, text) => {
    const updated = { ...annotations };
    if (text.trim()) {
      updated[stepIdx] = text.trim();
    } else {
      delete updated[stepIdx];
    }
    save(updated);
  }, [annotations, save]);

  const getNote = useCallback((stepIdx) => {
    return annotations[stepIdx] || '';
  }, [annotations]);

  const hasNote = useCallback((stepIdx) => {
    return !!annotations[stepIdx];
  }, [annotations]);

  const exportAnnotations = useCallback(() => {
    return JSON.stringify({ scenarioSlug, annotations }, null, 2);
  }, [scenarioSlug, annotations]);

  const importAnnotations = useCallback((json) => {
    try {
      const data = JSON.parse(json);
      if (data.annotations) save(data.annotations);
    } catch {
      // Invalid JSON
    }
  }, [save]);

  const count = Object.keys(annotations).length;

  return { annotations, setNote, getNote, hasNote, exportAnnotations, importAnnotations, count };
}
