import { useMemo, useState } from 'react';

/**
 * Color token -> hex mapping (dark theme)
 */
const COLOR_MAP = {
  nvme: '#10b981',
  scsi: '#8b5cf6',
  tcp: '#3b82f6',
  udp: '#0ea5e9',
  ip: '#06b6d4',
  rdma: '#a78bfa',
  iscsi: '#f59e0b',
  ethernet: '#64748b',
  fc: '#ec4899',
  smb: '#f97316',
  nfs: '#84cc16',
  'nfs-aux': '#a3e635',
  http: '#22d3ee',
  phy: '#94a3b8',
  neutral: '#94a3b8',
  optional: '#cbd5e1',
};

const OPTIONAL_BG = '#0f172a';
const OPTIONAL_BORDER = '#64748b';

const STACK_COL_WIDTH = 200;
const LABEL_COL_WIDTH = 110;

function buildComponentMap(components) {
  const map = {};
  if (!components) return map;
  for (const c of components) map[c.id] = c;
  return map;
}

function resolveLayer(stack, layerId, componentMap) {
  if (!stack?.layers?.[layerId]) return [];
  const entry = stack.layers[layerId];
  const items = Array.isArray(entry) ? entry : [entry];
  return items.map(item => {
    const component = componentMap[item.component_id] || { id: item.component_id, name: item.component_id, color: 'neutral' };
    // Per-cell `notes` take precedence; otherwise fall back to the
    // component's vocabulary `definition` so click-expand always has
    // something to show. Annotated components carry the pedagogical
    // explanation in their definition.
    return {
      component,
      notes: item.notes || component.definition || '',
    };
  });
}

function getOptionalsByBand(stack, anchor, band, componentMap) {
  if (!stack?.optional_layers) return [];
  return stack.optional_layers
    .filter(ol => {
      const olAnchor = anchorForPosition(ol.position);
      const olBand = ol.band || ol.name;
      return olAnchor === anchor && olBand === band;
    })
    .map(ol => {
      const compId = ol.name.toLowerCase().replace(/[\s/]+/g, '-');
      const component = componentMap[compId] || { id: compId, name: ol.name, color: 'optional' };
      return { component, notes: ol.description || component.definition || '' };
    });
}

/** Resolve a hex with a 2-char alpha suffix. */
function withAlpha(hex, alpha) {
  return `${hex}${alpha}`;
}

/** Render a single cell — click any sub-block to toggle its description. */
function StackCell({ items, minHeight, isOptionalRow, isInterlayer }) {
  const [expandedIdx, setExpandedIdx] = useState(null);

  if (!items || items.length === 0) {
    // Interlayer rows: stacks without content render NOTHING (no border, no
    // placeholder) — matches the brasstacks reference where the RDMA Verbs
    // band only appears above the columns that use it.
    if (isInterlayer) {
      return (
        <td style={{
          border: 'none',
          padding: 0,
          height: minHeight || 38,
          background: 'transparent',
        }} />
      );
    }
    return (
      <td
        style={{
          border: isOptionalRow ? `1px dashed ${OPTIONAL_BORDER}55` : '1px solid #1e293b',
          padding: 6,
          verticalAlign: 'middle',
          textAlign: 'center',
          height: minHeight || 52,
          background: 'transparent',
        }}
      >
        <span style={{ color: '#334155', fontSize: 10 }}>&mdash;</span>
      </td>
    );
  }

  const cellIsOptional = isOptionalRow || (items.length === 1 && items[0].component.color === 'optional');
  const singleColor = items.length === 1
    ? (COLOR_MAP[items[0].component.color] || COLOR_MAP.neutral)
    : undefined;

  return (
    <td
      style={{
        border: cellIsOptional
          ? `1px dashed ${OPTIONAL_BORDER}`
          : (singleColor ? `1px solid ${withAlpha(singleColor, '88')}` : '1px solid #1e293b'),
        padding: 0,
        verticalAlign: 'middle',
        textAlign: 'center',
        background: cellIsOptional
          ? `${OPTIONAL_BG}cc`
          : (singleColor ? withAlpha(singleColor, '33') : 'transparent'),
        height: minHeight || 52,
      }}
    >
      {items.map((item, idx) => {
        const isOpt = item.component.color === 'optional';
        const c = isOpt ? COLOR_MAP.optional : (COLOR_MAP[item.component.color] || COLOR_MAP.neutral);
        const wrapperStyle = items.length > 1 ? {
          background: isOpt ? 'transparent' : withAlpha(c, '33'),
          borderBottom: idx < items.length - 1 ? `1px solid ${withAlpha(c, '55')}` : 'none',
          padding: '6px 8px',
          cursor: item.notes ? 'pointer' : 'default',
        } : { padding: '6px 8px', cursor: item.notes ? 'pointer' : 'default' };

        const expanded = expandedIdx === idx;
        const handleClick = () => {
          if (!item.notes) return;
          setExpandedIdx(expanded ? null : idx);
        };

        return (
          <div
            key={item.component.id + '-' + idx}
            style={wrapperStyle}
            onClick={handleClick}
            title={item.notes || undefined}
          >
            <div style={{
              color: isOpt ? '#e2e8f0' : c,
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1.3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              letterSpacing: '0.01em',
            }}>
              <span>{item.component.name}</span>
              {item.notes && (
                <span style={{
                  color: '#64748b',
                  fontSize: 9,
                  fontWeight: 400,
                  border: '1px solid #475569',
                  borderRadius: 8,
                  width: 12,
                  height: 12,
                  lineHeight: '11px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  i
                </span>
              )}
            </div>
            {expanded && item.notes && (
              <div style={{
                color: '#cbd5e1',
                fontSize: 10,
                lineHeight: 1.4,
                marginTop: 4,
                padding: '4px 6px',
                background: '#020817cc',
                borderRadius: 3,
                maxWidth: STACK_COL_WIDTH - 24,
                marginLeft: 'auto',
                marginRight: 'auto',
              }}>
                {item.notes}
              </div>
            )}
          </div>
        );
      })}
    </td>
  );
}

function LabelCell({ label, side, minHeight }) {
  return (
    <td
      style={{
        padding: '4px 8px',
        verticalAlign: 'middle',
        textAlign: side === 'left' ? 'right' : 'left',
        color: label ? '#94a3b8' : 'transparent',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        fontWeight: 700,
        whiteSpace: 'nowrap',
        height: minHeight || 52,
      }}
    >
      {label || ''}
    </td>
  );
}

function ColumnHeader({ stack }) {
  const familyColors = {
    'block-nvme': '#10b981',
    'block-scsi': '#8b5cf6',
    file: '#f97316',
    object: '#0e7490',
  };
  const tagColor = familyColors[stack.family] || '#64748b';

  return (
    <div style={{
      background: '#0f172a', border: '1px solid #1e293b',
      borderRadius: 6, padding: '8px 10px', textAlign: 'center',
    }}>
      <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 700 }}>{stack.name}</div>
      <span style={{
        display: 'inline-block', background: `${tagColor}22`, color: tagColor,
        fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
        marginTop: 3, border: `1px solid ${tagColor}44`,
      }}>
        {stack.family}
      </span>
    </div>
  );
}

/*
 * === Row plan ===
 *
 * One row per OSI layer. FC layers align 1:1 with OSI rows:
 *   L1 ↔ FC-0, L2 ↔ FC-1, L3 ↔ FC-2, L4 ↔ FC-3, L5 ↔ FC-4.
 *
 * Optional layers anchor to a base row (`OPTIONAL_POSITIONS` map). Multiple
 * optional layers at the same anchor render as separate rows unless they
 * share a `band` — in which case they collapse onto one row, with each
 * stack contributing its own labeled item.
 *
 * Example: NPIV (FCP) and Network Virtualization (NVMe/TCP, iSER) both
 * anchor at osi-l2 with band="Network Virtualization", so they share a
 * single horizontal row.
 */
const BASE_ROWS = [
  { id: 'osi-l7', osiLabel: 'L7 Application',  fc: 'app',  fcLabel: '' },
  { id: 'osi-l6', osiLabel: 'L6 Presentation', fc: 'ulp',  fcLabel: 'ULP' },
  { id: 'osi-l5', osiLabel: 'L5 Session',      fc: 'fc-4', fcLabel: 'FC-4' },
  // Interlayer between L5 and L4: RDMA Verbs sits here for stacks that use it
  // (NVMe-RDMA, iSER, SMB Direct). Only rendered if at least one visible stack
  // declares this layer key.
  { id: 'rdma-verbs', osiLabel: '', fc: null, fcLabel: '', isInterlayer: true },
  { id: 'osi-l4', osiLabel: 'L4 Transport',    fc: 'fc-3', fcLabel: 'FC-3 Common Svc' },
  { id: 'osi-l3', osiLabel: 'L3 Network',      fc: 'fc-2', fcLabel: 'FC-2 Framing' },
  { id: 'osi-l2', osiLabel: 'L2 Data Link',    fc: 'fc-1', fcLabel: 'FC-1 Encoding' },
  { id: 'osi-l1', osiLabel: 'L1 Physical',     fc: 'fc-0', fcLabel: 'FC-0 Physical' },
];

// Map each `position` string -> the BASE_ROW id it anchors after.
const OPTIONAL_POSITIONS = {
  'between-osi-l7-osi-l6': 'osi-l7',
  'between-osi-l6-osi-l5': 'osi-l6',
  'between-osi-l5-osi-l4': 'osi-l5',
  'between-fc-4-fc-3':     'osi-l5',
  'between-osi-l4-osi-l3': 'osi-l4',
  'between-fc-3-fc-2':     'osi-l4',
  'between-osi-l3-osi-l2': 'osi-l3',
  'between-fc-2-fc-1':     'osi-l3',
  'between-osi-l2-osi-l1': 'osi-l2',
  'between-fc-1-fc-0':     'osi-l2',
};

function anchorForPosition(position) {
  return OPTIONAL_POSITIONS[position] || null;
}

export default function StackGrid({ stacks, components }) {
  const componentMap = useMemo(() => buildComponentMap(components), [components]);
  const osiStacks = useMemo(() => stacks.filter(s => s.alignment === 'osi'), [stacks]);
  const fcStacks = useMemo(() => stacks.filter(s => s.alignment === 'fc'), [stacks]);
  const hasFc = fcStacks.length > 0;

  // Collect optional bands per anchor, in YAML declaration order.
  // Result: { [anchorId]: [bandName1, bandName2, ...] }
  const bandsByAnchor = useMemo(() => {
    const result = {};
    const seen = {};
    for (const stack of stacks) {
      if (!stack.optional_layers) continue;
      for (const ol of stack.optional_layers) {
        if (ol.position === 'inside-fc-2') continue;
        const anchor = anchorForPosition(ol.position);
        if (!anchor) continue;
        const band = ol.band || ol.name;
        const key = `${anchor}::${band}`;
        if (seen[key]) continue;
        seen[key] = true;
        if (!result[anchor]) result[anchor] = [];
        result[anchor].push(band);
      }
    }
    return result;
  }, [stacks]);

  // Filter base rows: hide interlayer rows when no visible stack contributes
  // content for that layer key.
  const visibleBaseRows = useMemo(() => {
    return BASE_ROWS.filter(row => {
      if (!row.isInterlayer) return true;
      return stacks.some(s => s.layers && s.layers[row.id]);
    });
  }, [stacks]);

  // Row plan: base rows with optional rows interleaved after their anchor.
  const rowPlan = useMemo(() => {
    const plan = [];
    for (const baseRow of visibleBaseRows) {
      plan.push({ type: 'main', ...baseRow });
      const bands = bandsByAnchor[baseRow.id] || [];
      for (const band of bands) {
        plan.push({ type: 'optional', anchor: baseRow.id, band });
      }
    }
    return plan;
  }, [bandsByAnchor, visibleBaseRows]);

  const tableRows = useMemo(() => {
    const rows = [];

    rowPlan.forEach((entry, i) => {
      if (entry.type === 'optional') {
        rows.push(renderOptionalRow(entry, componentMap, osiStacks, fcStacks, hasFc, i));
        return;
      }

      const cells = [];
      const rowHeight = entry.isInterlayer ? 38 : 52;
      cells.push(<LabelCell key="ol" label={entry.osiLabel} side="left" minHeight={rowHeight} />);

      for (const stack of osiStacks) {
        cells.push(
          <StackCell
            key={`${stack.id}-${entry.id}`}
            items={resolveLayer(stack, entry.id, componentMap)}
            minHeight={rowHeight}
            isInterlayer={entry.isInterlayer}
          />
        );
      }

      for (const stack of fcStacks) {
        if (entry.fc) {
          let fcItems = resolveLayer(stack, entry.fc, componentMap);
          if (entry.fc === 'fc-2') {
            // Inline FC-SP-3 (and any other inside-fc-2) into the FC-2 cell.
            const inside = (stack.optional_layers || [])
              .filter(ol => ol.position === 'inside-fc-2')
              .map(ol => {
                const compId = ol.name.toLowerCase().replace(/[\s/]+/g, '-');
                const component = componentMap[compId] || { id: compId, name: ol.name, color: 'optional' };
                return { component, notes: ol.description || component.definition || '' };
              });
            fcItems = [...fcItems, ...inside];
          }
          cells.push(
            <StackCell key={`${stack.id}-${entry.fc}`} items={fcItems} minHeight={rowHeight} />
          );
        } else {
          // No FC equivalent at this OSI row (e.g. L7 for some FC stacks, or
          // any interlayer row). Render a borderless blank cell.
          cells.push(
            <td
              key={`${stack.id}-${entry.id}-blank`}
              style={{ border: 'none', padding: 0, height: rowHeight, background: 'transparent' }}
            />
          );
        }
      }

      if (hasFc) {
        cells.push(<LabelCell key={`fl-${i}`} label={entry.fcLabel} side="right" minHeight={rowHeight} />);
      }

      rows.push(<tr key={`main-${i}`}>{cells}</tr>);
    });

    return rows;
  }, [rowPlan, componentMap, osiStacks, fcStacks, hasFc]);

  const tableWidth =
    LABEL_COL_WIDTH +
    (osiStacks.length + fcStacks.length) * STACK_COL_WIDTH +
    (hasFc ? LABEL_COL_WIDTH : 0);

  return (
    <div style={{ overflowX: 'auto', padding: '0 16px 16px' }}>
      <div style={{ width: tableWidth, margin: '0 auto' }}>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: tableWidth }}>
          <colgroup>
            <col style={{ width: LABEL_COL_WIDTH }} />
            {osiStacks.map(s => <col key={s.id} style={{ width: STACK_COL_WIDTH }} />)}
            {fcStacks.map(s => <col key={s.id} style={{ width: STACK_COL_WIDTH }} />)}
            {hasFc && <col style={{ width: LABEL_COL_WIDTH }} />}
          </colgroup>
          <thead>
            <tr>
              <th />
              {[...osiStacks, ...fcStacks].map(s => (
                <th key={s.id} style={{ padding: '0 4px 8px', verticalAlign: 'bottom' }}>
                  <ColumnHeader stack={s} />
                </th>
              ))}
              {hasFc && <th />}
            </tr>
          </thead>
          <tbody>{tableRows}</tbody>
        </table>
      </div>
    </div>
  );
}

function renderOptionalRow(entry, componentMap, osiStacks, fcStacks, hasFc, idx) {
  const cells = [];

  cells.push(
    <td key="ol" style={{
      padding: '4px 8px', verticalAlign: 'middle', textAlign: 'right',
      color: '#475569', fontSize: 9, fontStyle: 'italic', height: 38,
    }}>
      optional
    </td>
  );

  for (const stack of osiStacks) {
    const items = getOptionalsByBand(stack, entry.anchor, entry.band, componentMap);
    cells.push(
      <StackCell key={`${stack.id}-opt`} items={items} minHeight={38} isOptionalRow />
    );
  }

  for (const stack of fcStacks) {
    const items = getOptionalsByBand(stack, entry.anchor, entry.band, componentMap);
    cells.push(
      <StackCell key={`${stack.id}-opt`} items={items} minHeight={38} isOptionalRow />
    );
  }

  if (hasFc) {
    cells.push(
      <td key="fl" style={{
        padding: '4px 8px', verticalAlign: 'middle', textAlign: 'left',
        color: '#475569', fontSize: 9, fontStyle: 'italic', height: 38,
      }}>
        optional
      </td>
    );
  }

  return (
    <tr key={`opt-${idx}`} style={{ background: '#0f172a44' }}>
      {cells}
    </tr>
  );
}
