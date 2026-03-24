import { useTranslation } from 'react-i18next';
import HeaderBlock from './HeaderBlock';
import useViewerStore from '../../store/viewerStore';

/**
 * Build a header tree from the flat (descending-sorted) header list.
 *
 * Split headers into contiguous groups (adjacent layers differ by ≤ 1).
 * When a layer gap > 1 separates groups, the upper group becomes payload
 * (children) of the first header in the next lower group.
 */
function buildHeaderTree(headers) {
  if (!headers || headers.length === 0) return [];

  // Split into groups at layer gaps > 1
  const groups = [[]];
  for (let i = 0; i < headers.length; i++) {
    groups[groups.length - 1].push(headers[i]);
    if (i + 1 < headers.length && headers[i].layer - headers[i + 1].layer > 1) {
      groups.push([]);
    }
  }

  // No gaps — all flat wire headers
  if (groups.length === 1) return groups[0];

  // Merge top-down: each upper group nests as children of the first
  // header in the group immediately below it
  for (let g = 0; g < groups.length - 1; g++) {
    const target = groups[g + 1][0];
    groups[g + 1][0] = { ...target, children: [...groups[g], ...(target.children || [])] };
  }

  return groups[groups.length - 1];
}

export default function PacketInspector({ event }) {
  const { t } = useTranslation();
  const highlightFields = useViewerStore(s => s.highlightFields);
  if (!event?.frame) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#334155', fontSize: 12,
        fontStyle: 'italic',
      }}>
        {t('inspector.noPacketData')}
      </div>
    );
  }

  const headerTree = buildHeaderTree(event.frame.headers);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header bar */}
      <div style={{
        padding: '6px 12px', background: '#0f172a', borderBottom: '1px solid #1e293b',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{ color: '#3b82f6', fontSize: 11, fontWeight: 800 }}>{t('inspector.title')}</span>
        <span style={{ color: '#475569', fontSize: 11 }}>—</span>
        <span style={{ color: '#e2e8f0', fontSize: 11 }}>{event.frame.name}</span>
        <span style={{ background: '#1e293b', color: '#94a3b8', fontSize: 9, padding: '1px 6px', borderRadius: 3 }}>{t('viewer.bytesTotal', { count: event.frame.bytes })}</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: '#475569', fontSize: 9 }}>{t('inspector.clickToExpand')}</span>
      </div>

      {/* Header blocks */}
      <div style={{ overflowY: 'auto', flex: 1, padding: 8 }}>
        {headerTree.map((h, i) => <HeaderBlock key={i} hdr={h} highlightFields={highlightFields} />)}
      </div>
    </div>
  );
}
