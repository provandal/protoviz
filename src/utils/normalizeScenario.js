import { L_COLOR, PHASE_COLORS } from './constants';

/**
 * Normalizes a parsed YAML scenario (schema format) into the viewer's internal format.
 *
 * Key transforms:
 *   - topology.actors[] → actors[] (position→pos, hardware→hw)
 *   - osi_layers state_schema.*.initial → fields{}, adds color
 *   - frames[] library + frame_id refs → inline frame on timeline events
 *   - state_after[{actor_id, layers}] → state{actorId: {layerNum: fields}}
 *   - annotation.text/detail → label/detail
 *   - spec_refs→spec, kernel_ref→kernel, description→desc
 *   - Phase inferred from annotation text + event ID
 */
export function normalizeScenario(raw) {
  const frameMap = {};
  for (const frame of raw.frames || []) {
    frameMap[frame.id] = frame;
  }

  const actors = normalizeActors(raw.topology?.actors || []);
  const actorIds = new Set(actors.map(a => a.id));
  const endpointIds = actors.filter(a => a.type !== 'switch').map(a => a.id);

  const osiLayers = normalizeOsiLayers(raw.osi_layers || {});

  let lastPhase = null;
  const timeline = (raw.timeline || []).map((ev, idx) => {
    const phase = inferPhase(ev, lastPhase);
    lastPhase = phase;
    return normalizeTimelineEvent(ev, idx, phase, frameMap, endpointIds);
  });

  const meta = {
    title: raw.meta.title,
    protocol: raw.meta.protocol,
    description: typeof raw.meta.description === 'string'
      ? raw.meta.description.trim()
      : raw.meta.description,
    difficulty: raw.meta.difficulty,
    tags: raw.meta.tags || [],
  };

  return { meta, actors, osi_layers: osiLayers, timeline };
}

function normalizeActors(rawActors) {
  return rawActors.map(a => ({
    id: a.id,
    label: a.label,
    type: a.type,
    ip: a.ip,
    mac: a.mac,
    hw: a.hardware,
    pos: a.position,
  }));
}

function normalizeOsiLayers(rawLayers) {
  const result = {};
  for (const [actorId, layers] of Object.entries(rawLayers)) {
    result[actorId] = layers.map(l => ({
      layer: l.layer,
      name: l.name,
      color: L_COLOR[l.layer] || '#475569',
      fields: extractInitialValues(l.state_schema),
    }));
  }
  return result;
}

function extractInitialValues(stateSchema) {
  const fields = {};
  if (!stateSchema) return fields;
  for (const [key, def] of Object.entries(stateSchema)) {
    fields[key] = def.initial !== undefined ? def.initial : null;
  }
  return fields;
}

function normalizeTimelineEvent(ev, idx, phase, frameMap, endpointIds) {
  const normalized = {
    id: ev.id,
    t: idx,
    phase,
    type: ev.type,
    label: ev.annotation?.text || ev.id,
    detail: typeof ev.annotation?.detail === 'string'
      ? ev.annotation.detail.trim()
      : (ev.annotation?.detail || ''),
    color: PHASE_COLORS[phase] || '#475569',
  };

  // For frame_tx, resolve frame reference and copy from/to/via
  if (ev.type === 'frame_tx' && ev.frame_id) {
    const frame = frameMap[ev.frame_id];
    if (frame) {
      // Resolve "broadcast" to the first endpoint that isn't the sender
      let to = frame.to;
      if (to === 'broadcast') {
        to = endpointIds.find(id => id !== frame.from) || frame.to;
      }

      normalized.from = frame.from;
      normalized.to = to;
      normalized.via = frame.via || [];
      normalized.color = frame.color || normalized.color;
      normalized.frame = {
        name: frame.name,
        bytes: frame.total_bytes,
        headers: (frame.headers || []).map(normalizeHeader),
      };
    }
  }

  // State delta: state_after[{actor_id, layers}] → state{actorId: {layerNum: fields}}
  if (ev.state_after && ev.state_after.length > 0) {
    normalized.state = {};
    for (const snap of ev.state_after) {
      normalized.state[snap.actor_id] = {};
      for (const layer of snap.layers) {
        if (layer.state_fields) {
          normalized.state[snap.actor_id][layer.layer] = { ...layer.state_fields };
        }
      }
    }
  }

  return normalized;
}

function normalizeHeader(hdr) {
  return {
    name: hdr.name,
    layer: hdr.layer,
    fields: (hdr.fields || []).map(normalizeField),
  };
}

function normalizeField(field) {
  const f = {
    name: field.name,
    abbrev: field.abbrev,
    bits: field.bits,
    value: field.value,
    desc: field.description || '',
  };

  if (field.spec_refs && field.spec_refs.length > 0) {
    f.spec = field.spec_refs.map(s => ({
      doc: s.document,
      sec: s.section,
      url: s.url || s.alt_url || '',
    }));
  }

  if (field.kernel_ref) {
    f.kernel = {
      file: field.kernel_ref.file,
      fn: field.kernel_ref.function,
      note: field.kernel_ref.notes,
    };
  }

  // Recurse for sub-fields
  if (field.fields && field.fields.length > 0) {
    f.fields = field.fields.map(normalizeField);
  }

  return f;
}

/**
 * Infer phase from annotation text and event ID.
 * Falls back to previous phase if no match.
 */
function inferPhase(event, lastPhase) {
  const text = (event.annotation?.text || '').toLowerCase();
  const id = event.id.toLowerCase();

  // Scenario-level annotations (must check before protocol patterns steal keywords)
  if (/scenario complete|summary|end of scenario/i.test(text)
      || /^evt_done$|^evt_complete$|^evt_summary$/.test(id)) return 'Summary';

  // NVMe-oF/TCP phases (check before generic patterns)
  if (/\bmdns\b|_nvme-disc/i.test(text) || /mdns/.test(id)) return 'mDNS Discovery';
  if (/\bddc\b|direct discovery controller/i.test(text) || /ddc/.test(id)) return 'DDC Discovery';
  if (/\bio\s*controller/i.test(text) || /_ioc/.test(id)) return 'IOC Connect';
  if (/\bicreq\b|\bicresp\b|initialize connection/i.test(text)
      || /icreq|icresp/.test(id)) return 'NVMe/TCP Init';
  if (/\bdim\b.*register|\bdim\b.*deregister|discovery information/i.test(text)
      || /dim_/.test(id)) return 'DIM';
  if (/discovery log|log page.*discovery|lid.*0x70/i.test(text)
      || /get_log_page/.test(id)) return 'Discovery Log';
  if (/io queue|fabrics connect.*io queue/i.test(text)
      || /connect_ioq/.test(id)) return 'IO Queue Setup';
  if (/fabrics connect|fabrics.*connect/i.test(text)
      || /fabrics_connect/.test(id)) return 'Fabrics Connect';
  if (/identify controller|identify namespace|\bcns\b/i.test(text)
      || /identify_/.test(id)) return 'Identify';
  if (/\bnvme write\b|h2cdata.*write|write command|write completion/i.test(text)
      || /nvme_write/.test(id)) return 'NVMe Write';
  if (/\bnvme read\b|c2hdata.*read|read command|read completion/i.test(text)
      || /nvme_read/.test(id)) return 'NVMe Read';
  if (/\br2t\b|ready.?to.?transfer/i.test(text)
      || /write_r2t/.test(id)) return 'NVMe Write';
  if (/\bc2hdata\b/i.test(text) || /read_c2h/.test(id)) return 'NVMe Read';

  // FC-specific phases (check before generic patterns)
  if (/\bflogi\b/.test(text) || /flogi/.test(id)) return 'FLOGI';
  if (/name.?server|gid_ft|gnn_id|gpn_id|ga_nxt/i.test(text)
      || /ns_|gid_ft|name_server/.test(id)) return 'Name Server';
  if (/\bprli\b/.test(text) || /prli/.test(id)) return 'PRLI';
  if (/\bplogi\b/.test(text) || /plogi/.test(id)) return 'PLOGI';
  if (/scsi.*(inquiry|read.?cap|discover|report.?lun)/i.test(text)
      || /inquiry|readcap|discover/.test(id)) return 'SCSI Discovery';
  if (/scsi.*write|fcp.*write|\bwrite\(10\)|\bwrite_cmd\b/i.test(text)
      || /write_cmd|write_data|write_rsp|write_xfer/.test(id)) return 'SCSI Write';
  if (/scsi.*read|fcp.*read|\bread\(10\)|\bread_cmd\b/i.test(text)
      || /read_cmd|read_data|read_rsp/.test(id)) return 'SCSI Read';

  // CM takes priority (CM events also mention QP transitions)
  if (/\bcm\b/.test(text) || /cm[_ ]/.test(id)) return 'CM';

  // RDMA operations
  if (/rdma\s*write|\bwrite\b.*ack|\bwrite\b.*complete|\bwrite\b.*posted|\bwrite\b.*push/i.test(text)
      || /write/.test(id)) return 'RDMA Write';
  if (/rdma\s*read|\bread\b.*response|\bread\b.*posted/i.test(text)
      || /read/.test(id)) return 'RDMA Read';

  // S3/RDMA phases
  if (/s3.?rdma.*connect|connect.*request|connect.*response/i.test(text)
      || /s3rdma_connect|s3_connect/.test(id)) return 'S3/RDMA Connect';
  if (/\bs3.*put\b|put.*request|put.*ready|put.*complete/i.test(text)
      || /s3_put|put_req|put_ready|put_complete/.test(id)) return 'S3 PUT';
  if (/\bs3.*get\b|get.*request|get.*complete/i.test(text)
      || /s3_get|get_req|get_complete/.test(id)) return 'S3 GET';
  if (/library.*init|s3_rdma.*init|server.*init/i.test(text)
      || /lib_init|library_init/.test(id)) return 'Library Init';

  // GPUDirect RDMA phases
  if (/\bgpu\b|cuda|peermem|bar1/i.test(text) || /gpu_/.test(id)) return 'GPU Memory Setup';

  // GPUDirect Storage phases
  if (/cufiledriveropen|gds.*init|nvidia-fs.*init/i.test(text)
      || /gds_init|cufile_driver/.test(id)) return 'GDS Init';
  if (/cufilehandleregister|gds.*file.*open/i.test(text)
      || /gds_file|cufile_handle/.test(id)) return 'GDS File Open';
  if (/cufilebufregister|gds.*buffer/i.test(text)
      || /gds_buf|cufile_buf/.test(id)) return 'GDS Buffer Register';
  if (/p2p.*dma|peer.*dma|bar1.*dma/i.test(text)
      || /p2p_dma/.test(id)) return 'P2P DMA';
  if (/cufileread|gds.*read/i.test(text)
      || /gds_read|cufile_read/.test(id)) return 'GDS Read';
  if (/cufilewrite|gds.*write/i.test(text)
      || /gds_write|cufile_write/.test(id)) return 'GDS Write';

  // PFC/ECN/DCQCN congestion control phases
  if (/\bpfc\b.*pause|\bxoff\b|\bpfc\b.*resume|\bxon\b/i.test(text)
      || /pfc_pause|pfc_resume|pfc_xo/.test(id)) return 'PFC';
  if (/\bcnp\b|\bdcqcn\b.*re(?:duce|duction)|rate\s*cut|ecn.*ce\s*mark/i.test(text)
      || /cnp|dcqcn_reduce|ecn_mark/.test(id)) return 'ECN/DCQCN';
  if (/congestion\s*build|queue\s*fill|buffer\s*fill/i.test(text)
      || /congestion_build/.test(id)) return 'Congestion';
  if (/rate\s*recover|rate\s*increase|recovering/i.test(text)
      || /rate_recovery/.test(id)) return 'Recovery';

  // TCP phases
  if (/\btcp\b.*\bsyn\b|\b3.?way\b.*handshake|handshake.*complete/i.test(text)
      || /tcp_syn|tcp_ack_handshake/.test(id)) return 'TCP Handshake';
  if (/\btcp\b.*\bdata\b|\btcp\b.*\bhttp\b|\btcp\b.*ack.*(?:request|response)/i.test(text)
      || /tcp_data|tcp_http/.test(id)) return 'TCP Data';
  if (/\btcp\b.*\bfin\b|\btcp\b.*close|\btcp\b.*teardown|time.?wait/i.test(text)
      || /tcp_fin|tcp_ack_fin/.test(id)) return 'TCP Teardown';
  if (/\btcp\b.*\brst\b|\btcp\b.*reset/i.test(text)
      || /tcp_rst|tcp_reset/.test(id)) return 'TCP Reset';

  // Infrastructure
  if (/\barp\b/.test(text) || /arp/.test(id)) return 'ARP';
  if (/physical|link|auto.?neg|fec|signal/i.test(text)
      || /^evt_(phy|an_|link)/.test(id)) return 'Link';
  if (/memory region|ibv_reg_mr|\bqp\b|modify_qp/i.test(text)
      || /^evt_(mr|qp)/.test(id)) return 'Setup';

  // Fallback to previous phase
  return lastPhase || 'Other';
}
