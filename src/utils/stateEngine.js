export function applyStateDelta(current, delta) {
  if (!delta) return current;
  return current.map(layer => {
    const d = delta[layer.layer];
    if (!d) return layer;
    return { ...layer, fields: { ...layer.fields, ...d } };
  });
}

export function buildStateAtStep(scenario, actorId, stepIdx) {
  if (!scenario.osi_layers[actorId]) return [];
  let layers = [...scenario.osi_layers[actorId]].map(l => ({ ...l, fields: { ...l.fields } }));
  for (let i = 0; i <= stepIdx; i++) {
    const ev = scenario.timeline[i];
    if (ev.state && ev.state[actorId]) {
      layers = applyStateDelta(layers, ev.state[actorId]);
    }
  }
  return layers;
}
