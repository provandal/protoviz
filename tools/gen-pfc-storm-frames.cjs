// Hand-crafted PFC Storm frame data generator.
// Produces realistic-looking frames for both variants while we're waiting on ns-3.
// Will be replaced by tools/ns3/scenarios/pfc_storm.cc output once ns-3 is set up.

const fs = require('fs');
const path = require('path');

const OUTDIR = path.join(__dirname, '..', 'public', 'netsim', 'pfc-storm');

const LINKS = [
  'l_core1_agg1', 'l_core1_agg2', 'l_core2_agg1', 'l_core2_agg2',
  'l_agg1_edge1', 'l_agg1_edge2', 'l_agg2_edge3', 'l_agg2_edge4',
  'l_edge1_s1', 'l_edge1_s2', 'l_edge2_s3', 'l_edge2_s4',
  'l_edge3_s5', 'l_edge3_s6', 'l_edge4_s7', 'l_edge4_slow',
];

const LINK_CAP = {
  l_core1_agg1: 400, l_core1_agg2: 400, l_core2_agg1: 400, l_core2_agg2: 400,
  l_agg1_edge1: 200, l_agg1_edge2: 200, l_agg2_edge3: 200, l_agg2_edge4: 200,
  l_edge1_s1: 100, l_edge1_s2: 100, l_edge2_s3: 100, l_edge2_s4: 100,
  l_edge3_s5: 100, l_edge3_s6: 100, l_edge4_s7: 100, l_edge4_slow: 100,
};

const NODES = [
  'core1', 'core2', 'agg1', 'agg2',
  'edge1', 'edge2', 'edge3', 'edge4',
  's1', 's2', 's3', 's4', 's5', 's6', 's7', 'slow',
];

function smooth(t, start, end) {
  if (t <= start) return 0;
  if (t >= end) return 1;
  const x = (t - start) / (end - start);
  return x * x * (3 - 2 * x);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function jitter(seed, amount) {
  const h = (seed * 2654435761) % 2147483647;
  return ((h / 2147483647) - 0.5) * 2 * amount;
}

function makeFrame(tMs, variant) {
  const t = tMs / 1000;
  const pfcOn = variant === 'pfc_enabled';

  const baseline = smooth(t, 0, 0.8);
  const slowReceiverActive = smooth(t, 3.0, 3.5);
  const pfcXoffAgg2 = smooth(t, 4.5, 5.0);
  const pfcXoffCore = smooth(t, 6.0, 6.8);
  const innocentStarved = smooth(t, 8.0, 9.0);
  const recovery = smooth(t, 12.0, 13.5);
  const postRecovery = smooth(t, 13.5, 14.5);

  const links = LINKS.map((id) => {
    let util = 0;
    let drops = 0;
    let pfcPauses = 0;

    let linkType = 'core';
    if (id.startsWith('l_agg')) linkType = 'agg';
    else if (id === 'l_edge4_slow') linkType = 'edge_slow';
    else if (id.startsWith('l_edge')) linkType = 'edge_server';

    const baseUtil = {
      core: 0.35, agg: 0.45, edge_server: 0.50, edge_slow: 0.50,
    }[linkType];

    util = baseUtil * baseline;

    if (linkType === 'edge_slow') {
      if (pfcOn) {
        util = util * (1 - 0.9 * slowReceiverActive) * (1 - 0.8 * recovery) + postRecovery * baseUtil * 0.95;
        pfcPauses = Math.round(120 * slowReceiverActive * (1 - recovery));
      } else {
        util = clamp(util + 0.4 * slowReceiverActive - 0.3 * recovery, 0, 1);
        drops = Math.round(800 * slowReceiverActive * (1 - recovery));
      }
    } else if (id === 'l_agg2_edge4') {
      if (pfcOn) {
        util = util * (1 - 0.85 * pfcXoffAgg2) + postRecovery * baseUtil * 0.95;
        pfcPauses = Math.round(95 * pfcXoffAgg2 * (1 - recovery));
      } else {
        util = clamp(util + 0.3 * slowReceiverActive - 0.25 * recovery, 0, 1);
        drops = Math.round(300 * slowReceiverActive * (1 - recovery));
      }
    } else if (id.startsWith('l_core')) {
      if (pfcOn) {
        if (id.includes('agg2')) {
          util = util * (1 - 0.75 * pfcXoffCore) + postRecovery * baseUtil * 0.95;
          pfcPauses = Math.round(70 * pfcXoffCore * (1 - recovery));
        } else {
          util = util * (1 - 0.35 * pfcXoffCore) + postRecovery * baseUtil * 0.95;
          pfcPauses = Math.round(30 * pfcXoffCore * (1 - recovery));
        }
      } else {
        util = clamp(util + 0.1 * slowReceiverActive, 0, 0.85);
      }
    } else if (id === 'l_agg1_edge1' || id === 'l_agg1_edge2') {
      if (pfcOn) {
        util = util * (1 - 0.7 * innocentStarved) + postRecovery * baseUtil * 0.95;
      } else {
        util = util * (1 - 0.2 * slowReceiverActive) + postRecovery * baseUtil * 0.95;
      }
    } else if (id === 'l_agg2_edge3') {
      if (pfcOn) {
        util = util * (1 - 0.7 * innocentStarved) + postRecovery * baseUtil * 0.95;
      } else {
        util = util * (1 - 0.2 * slowReceiverActive) + postRecovery * baseUtil * 0.95;
      }
    } else if (id.startsWith('l_edge1_') || id.startsWith('l_edge2_')) {
      if (pfcOn) {
        util = util * (1 - 0.6 * innocentStarved) + postRecovery * baseUtil * 0.95;
      }
    } else if (id.startsWith('l_edge3_') || id === 'l_edge4_s7') {
      if (pfcOn) {
        util = util * (1 - 0.65 * innocentStarved) + postRecovery * baseUtil * 0.95;
      } else {
        util = util * (1 - 0.15 * slowReceiverActive) + postRecovery * baseUtil * 0.95;
      }
    }

    util = clamp(util + jitter(tMs * 31 + id.length, 0.03), 0, 1);
    const throughput = util * LINK_CAP[id];

    return {
      id,
      util_pct: Math.round(util * 10000) / 100,
      throughput_gbps: Math.round(throughput * 100) / 100,
      drops,
      pfc_pauses: pfcPauses,
    };
  });

  const nodes = NODES.map((id) => {
    let queueDepth = 0;
    let pfcXoff = 0;

    if (id === 'edge4') {
      queueDepth = (pfcOn ? 95 : 80) * slowReceiverActive * (1 - recovery);
      pfcXoff = pfcOn && slowReceiverActive > 0.5 ? 1 : 0;
    } else if (id === 'agg2') {
      queueDepth = (pfcOn ? 85 : 60) * (pfcOn ? pfcXoffAgg2 : slowReceiverActive) * (1 - recovery);
      pfcXoff = pfcOn && pfcXoffAgg2 > 0.5 ? 1 : 0;
    } else if (id === 'core1' || id === 'core2') {
      queueDepth = (pfcOn ? 70 : 40) * (pfcOn ? pfcXoffCore : slowReceiverActive) * (1 - recovery);
      pfcXoff = pfcOn && pfcXoffCore > 0.5 ? 1 : 0;
    } else if (id === 'agg1') {
      queueDepth = (pfcOn ? 30 : 20) * (pfcOn ? innocentStarved : slowReceiverActive) * (1 - recovery);
    } else if (id.startsWith('edge')) {
      queueDepth = 15 * baseline * (1 - 0.3 * recovery);
    } else {
      queueDepth = 10 * baseline;
    }

    queueDepth = clamp(queueDepth + jitter(tMs * 13 + id.length, 2), 0, 100);

    return {
      id,
      queue_depth_pct: Math.round(queueDepth * 100) / 100,
      pfc_xoff: pfcXoff,
    };
  });

  const flows = [
    { id: 'f1', src: 's1', dst: 'slow', protocol: 'roce-v2', path: ['s1','edge1','agg1','core1','agg2','edge4','slow'] },
    { id: 'f2', src: 's2', dst: 'slow', protocol: 'roce-v2', path: ['s2','edge1','agg1','core1','agg2','edge4','slow'] },
    { id: 'f3', src: 's3', dst: 's5',  protocol: 'roce-v2', path: ['s3','edge2','agg1','core2','agg2','edge3','s5'] },
    { id: 'f4', src: 's4', dst: 's6',  protocol: 'roce-v2', path: ['s4','edge2','agg1','core1','agg2','edge3','s6'] },
    { id: 'f5', src: 's7', dst: 's1',  protocol: 'roce-v2', path: ['s7','edge4','agg2','core2','agg1','edge1','s1'] },
  ].map((f) => {
    let tp = 80 * baseline;
    if (f.dst === 'slow') {
      tp = pfcOn ? tp * (1 - 0.95 * slowReceiverActive) : tp * (1 - 0.8 * slowReceiverActive);
    } else if (f.src === 's3' || f.src === 's4' || f.src === 's7') {
      tp = pfcOn ? tp * (1 - 0.7 * innocentStarved) : tp * (1 - 0.2 * slowReceiverActive);
    }
    tp = clamp(tp + postRecovery * 78 * (f.dst === 'slow' ? 0.2 : 1.0) + jitter(tMs + f.id.length, 3), 0, 100);
    return { ...f, throughput_gbps: Math.round(tp * 100) / 100 };
  });

  return { t_ms: tMs, links, flows, nodes };
}

function generate(variant) {
  const frames = [];
  for (let tMs = 0; tMs <= 15000; tMs += 100) {
    frames.push(makeFrame(tMs, variant));
  }
  return { interval_ms: 100, frames };
}

const enabled = generate('pfc_enabled');
const disabled = generate('pfc_disabled');

fs.writeFileSync(path.join(OUTDIR, 'frames_pfc_enabled.json'), JSON.stringify(enabled));
fs.writeFileSync(path.join(OUTDIR, 'frames_pfc_disabled.json'), JSON.stringify(disabled));

console.log('Written:');
console.log('  frames_pfc_enabled.json:', (fs.statSync(path.join(OUTDIR, 'frames_pfc_enabled.json')).size / 1024).toFixed(1), 'KB');
console.log('  frames_pfc_disabled.json:', (fs.statSync(path.join(OUTDIR, 'frames_pfc_disabled.json')).size / 1024).toFixed(1), 'KB');
console.log('Frame counts:', enabled.frames.length, 'each');
