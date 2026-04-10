import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Replay engine for fabric scenario frame data.
 *
 * Loads topology + frames, runs a wall-clock playhead, interpolates between
 * frames, and exposes the current frame state. Variant switching pauses
 * playback by design (per plan — variant switches are not live-swapped).
 */
export default function useReplay(topologyUrl) {
  const [topology, setTopology] = useState(null);
  const [frameSets, setFrameSets] = useState({}); // variant key -> frames array
  const [activeVariantKey, setActiveVariantKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [playheadMs, setPlayheadMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const rafRef = useRef(null);
  const lastTickRef = useRef(null);

  // Load topology.json on mount
  useEffect(() => {
    if (!topologyUrl) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(topologyUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load topology: ${r.status}`);
        return r.json();
      })
      .then((topo) => {
        if (cancelled) return;
        setTopology(topo);
        // Default variant = first one
        const firstVariant = topo.variants?.[0];
        if (firstVariant) {
          const key = variantKey(firstVariant.params);
          setActiveVariantKey(key);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => { cancelled = true; };
  }, [topologyUrl]);

  // Load the active variant's frames.json when it changes
  useEffect(() => {
    if (!topology || !activeVariantKey) return;
    if (frameSets[activeVariantKey]) {
      setLoading(false);
      return;
    }

    const variant = topology.variants.find(
      (v) => variantKey(v.params) === activeVariantKey,
    );
    if (!variant) return;

    // Resolve frames_file relative to the topology path
    const basePath = topologyUrl.substring(0, topologyUrl.lastIndexOf('/') + 1);
    const framesUrl = basePath + variant.frames_file;

    let cancelled = false;
    setLoading(true);
    fetch(framesUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load frames: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setFrameSets((prev) => ({ ...prev, [activeVariantKey]: data.frames }));
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [topology, activeVariantKey, frameSets, topologyUrl]);

  // Playback tick loop
  useEffect(() => {
    if (!isPlaying) {
      lastTickRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    function tick(now) {
      if (lastTickRef.current == null) lastTickRef.current = now;
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;

      setPlayheadMs((prev) => {
        const next = prev + dt * speed;
        const duration = topology?.duration_ms || 15000;
        if (next >= duration) {
          setIsPlaying(false);
          return duration;
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, speed, topology]);

  // Interpolated current frame
  const frames = frameSets[activeVariantKey];
  const currentFrame = frames ? interpolateFrame(frames, playheadMs) : null;

  const play = useCallback(() => {
    if (playheadMs >= (topology?.duration_ms || 15000)) {
      setPlayheadMs(0);
    }
    setIsPlaying(true);
  }, [playheadMs, topology]);

  const pause = useCallback(() => setIsPlaying(false), []);
  const seek = useCallback((ms) => {
    setPlayheadMs(Math.max(0, Math.min(ms, topology?.duration_ms || 15000)));
  }, [topology]);

  const setVariant = useCallback((params) => {
    // Per plan: pause on variant change
    setIsPlaying(false);
    setActiveVariantKey(variantKey(params));
  }, []);

  const activeVariant = topology?.variants?.find(
    (v) => variantKey(v.params) === activeVariantKey,
  );

  return {
    topology,
    loading,
    error,
    currentFrame,
    playheadMs,
    durationMs: topology?.duration_ms || 15000,
    isPlaying,
    speed,
    play,
    pause,
    seek,
    setSpeed,
    activeVariant,
    setVariant,
  };
}

// ---- helpers ----

function variantKey(params) {
  return Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('|');
}

function interpolateFrame(frames, playheadMs) {
  if (!frames || frames.length === 0) return null;
  if (playheadMs <= frames[0].t_ms) return frames[0];
  if (playheadMs >= frames[frames.length - 1].t_ms) return frames[frames.length - 1];

  // Binary search for the frame pair straddling playheadMs
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t_ms <= playheadMs) lo = mid;
    else hi = mid;
  }

  const a = frames[lo];
  const b = frames[hi];
  const span = b.t_ms - a.t_ms;
  const alpha = span > 0 ? (playheadMs - a.t_ms) / span : 0;

  return {
    t_ms: playheadMs,
    links: interpLinks(a.links, b.links, alpha),
    flows: interpFlows(a.flows, b.flows, alpha),
    nodes: interpNodes(a.nodes, b.nodes, alpha),
  };
}

function lerp(x, y, a) { return x + (y - x) * a; }

function interpLinks(a, b, alpha) {
  const bMap = new Map(b.map((l) => [l.id, l]));
  return a.map((la) => {
    const lb = bMap.get(la.id) || la;
    return {
      id: la.id,
      util_pct: lerp(la.util_pct, lb.util_pct, alpha),
      throughput_gbps: lerp(la.throughput_gbps, lb.throughput_gbps, alpha),
      drops: alpha < 0.5 ? la.drops : lb.drops,         // discrete: nearest-neighbor
      pfc_pauses: alpha < 0.5 ? la.pfc_pauses : lb.pfc_pauses,
    };
  });
}

function interpNodes(a, b, alpha) {
  const bMap = new Map(b.map((n) => [n.id, n]));
  return a.map((na) => {
    const nb = bMap.get(na.id) || na;
    return {
      id: na.id,
      queue_depth_pct: lerp(na.queue_depth_pct, nb.queue_depth_pct, alpha),
      pfc_xoff: alpha < 0.5 ? na.pfc_xoff : nb.pfc_xoff,
    };
  });
}

function interpFlows(a, b, alpha) {
  const bMap = new Map(b.map((f) => [f.id, f]));
  return a.map((fa) => {
    const fb = bMap.get(fa.id) || fa;
    return {
      ...fa,
      throughput_gbps: lerp(fa.throughput_gbps, fb.throughput_gbps, alpha),
    };
  });
}
