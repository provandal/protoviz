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
    <div style={{ display: 'flex', padding: '6px 0', background: '#0a0f1a', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
      {actors.map(actor => (
        <div key={actor.id} style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ color: ACTOR_COLORS[actor.type] || ACTOR_COLORS[actor.id] || '#6b7280', fontSize: 11, fontWeight: 700 }}>{actor.label}</div>
          <div style={{ color: '#475569', fontSize: 9 }}>{getActorSub(actor)}</div>
        </div>
      ))}
    </div>
  );
}
