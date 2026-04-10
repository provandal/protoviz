import { useEffect, useMemo, useRef, useState } from 'react';
import { scaleSequential } from 'd3-scale';
import { zoom, zoomIdentity } from 'd3-zoom';
import { select } from 'd3-selection';

// Lean color scale: cool blue (0% util) -> yellow (50%) -> red (100%)
function utilColor(pct) {
  // pct is 0-100
  const p = Math.max(0, Math.min(100, pct)) / 100;
  if (p < 0.5) {
    // blue -> yellow
    const t = p * 2;
    const r = Math.round(59 + (250 - 59) * t);
    const g = Math.round(130 + (204 - 130) * t);
    const b = Math.round(246 + (21 - 246) * t);
    return `rgb(${r},${g},${b})`;
  } else {
    // yellow -> red
    const t = (p - 0.5) * 2;
    const r = Math.round(250 + (239 - 250) * t);
    const g = Math.round(204 + (68 - 204) * t);
    const b = Math.round(21 + (68 - 21) * t);
    return `rgb(${r},${g},${b})`;
  }
}

function queueColor(pct) {
  const p = Math.max(0, Math.min(100, pct)) / 100;
  if (p < 0.3) return '#1e293b';  // idle — dark slate
  if (p < 0.6) return '#3b82f6';  // moderate — blue
  if (p < 0.85) return '#f59e0b'; // building — amber
  return '#ef4444';               // hot — red
}

const NODE_SHAPES = {
  switch: { shape: 'rect', w: 44, h: 28 },
  initiator: { shape: 'circle', r: 14 },
  target: { shape: 'circle', r: 14 },
  storage: { shape: 'rect', w: 44, h: 28 },
};

export default function NetSimTopology({
  topology,
  currentFrame,
  onLinkHover,
  onLinkClick,
  hoveredLinkId,
}) {
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const [viewTransform, setViewTransform] = useState({ k: 1, x: 0, y: 0 });

  // Set up zoom/pan behavior
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = select(svgRef.current);
    const zoomBehavior = zoom()
      .scaleExtent([0.5, 4])
      .on('zoom', (event) => {
        setViewTransform(event.transform);
      });
    svg.call(zoomBehavior);
    // Reset to identity on topology change
    svg.call(zoomBehavior.transform, zoomIdentity);
    return () => {
      svg.on('.zoom', null);
    };
  }, [topology?.id]);

  const linkMap = useMemo(() => {
    if (!currentFrame) return new Map();
    return new Map(currentFrame.links.map((l) => [l.id, l]));
  }, [currentFrame]);

  const nodeMap = useMemo(() => {
    if (!currentFrame) return new Map();
    return new Map(currentFrame.nodes.map((n) => [n.id, n]));
  }, [currentFrame]);

  if (!topology) return null;

  const { nodes, links, width = 900, height = 560 } = topology.topology;
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  // Link stroke width scales with capacity (25G..400G -> 1.5..5 px)
  function linkWidth(capGbps) {
    const t = Math.log2(capGbps / 25) / Math.log2(400 / 25);
    return 1.5 + t * 3.5;
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        width: '100%', height: '100%',
        background: '#020817',
        cursor: 'grab',
      }}
    >
      <g
        ref={gRef}
        transform={`translate(${viewTransform.x},${viewTransform.y}) scale(${viewTransform.k})`}
      >
        {/* Links */}
        {links.map((link) => {
          const src = nodesById.get(link.src);
          const dst = nodesById.get(link.dst);
          if (!src || !dst) return null;
          const state = linkMap.get(link.id);
          const util = state?.util_pct || 0;
          const color = state ? utilColor(util) : '#1e293b';
          const width = linkWidth(link.capacity_gbps);
          const isHovered = hoveredLinkId === link.id;
          const hasPacketScenario = !!link.packet_scenario;

          return (
            <g key={link.id}>
              {/* Invisible wider hit area for hover/click */}
              <line
                x1={src.x} y1={src.y} x2={dst.x} y2={dst.y}
                stroke="transparent"
                strokeWidth={16}
                style={{ cursor: hasPacketScenario ? 'pointer' : 'default' }}
                onMouseEnter={() => onLinkHover && onLinkHover(link, state)}
                onMouseLeave={() => onLinkHover && onLinkHover(null, null)}
                onClick={() => hasPacketScenario && onLinkClick && onLinkClick(link)}
              />
              <line
                x1={src.x} y1={src.y} x2={dst.x} y2={dst.y}
                stroke={color}
                strokeWidth={isHovered ? width + 2 : width}
                strokeLinecap="round"
                style={{
                  transition: 'stroke 0.15s, stroke-width 0.15s',
                  pointerEvents: 'none',
                  opacity: isHovered ? 1 : 0.9,
                }}
              />
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const state = nodeMap.get(node.id);
          const qd = state?.queue_depth_pct || 0;
          const pfcXoff = state?.pfc_xoff === 1;
          const fill = state ? queueColor(qd) : '#1e293b';
          const stroke = pfcXoff ? '#ef4444' : '#475569';
          const strokeWidth = pfcXoff ? 2.5 : 1;
          const shape = NODE_SHAPES[node.type] || NODE_SHAPES.switch;

          return (
            <g key={node.id} transform={`translate(${node.x},${node.y})`}>
              {shape.shape === 'circle' ? (
                <circle
                  r={shape.r}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  style={{ transition: 'fill 0.15s, stroke 0.15s' }}
                />
              ) : (
                <rect
                  x={-shape.w / 2} y={-shape.h / 2}
                  width={shape.w} height={shape.h}
                  rx={4}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  style={{ transition: 'fill 0.15s, stroke 0.15s' }}
                />
              )}
              <text
                y={shape.shape === 'circle' ? shape.r + 14 : shape.h / 2 + 14}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize={11}
                fontWeight={600}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {node.label}
              </text>
              {pfcXoff && (
                <text
                  y={shape.shape === 'circle' ? -shape.r - 6 : -shape.h / 2 - 6}
                  textAnchor="middle"
                  fill="#ef4444"
                  fontSize={9}
                  fontWeight={700}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  PFC XOFF
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
