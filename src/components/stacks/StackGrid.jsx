import { useMemo } from 'react';

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
  phy: '#475569',
  neutral: '#334155',
  optional: '#1e293b',
};

/**
 * Build a component lookup map from the components array.
 */
function buildComponentMap(components) {
  const map = {};
  if (!components) return map;
  for (const c of components) {
    map[c.id] = c;
  }
  return map;
}

/**
 * Resolve what a stack has at a given layer id.
 * Returns an array of { component, notes } objects (may be empty).
 */
function resolveLayer(stack, layerId, componentMap) {
  if (!stack?.layers?.[layerId]) return [];
  const entry = stack.layers[layerId];
  const items = Array.isArray(entry) ? entry : [entry];
  return items.map(item => ({
    component: componentMap[item.component_id] || { id: item.component_id, name: item.component_id, color: 'neutral' },
    notes: item.notes || '',
  }));
}

/**
 * Get optional layer items for a stack at a given position.
 */
function getOptionalAtPosition(stack, position, componentMap, enabledToggles) {
  if (!stack?.optional_layers) return [];
  return stack.optional_layers
    .filter(ol => ol.position === position && enabledToggles[ol.name])
    .map(ol => {
      const compId = ol.name.toLowerCase().replace(/[\s/]+/g, '-');
      const component = componentMap[compId] || { id: compId, name: ol.name, color: 'optional' };
      return { component, notes: ol.description || '' };
    });
}

/** Render a single cell */
function StackCell({ items, rowSpan, minHeight }) {
  if (!items || items.length === 0) {
    return (
      <td
        rowSpan={rowSpan || 1}
        style={{
          border: '1px solid #1e293b',
          padding: 6,
          verticalAlign: 'middle',
          textAlign: 'center',
          height: minHeight || 48,
          background: 'transparent',
        }}
      >
        <span style={{ color: '#334155', fontSize: 10 }}>&mdash;</span>
      </td>
    );
  }

  const singleColor = items.length === 1
    ? (COLOR_MAP[items[0].component.color] || COLOR_MAP.neutral)
    : undefined;
  const isOpt = items.length === 1 && items[0].component.color === 'optional';

  return (
    <td
      rowSpan={rowSpan || 1}
      style={{
        border: isOpt ? '1px dashed #475569' : '1px solid #1e293b',
        padding: 0,
        verticalAlign: 'middle',
        textAlign: 'center',
        background: singleColor ? `${singleColor}22` : 'transparent',
        height: minHeight || 48,
      }}
    >
      {items.map((item, idx) => {
        const c = COLOR_MAP[item.component.color] || COLOR_MAP.neutral;
        const style = items.length > 1 ? {
          background: `${c}22`,
          borderBottom: idx < items.length - 1 ? '1px solid #1e293b' : 'none',
          padding: '6px 8px',
        } : { padding: '6px 8px' };

        return (
          <div key={item.component.id + '-' + idx} style={style}>
            <div style={{ color: c, fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>
              {item.component.name}
            </div>
            {item.notes && (
              <div style={{
                color: '#94a3b8', fontSize: 9, lineHeight: 1.3,
                marginTop: 2, maxWidth: 180, marginLeft: 'auto', marginRight: 'auto',
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

/** Label cell */
function LabelCell({ label, rowSpan, side }) {
  return (
    <td
      rowSpan={rowSpan || 1}
      style={{
        padding: '4px 8px',
        verticalAlign: 'middle',
        textAlign: side === 'left' ? 'right' : 'left',
        color: label ? '#64748b' : 'transparent',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        minWidth: 90,
        height: 48,
      }}
    >
      {label || ''}
    </td>
  );
}

/** Column header above each stack */
function ColumnHeader({ stack }) {
  const familyColors = {
    'block-nvme': '#10b981',
    'block-scsi': '#8b5cf6',
    file: '#f97316',
  };
  const tagColor = familyColors[stack.family] || '#64748b';

  return (
    <div style={{
      background: '#0f172a', border: '1px solid #1e293b',
      borderRadius: 6, padding: '8px 12px', textAlign: 'center',
    }}>
      <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 700 }}>{stack.name}</div>
      <span style={{
        display: 'inline-block', background: `${tagColor}22`, color: tagColor,
        fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
        marginTop: 3, border: `1px solid ${tagColor}44`,
      }}>
        {stack.family}
      </span>
      {stack.summary && (
        <div style={{ color: '#64748b', fontSize: 9, marginTop: 4, lineHeight: 1.3 }}>
          {stack.summary.length > 80 ? stack.summary.slice(0, 80).trim() + '...' : stack.summary}
        </div>
      )}
    </div>
  );
}

/*
 * === Row plan ===
 *
 * We build a flat array of "row descriptors" that the renderer walks through.
 * Each descriptor says what to render in the OSI-label, each OSI-stack column,
 * each FC-stack column, and the FC-label.
 *
 * The tricky part is FC-2 spanning osi-l4/l3/l2 and optional rows that can
 * appear between any two layers. We handle this by:
 *   1) Building the row plan (including optional inserts)
 *   2) Counting how many rows FC-2 must span (base 3 + any optional rows
 *      inserted within that range)
 *   3) Only emitting the FC-stack td on the first row of the span
 */

// Canonical row ordering. "fc" field indicates which FC layer aligns here.
const BASE_ROWS = [
  { id: 'osi-l7', osiLabel: 'L7 Application',  fc: 'fc-4', fcLabel: 'FC-4 ULP' },
  // optional: between-fc-4-fc-3 (= between-osi-l7-osi-l6 effectively)
  { id: 'osi-l6', osiLabel: 'L6 Presentation', fc: null,   fcLabel: '' },
  { id: 'osi-l5', osiLabel: 'L5 Session',      fc: 'fc-3', fcLabel: 'FC-3 Common Svc' },
  { id: 'osi-l4', osiLabel: 'L4 Transport',    fc: 'fc-2-start', fcLabel: 'FC-2 Framing' },
  { id: 'osi-l3', osiLabel: 'L3 Network',      fc: 'fc-2-cont',  fcLabel: '' },
  { id: 'osi-l2', osiLabel: 'L2 Data Link',    fc: 'fc-2-end',   fcLabel: '' },
  // optional: between-fc-2-fc-1 / between-osi-l2-osi-l1
  { id: 'osi-l1', osiLabel: 'L1 Physical',     fc: 'fc-phys', fcLabel: 'FC-1/FC-0 Phys' },
];

// Map from optional_layer position strings to where they should be inserted.
// Key = position string from YAML, Value = { after: row-id } meaning insert
// after that base row in the plan.
const OPTIONAL_POSITIONS = {
  'between-fc-4-fc-3':   { after: 'osi-l7' },
  'between-osi-l7-osi-l6': { after: 'osi-l7' },
  'between-osi-l5-osi-l4': { after: 'osi-l5' },
  'between-osi-l4-osi-l3': { after: 'osi-l4' },
  'between-osi-l3-osi-l2': { after: 'osi-l3' },
  'between-osi-l2-osi-l1': { after: 'osi-l2' },
  'between-fc-2-fc-1':     { after: 'osi-l2' },
};

export default function StackGrid({ stacks, components, layers, enabledToggles }) {
  const componentMap = useMemo(() => buildComponentMap(components), [components]);
  const osiStacks = useMemo(() => stacks.filter(s => s.alignment === 'osi'), [stacks]);
  const fcStacks = useMemo(() => stacks.filter(s => s.alignment === 'fc'), [stacks]);
  const hasFc = fcStacks.length > 0;

  // Collect all active optional positions
  const activePositions = useMemo(() => {
    const set = new Set();
    for (const stack of stacks) {
      if (!stack.optional_layers) continue;
      for (const ol of stack.optional_layers) {
        if (enabledToggles[ol.name]) set.add(ol.position);
      }
    }
    return set;
  }, [stacks, enabledToggles]);

  // Build the row plan: base rows with optional rows interleaved
  const rowPlan = useMemo(() => {
    const plan = [];
    for (const baseRow of BASE_ROWS) {
      plan.push({ type: 'main', ...baseRow });

      // Check if any optional position should be inserted after this row
      for (const [pos, mapping] of Object.entries(OPTIONAL_POSITIONS)) {
        if (mapping.after === baseRow.id && activePositions.has(pos)) {
          // Determine if this optional row falls within the FC-2 span range
          const inFc2Span = (
            baseRow.id === 'osi-l4' || baseRow.id === 'osi-l3' || baseRow.id === 'osi-l2'
          );
          plan.push({
            type: 'optional',
            position: pos,
            inFc2Span,
          });
        }
      }
    }
    return plan;
  }, [activePositions]);

  // Calculate FC-2 rowSpan: count all rows from fc-2-start through fc-2-end
  // plus any optional rows inserted in between
  const fc2RowSpan = useMemo(() => {
    let count = 0;
    let inSpan = false;
    for (const row of rowPlan) {
      if (row.type === 'main' && row.fc === 'fc-2-start') inSpan = true;
      if (inSpan) count++;
      if (row.type === 'main' && row.fc === 'fc-2-end') break;
    }
    return count;
  }, [rowPlan]);

  // Same for FC label rowSpan
  const fcLabelRowSpan = fc2RowSpan;

  // Render rows
  const tableRows = useMemo(() => {
    const rows = [];

    for (let i = 0; i < rowPlan.length; i++) {
      const entry = rowPlan[i];

      if (entry.type === 'optional') {
        rows.push(renderOptionalRow(entry, componentMap, osiStacks, fcStacks, enabledToggles, hasFc, entry.inFc2Span, i));
        continue;
      }

      // Main row
      const cells = [];

      // 1. OSI label
      cells.push(<LabelCell key="ol" label={entry.osiLabel} side="left" />);

      // 2. OSI stack cells
      for (const stack of osiStacks) {
        cells.push(
          <StackCell
            key={`${stack.id}-${entry.id}`}
            items={resolveLayer(stack, entry.id, componentMap)}
          />
        );
      }

      // 3. FC stack cells
      for (const stack of fcStacks) {
        if (entry.fc === 'fc-4') {
          cells.push(
            <StackCell key={`${stack.id}-fc4`} items={resolveLayer(stack, 'fc-4', componentMap)} />
          );
        } else if (entry.fc === 'fc-3') {
          cells.push(
            <StackCell key={`${stack.id}-fc3`} items={resolveLayer(stack, 'fc-3', componentMap)} />
          );
        } else if (entry.fc === 'fc-2-start') {
          // Emit FC-2 spanning cell
          cells.push(
            <StackCell
              key={`${stack.id}-fc2`}
              items={resolveLayer(stack, 'fc-2', componentMap)}
              rowSpan={fc2RowSpan}
              minHeight={48 * 3}
            />
          );
        } else if (entry.fc === 'fc-2-cont' || entry.fc === 'fc-2-end') {
          // Covered by rowSpan — emit nothing for FC columns
        } else if (entry.fc === 'fc-phys') {
          // FC-1 + FC-0 stacked
          const fc1 = resolveLayer(stack, 'fc-1', componentMap);
          const fc0 = resolveLayer(stack, 'fc-0', componentMap);
          cells.push(
            <StackCell key={`${stack.id}-fcphys`} items={[...fc1, ...fc0]} />
          );
        } else {
          // No FC equivalent (e.g. osi-l6)
          cells.push(
            <StackCell key={`${stack.id}-${entry.id}-empty`} items={[]} />
          );
        }
      }

      // 4. FC label
      if (hasFc) {
        if (entry.fc === 'fc-2-start') {
          cells.push(<LabelCell key="fl" label={entry.fcLabel} side="right" rowSpan={fcLabelRowSpan} />);
        } else if (entry.fc === 'fc-2-cont' || entry.fc === 'fc-2-end') {
          // Covered by rowSpan
        } else {
          cells.push(<LabelCell key={`fl-${i}`} label={entry.fcLabel} side="right" />);
        }
      }

      rows.push(<tr key={`main-${i}`}>{cells}</tr>);
    }

    return rows;
  }, [rowPlan, componentMap, osiStacks, fcStacks, hasFc, enabledToggles, fc2RowSpan, fcLabelRowSpan]);

  return (
    <div style={{ overflowX: 'auto', padding: '0 16px 16px' }}>
      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `100px ${osiStacks.map(() => '1fr').join(' ')} ${hasFc ? fcStacks.map(() => '1fr').join(' ') : ''} ${hasFc ? '100px' : ''}`,
        gap: 8, marginBottom: 8,
      }}>
        <div />
        {osiStacks.map(s => <ColumnHeader key={s.id} stack={s} />)}
        {fcStacks.map(s => <ColumnHeader key={s.id} stack={s} />)}
        {hasFc && <div />}
      </div>

      {/* Grid table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 100 }} />
          {osiStacks.map(s => <col key={s.id} style={{ minWidth: 160 }} />)}
          {fcStacks.map(s => <col key={s.id} style={{ minWidth: 160 }} />)}
          {hasFc && <col style={{ width: 100 }} />}
        </colgroup>
        <tbody>{tableRows}</tbody>
      </table>
    </div>
  );
}

function renderOptionalRow(entry, componentMap, osiStacks, fcStacks, enabledToggles, hasFc, inFc2Span, idx) {
  const cells = [];

  // OSI label
  cells.push(
    <td key="ol" style={{
      padding: '4px 8px', verticalAlign: 'middle', textAlign: 'right',
      color: '#475569', fontSize: 9, fontStyle: 'italic', height: 36,
    }}>
      optional
    </td>
  );

  // OSI stacks
  for (const stack of osiStacks) {
    const items = getOptionalAtPosition(stack, entry.position, componentMap, enabledToggles);
    cells.push(<StackCell key={`${stack.id}-opt`} items={items} minHeight={36} />);
  }

  // FC stacks — only emit a cell if NOT inside the FC-2 span (which is already
  // covered by the rowSpan from the fc-2-start row)
  if (!inFc2Span) {
    for (const stack of fcStacks) {
      const items = getOptionalAtPosition(stack, entry.position, componentMap, enabledToggles);
      cells.push(<StackCell key={`${stack.id}-opt`} items={items} minHeight={36} />);
    }
  }

  // FC label — only emit if NOT inside FC-2 span
  if (hasFc && !inFc2Span) {
    cells.push(
      <td key="fl" style={{
        padding: '4px 8px', verticalAlign: 'middle', textAlign: 'left',
        color: '#475569', fontSize: 9, fontStyle: 'italic', height: 36,
      }}>
        optional
      </td>
    );
  }

  return (
    <tr key={`opt-${idx}`} style={{ background: '#0f172a33' }}>
      {cells}
    </tr>
  );
}
