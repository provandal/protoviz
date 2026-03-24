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
    learning_objectives: raw.meta.learning_objectives || [],
  };

  const walkthroughs = raw.walkthroughs || [];
  const glossary = (raw.glossary || []).map(g => ({
    term: g.term,
    abbrev: g.abbrev || null,
    definition: g.definition,
    spec_refs: g.spec_refs || [],
  }));

  return { meta, actors, osi_layers: osiLayers, timeline, walkthroughs, glossary };
}

function normalizeActors(rawActors) {
  return rawActors.map(a => ({
    id: a.id,
    label: a.label,
    description: a.description || '',
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
        id: frame.id,
        name: frame.name,
        bytes: frame.total_bytes,
        headers: (frame.headers || []).map(normalizeHeader).sort((a, b) => b.layer - a.layer),
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

  // io_uring phases (vertical stack)
  if (/\bio_uring\b|\bsqe\b.*submit|\bkiocb\b|io_uring_enter/i.test(text)
      || /sqe_|kiocb_/.test(id)) return 'io_uring';
  // NVMe/TCP target-side phases (vertical stack)
  if (/\bnvmet\b|target.*receive|target.*execute|blk_mq.*complete/i.test(text)
      || /nvmet_tcp|nvmet_core/.test(id)) return 'NVMe/TCP Target';
  // NVMe/TCP PDU construction (vertical stack)
  if (/nvme_tcp_cmd_pdu|nvme_tcp_data_pdu|pdu.*construct/i.test(text)
      || /nvme_tcp_cmd_pdu|nvme_tcp_data_pdu/.test(id)) return 'NVMe/TCP PDU';

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

  // FC-SP-3 security phases
  if (/\bdh-?chap\b|mutual auth|fabric auth/i.test(text)
      || /auth_neg|dhchap_/.test(id)) return 'DH-CHAP';
  if (/security association|\bsa\b.*init|\bsa\b.*setup|session key|key deriv/i.test(text)
      || /sa_init|sa_setup/.test(id)) return 'SA Establishment';
  if (/re-?key|key refresh|session.*refresh/i.test(text)
      || /rekey/.test(id)) return 'Re-key';
  if (/encrypted.*frame|aes.*gcm.*frame|decrypt|ciphertext/i.test(text)
      || /fcp_write_enc|array_decrypt|encrypt/.test(id)) return 'Encrypted I/O';

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

  // SMB Direct phases (before RDMA — SMB events contain "write"/"read" in IDs)
  if (/smb\s*direct.*negotiate|smbd.*negotiate/i.test(text)
      || /smbd_negotiate/.test(id)) return 'SMB Direct Setup';
  if (/smb2.*negotiate/i.test(text) || /smb2_negotiate/.test(id)) return 'SMB Negotiate';
  if (/session.?setup|tree.?connect/i.test(text)
      || /smb2_session/.test(id)) return 'SMB Session';
  if (/smb2.*create/i.test(text) || /smb2_create/.test(id)) return 'SMB File Open';
  if (/smb2.*write|smb.*write.*rdma/i.test(text)
      || /smb2_write|smb_write/.test(id)) return 'SMB Write';
  if (/smb2.*read|smb.*read.*rdma/i.test(text)
      || /smb2_read|smb_read/.test(id)) return 'SMB Read';

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

  // NCCL collective communication phases (before GPU/infrastructure checks)
  if (/reduce.?scatter/i.test(text) || /rs_step/.test(id)) return 'Reduce-Scatter';
  if (/allgather|all.?gather/i.test(text) || /ag_step/.test(id)) return 'AllGather';
  if (/ncclallreduce|allreduce\(\)/i.test(text) || /allreduce_start/.test(id)) return 'Reduce-Scatter';

  // Infrastructure (before GPU-specific — many scenarios mention GPUs generically)
  if (/\bndp\b|neighbor solicitation|neighbor advertisement|router advertisement/i.test(text)
      || /ndp_/.test(id)) return 'NDP';
  if (/\barp\b/.test(text) || /arp/.test(id)) return 'ARP';
  if (/physical|link|auto.?neg|fec|signal/i.test(text)
      || /^evt_(phy|an_|link)/.test(id)) return 'Link';
  if (/memory region|ibv_reg_mr|\bqp\b|modify_qp/i.test(text)
      || /^evt_(mr|qp)/.test(id)) return 'Setup';

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

  // iSCSI phases
  if (/\biscsi\b.*login|login.*(?:security|operational|full feature)/i.test(text)
      || /login_security|login_operational|login_final/.test(id)) return 'iSCSI Login';
  if (/\biscsi\b.*r2t|ready.?to.?transfer|data.?out/i.test(text)
      || /write_r2t|write_data/.test(id)) return 'SCSI Write';

  // DNS phases (before TLS/TCP — DNS queries precede connections)
  if (/\bdns\b.*query|\bdns\b.*request|who is.*\?/i.test(text)
      || /dns_query/.test(id)) return 'DNS';
  if (/\bdns\b.*response|\bdns\b.*answer|\bdns\b.*resolv/i.test(text)
      || /dns_response/.test(id)) return 'DNS';

  // HTTP/2 phases (before TLS — HTTP/2 events run inside TLS)
  if (/\bhttp\/2\b.*settings|\bh2\b.*settings|connection preface/i.test(text)
      || /h2_settings/.test(id)) return 'HTTP/2';
  if (/\bhttp\/2\b.*get|\bhttp\/2\b.*post|\bhttp\/2\b.*header|\bh2\b.*get/i.test(text)
      || /h2_get_/.test(id)) return 'HTTP/2';
  if (/\bhttp\/2\b.*200|\bhttp\/2\b.*data|\bhttp\/2\b.*multiplexed|inbox.*html|inbox.*render/i.test(text)
      || /h2_response_|h2_data_/.test(id)) return 'HTTP/2 Data';
  if (/\bhttp\/2\b.*push|server.sent.event|real.?time.*notif|notification.*channel/i.test(text)
      || /h2_push_|h2_server_push/.test(id)) return 'HTTP/2 Data';

  // TLS phases (before TCP — TLS events run over TCP)
  if (/clienthello|serverhello|client hello|server hello|certificateverify|encryptedextensions/i.test(text)
      || /tls_client_hello|tls_server_hello|tls_server_encrypted|tls_client_finished/.test(id)) return 'TLS Handshake';
  if (/\btls\b.*app|https.*request|https.*response|encrypted.*application/i.test(text)
      || /tls_app_data/.test(id)) return 'TLS Data';
  if (/close_notify|\btls\b.*close|\btls\b.*shutdown/i.test(text)
      || /tls_close/.test(id)) return 'TLS Close';

  // Parallel SCSI phases
  if (/\bscsi\b.*arbitrat|\bscsi\b.*select|\bscsi\b.*bus/i.test(text)
      || /scsi_arb|scsi_sel/.test(id)) return 'SCSI Bus';
  if (/\bscsi\b.*command|\bcdb\b|command descriptor/i.test(text)
      || /scsi_command/.test(id)) return 'SCSI Command';
  if (/\bscsi\b.*data.*in|\bscsi\b.*status|data.?phase/i.test(text)
      || /scsi_data|scsi_status/.test(id)) return 'SCSI Data';
  if (/parallel.*wall|clock.*skew|signal.*integrity|bus.*contention/i.test(text)
      || /parallel_wall/.test(id)) return 'Parallel Limits';
  // PCIe phases
  if (/\bpcie\b.*link.*train|ltssm|equalization/i.test(text)
      || /pcie_link/.test(id)) return 'PCIe Link';
  if (/\btlp\b|transaction.*layer.*packet|memory.*read|completion.*data/i.test(text)
      || /pcie_tlp/.test(id)) return 'PCIe TLP';

  // TCP phases
  if (/\btcp\b.*\bsyn\b|\b3.?way\b.*handshake|handshake.*complete/i.test(text)
      || /tcp_syn|tcp_ack_handshake/.test(id)) return 'TCP Handshake';
  if (/\btcp\b.*\bdata\b|\btcp\b.*\bhttp\b|\btcp\b.*ack.*(?:request|response)/i.test(text)
      || /tcp_data|tcp_http/.test(id)) return 'TCP Data';
  if (/\btcp\b.*\bfin\b|\btcp\b.*close|\btcp\b.*teardown|time.?wait/i.test(text)
      || /tcp_fin|tcp_ack_fin/.test(id)) return 'TCP Teardown';
  if (/\btcp\b.*\brst\b|\btcp\b.*reset/i.test(text)
      || /tcp_rst|tcp_reset/.test(id)) return 'TCP Reset';

  // Fallback to previous phase
  return lastPhase || 'Other';
}
