const ACTOR_COLORS = {
  initiator: '#3b82f6',
  switch: '#6b7280',
  target: '#8b5cf6',
};

function getActorSub(actor) {
  return [actor.ip, actor.hw].filter(Boolean).join(' \u2022 ');
}

export default function ActorHeaders({ actors }) {
  return (
    <div className="pvz-actor-headers" style={{ display: 'flex', padding: '6px 0', background: '#0a0f1a', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
      {actors.map(actor => (
        <div key={actor.id} style={{ flex: 1, textAlign: 'center', overflow: 'hidden', padding: '0 4px' }}>
          <div style={{
            color: ACTOR_COLORS[actor.type] || ACTOR_COLORS[actor.id] || '#6b7280',
            fontSize: 11, fontWeight: 700,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{actor.label}</div>
          <div className="pvz-actor-sub" style={{
            color: '#475569', fontSize: 9,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{getActorSub(actor)}</div>
        </div>
      ))}
    </div>
  );
}
