import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import yaml from 'js-yaml';
import StackGrid from './StackGrid';
import LanguageSelector from '../common/LanguageSelector';

const BASE = import.meta.env.BASE_URL;

async function fetchYaml(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  const text = await res.text();
  return yaml.load(text);
}

export default function StacksPage() {
  const navigate = useNavigate();
  const [layers, setLayers] = useState(null);
  const [components, setComponents] = useState(null);
  const [stacks, setStacks] = useState([]);
  const [selectedStackIds, setSelectedStackIds] = useState(null);
  const [toggles, setToggles] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      try {
        const [layersData, compData, indexData] = await Promise.all([
          fetchYaml('stacks/vocabulary/layers.yaml'),
          fetchYaml('stacks/vocabulary/components.yaml'),
          fetch(`${BASE}stacks/index.json`).then(r => r.json()),
        ]);

        const stackPromises = indexData.stacks.map(s =>
          fetchYaml(`stacks/${s.path}`)
        );
        const stacksData = await Promise.all(stackPromises);

        // Initial toggle state: union of all optional_layers across stacks,
        // each defaulting to its `default_enabled` (true → user can turn OFF).
        const initialToggles = {};
        for (const stack of stacksData) {
          if (!stack.optional_layers) continue;
          for (const ol of stack.optional_layers) {
            if (!(ol.name in initialToggles)) {
              initialToggles[ol.name] = ol.default_enabled !== false;
            } else if (ol.default_enabled !== false) {
              initialToggles[ol.name] = true;
            }
          }
        }

        if (!cancelled) {
          setLayers(layersData);
          setComponents(compData.components);
          setStacks(stacksData);
          setSelectedStackIds(stacksData.map(s => s.id));
          setToggles(initialToggles);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }

    loadAll();
    return () => { cancelled = true; };
  }, []);

  const toggleNames = useMemo(() => (toggles ? Object.keys(toggles) : []), [toggles]);

  const visibleStacks = useMemo(() => {
    if (!selectedStackIds) return [];
    const set = new Set(selectedStackIds);
    return stacks.filter(s => set.has(s.id));
  }, [stacks, selectedStackIds]);

  function handleToggle(name) {
    setToggles(prev => ({ ...prev, [name]: !prev[name] }));
  }

  function handleStackToggle(id) {
    setSelectedStackIds(prev => {
      if (!prev) return prev;
      return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
    });
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#020817',
      color: '#e2e8f0',
      fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid #1e293b',
        background: '#0a0f1a',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <div
          onClick={() => navigate('/')}
          style={{
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            borderRadius: 6,
            padding: '4px 8px',
            cursor: 'pointer',
          }}
        >
          <span style={{
            color: '#fff',
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.05em',
          }}>
            PROTO<span style={{ color: '#a5f3fc' }}>VIZ</span>
          </span>
        </div>
        <span style={{ color: '#334155', fontSize: 12 }}>|</span>
        <span style={{
          background: '#0f172a',
          color: '#3b82f6',
          fontSize: 9,
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 3,
          border: '1px solid #3b82f644',
        }}>
          STACK COMPARE
        </span>
        <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, flex: 1 }}>
          Protocol Stack Comparison
        </span>
        <LanguageSelector />
      </div>

      {/* Body */}
      {loading ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '60vh',
          color: '#475569',
        }}>
          Loading stacks...
        </div>
      ) : error ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '60vh',
          color: '#ef4444',
        }}>
          {error}
        </div>
      ) : (
        <div>
          {/* Stack selector bar */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}>
            <span style={{
              color: '#64748b',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              fontWeight: 700,
            }}>
              Stacks:
            </span>
            {stacks.map(stack => {
              const checked = selectedStackIds?.includes(stack.id) ?? false;
              return (
                <label
                  key={stack.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    fontSize: 11,
                    color: checked ? '#e2e8f0' : '#475569',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleStackToggle(stack.id)}
                    style={{ accentColor: '#3b82f6', width: 13, height: 13 }}
                  />
                  {stack.name}
                </label>
              );
            })}
          </div>

          {/* Optional layer toggle bar */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}>
            <span style={{
              color: '#64748b',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              fontWeight: 700,
            }}>
              Optional Layers:
            </span>
            {toggleNames.map(name => (
              <label
                key={name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  fontSize: 11,
                  color: toggles[name] ? '#e2e8f0' : '#475569',
                }}
              >
                <input
                  type="checkbox"
                  checked={!!toggles[name]}
                  onChange={() => handleToggle(name)}
                  style={{
                    accentColor: '#3b82f6',
                    width: 13,
                    height: 13,
                  }}
                />
                {name}
              </label>
            ))}
          </div>

          {/* Stack grid */}
          <div style={{ padding: '16px 0' }}>
            {visibleStacks.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#475569', padding: 48, fontSize: 12 }}>
                No stacks selected. Pick at least one stack above.
              </div>
            ) : (
              <StackGrid
                stacks={visibleStacks}
                components={components}
                layers={layers}
                enabledToggles={toggles || {}}
              />
            )}
          </div>

          {/* Footer legend */}
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid #1e293b',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            justifyContent: 'center',
          }}>
            {[
              { token: 'nvme', label: 'NVMe' },
              { token: 'scsi', label: 'SCSI' },
              { token: 'tcp', label: 'TCP' },
              { token: 'rdma', label: 'RDMA' },
              { token: 'ip', label: 'IP' },
              { token: 'ethernet', label: 'Ethernet' },
              { token: 'fc', label: 'Fibre Channel' },
              { token: 'phy', label: 'Physical' },
              { token: 'iscsi', label: 'iSCSI/iSER' },
              { token: 'optional', label: 'Optional' },
            ].map(({ token, label }) => {
              const color = token === 'optional' ? '#475569' : (
                { nvme: '#10b981', scsi: '#8b5cf6', tcp: '#3b82f6', rdma: '#a78bfa',
                  ip: '#06b6d4', ethernet: '#64748b', fc: '#ec4899', phy: '#475569',
                  iscsi: '#f59e0b' }[token] || '#64748b'
              );
              return (
                <div key={token} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#94a3b8' }}>
                  <div style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: `${color}44`,
                    border: token === 'optional' ? '1px dashed #475569' : `1px solid ${color}66`,
                  }} />
                  {label}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
