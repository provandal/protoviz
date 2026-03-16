/**
 * Payload capture and ULP identification.
 *
 * Captures up to 64 bytes of payload after the transport header and
 * attempts to identify the upper-layer protocol from well-known ports
 * or magic bytes in the payload.
 */

const MAX_PAYLOAD = 64;

// Well-known TCP port → ULP mapping
const TCP_ULP_PORTS = {
  80: 'HTTP',
  443: 'TLS',
  3260: 'iSCSI',
  8443: 'HTTPS',
  4420: 'NVMe-oF/TCP',
  8009: 'AJP',
  3306: 'MySQL',
  5432: 'PostgreSQL',
  6379: 'Redis',
  9092: 'Kafka',
};

// Well-known UDP port → ULP mapping
const UDP_ULP_PORTS = {
  53: 'DNS',
  67: 'DHCP',
  68: 'DHCP',
  123: 'NTP',
  161: 'SNMP',
  162: 'SNMP-Trap',
  500: 'IKE',
  514: 'Syslog',
  1812: 'RADIUS',
  4789: 'VXLAN',
};

// iSCSI opcodes (BHS byte 0, lower 6 bits)
const ISCSI_OPCODES = {
  0x00: 'NOP-Out',
  0x01: 'SCSI Command',
  0x02: 'Task Management',
  0x03: 'Login Request',
  0x04: 'Text Request',
  0x05: 'Data-Out',
  0x06: 'Logout Request',
  0x10: 'SNACK',
  0x20: 'NOP-In',
  0x21: 'SCSI Response',
  0x22: 'Task Management Response',
  0x23: 'Login Response',
  0x24: 'Text Response',
  0x25: 'Data-In',
  0x26: 'Logout Response',
  0x31: 'Ready To Transfer (R2T)',
  0x32: 'Async Message',
  0x3f: 'Reject',
};

// NVMe-oF TCP PDU types
const NVME_TCP_PDU_TYPES = {
  0x00: 'ICReq',
  0x01: 'ICResp',
  0x02: 'H2CTermReq',
  0x03: 'C2HTermReq',
  0x04: 'CapsuleCmd',
  0x05: 'CapsuleResp',
  0x06: 'H2CData',
  0x07: 'C2HData',
  0x08: 'R2T',
};

// TLS content types
const TLS_CONTENT_TYPES = {
  20: 'ChangeCipherSpec',
  21: 'Alert',
  22: 'Handshake',
  23: 'ApplicationData',
};

// TLS handshake types
const TLS_HANDSHAKE_TYPES = {
  1: 'ClientHello',
  2: 'ServerHello',
  11: 'Certificate',
  12: 'ServerKeyExchange',
  13: 'CertificateRequest',
  14: 'ServerHelloDone',
  15: 'CertificateVerify',
  16: 'ClientKeyExchange',
  20: 'Finished',
};

/**
 * Capture payload bytes and attempt ULP identification.
 * @param {Uint8Array} data - Full packet data
 * @param {number} payloadOffset - Byte offset where payload starts
 * @param {number} srcPort - Transport source port
 * @param {number} dstPort - Transport destination port
 * @param {string} transport - 'tcp' or 'udp'
 * @returns {{ layer: object|null, summary: string }} - Dissected ULP layer and summary fragment
 */
export function dissectPayload(data, payloadOffset, srcPort, dstPort, transport) {
  const payloadLen = data.length - payloadOffset;
  if (payloadLen <= 0) return { layer: null, summary: '' };

  const captureLen = Math.min(payloadLen, MAX_PAYLOAD);
  const payload = data.slice(payloadOffset, payloadOffset + captureLen);

  // Try protocol-specific dissection first
  const specific = trySpecificDissection(payload, payloadLen, srcPort, dstPort, transport);
  if (specific) return specific;

  // Generic payload capture
  const portMap = transport === 'tcp' ? TCP_ULP_PORTS : UDP_ULP_PORTS;
  const ulpName = portMap[dstPort] || portMap[srcPort];

  const layer = {
    layer: 5,
    name: ulpName || 'Payload',
    fields: {
      payload_length: payloadLen,
      captured_bytes: captureLen,
      hex_dump: formatHexDump(payload),
      ascii: formatAscii(payload),
    },
  };

  const summary = ulpName ? ulpName : '';
  return { layer, summary };
}

function trySpecificDissection(payload, fullLen, srcPort, dstPort, transport) {
  if (transport === 'tcp') {
    // iSCSI (port 3260)
    if ((srcPort === 3260 || dstPort === 3260) && payload.length >= 48) {
      return dissectISCSI(payload, fullLen);
    }

    // NVMe-oF/TCP (port 4420)
    if ((srcPort === 4420 || dstPort === 4420) && payload.length >= 8) {
      return dissectNVMeTCP(payload, fullLen);
    }

    // TLS (port 443 or payload starts with TLS record)
    if (payload.length >= 5 && payload[0] >= 20 && payload[0] <= 23 &&
        payload[1] === 3 && payload[2] <= 4) {
      return dissectTLS(payload, fullLen);
    }

    // HTTP (starts with method or "HTTP/")
    if (payload.length >= 4) {
      const start = String.fromCharCode(...payload.slice(0, Math.min(8, payload.length)));
      if (/^(GET |POST |PUT |DELETE |HEAD |OPTIONS |PATCH |HTTP\/)/.test(start)) {
        return dissectHTTP(payload, fullLen);
      }
    }
  }

  if (transport === 'udp') {
    // DNS (port 53)
    if ((srcPort === 53 || dstPort === 53) && payload.length >= 12) {
      return dissectDNS(payload, fullLen);
    }
  }

  return null;
}

function dissectISCSI(payload, fullLen) {
  const opcode = payload[0] & 0x3f;
  const immediate = (payload[0] & 0x40) !== 0;
  const final = (payload[0] & 0x80) !== 0;
  const opcodeName = ISCSI_OPCODES[opcode] || `Unknown(0x${opcode.toString(16)})`;

  const totalAHSLen = payload[4];
  const dataSegLen = (payload[5] << 16) | (payload[6] << 8) | payload[7];
  const itt = readUint32(payload, 16);

  const fields = {
    opcode: `0x${opcode.toString(16).padStart(2, '0')}`,
    opcode_name: opcodeName,
    immediate: immediate ? 'Yes' : 'No',
    final: final ? 'Yes' : 'No',
    total_ahs_length: totalAHSLen,
    data_segment_length: dataSegLen,
    initiator_task_tag: `0x${itt.toString(16).padStart(8, '0')}`,
    payload_length: fullLen,
  };

  // SCSI Command: extract LUN and CDB
  if (opcode === 0x01 && payload.length >= 48) {
    const lun = (payload[8] << 8) | payload[9];
    fields.lun = lun;
    fields.expected_data_length = readUint32(payload, 20);
    fields.cmd_sn = readUint32(payload, 24);
    // CDB starts at byte 32, 16 bytes
    const cdb = payload.slice(32, 48);
    fields.cdb_opcode = `0x${cdb[0].toString(16).padStart(2, '0')}`;
    fields.cdb_opcode_name = SCSI_CDB_OPCODES[cdb[0]] || '';
    fields.cdb_hex = formatHex(cdb);
  }

  // SCSI Response
  if (opcode === 0x21 && payload.length >= 36) {
    fields.status = `0x${payload[3].toString(16).padStart(2, '0')}`;
    fields.status_name = SCSI_STATUS[payload[3]] || '';
    fields.stat_sn = readUint32(payload, 24);
  }

  // Data-In / Data-Out
  if ((opcode === 0x25 || opcode === 0x05) && payload.length >= 28) {
    fields.target_transfer_tag = `0x${readUint32(payload, 20).toString(16).padStart(8, '0')}`;
    fields.buffer_offset = readUint32(payload, 40 < payload.length ? 40 : 24);
  }

  return {
    layer: { layer: 5, name: `iSCSI ${opcodeName}`, fields },
    summary: `iSCSI ${opcodeName}`,
  };
}

function dissectNVMeTCP(payload, fullLen) {
  const pduType = payload[0];
  const pduTypeName = NVME_TCP_PDU_TYPES[pduType] || `Type(${pduType})`;
  const flags = payload[1];
  const hLen = payload[2];
  const pdo = payload[3];
  const pduLen = readUint32(payload, 4);

  const fields = {
    pdu_type: pduType,
    pdu_type_name: pduTypeName,
    flags: `0x${flags.toString(16).padStart(2, '0')}`,
    header_length: hLen,
    pdu_data_offset: pdo,
    pdu_length: pduLen,
    payload_length: fullLen,
  };

  // CapsuleCmd: extract NVMe opcode from SQE (starts at header_length offset)
  if (pduType === 0x04 && payload.length >= hLen + 4) {
    const nvmeOpcode = payload[hLen];
    fields.nvme_opcode = `0x${nvmeOpcode.toString(16).padStart(2, '0')}`;
    fields.nvme_opcode_name = NVME_OPCODES[nvmeOpcode] || '';
  }

  return {
    layer: { layer: 5, name: `NVMe-oF/TCP ${pduTypeName}`, fields },
    summary: `NVMe-oF/TCP ${pduTypeName}`,
  };
}

function dissectTLS(payload, fullLen) {
  const contentType = payload[0];
  const contentTypeName = TLS_CONTENT_TYPES[contentType] || `Type(${contentType})`;
  const version = `${payload[1]}.${payload[2]}`;
  const recordLen = (payload[3] << 8) | payload[4];

  const fields = {
    content_type: contentTypeName,
    version: version === '3.3' ? 'TLS 1.2' : version === '3.4' ? 'TLS 1.3' : version === '3.1' ? 'TLS 1.0' : version === '3.2' ? 'TLS 1.1' : `SSL ${version}`,
    record_length: recordLen,
    payload_length: fullLen,
  };

  // Handshake: identify type
  if (contentType === 22 && payload.length >= 6) {
    const hsType = payload[5];
    fields.handshake_type = TLS_HANDSHAKE_TYPES[hsType] || `Type(${hsType})`;
  }

  const detail = contentType === 22 && fields.handshake_type
    ? `TLS ${fields.handshake_type}`
    : `TLS ${contentTypeName}`;

  return {
    layer: { layer: 6, name: detail, fields },
    summary: detail,
  };
}

function dissectHTTP(payload, fullLen) {
  // Extract first line
  const text = String.fromCharCode(...payload);
  const firstLine = text.split('\r\n')[0] || text.split('\n')[0] || text;

  const fields = {
    first_line: firstLine.slice(0, 120),
    payload_length: fullLen,
  };

  // Parse request
  const reqMatch = firstLine.match(/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+(\S+)/);
  if (reqMatch) {
    fields.method = reqMatch[1];
    fields.uri = reqMatch[2].slice(0, 80);
  }

  // Parse response
  const respMatch = firstLine.match(/^HTTP\/[\d.]+\s+(\d+)\s*(.*)/);
  if (respMatch) {
    fields.status_code = parseInt(respMatch[1], 10);
    fields.reason = respMatch[2];
  }

  return {
    layer: { layer: 7, name: `HTTP`, fields },
    summary: `HTTP ${firstLine.slice(0, 60)}`,
  };
}

function dissectDNS(payload, fullLen) {
  const txId = (payload[0] << 8) | payload[1];
  const flags = (payload[2] << 8) | payload[3];
  const isResponse = (flags & 0x8000) !== 0;
  const opcode = (flags >> 11) & 0x0f;
  const rcode = flags & 0x0f;
  const qdCount = (payload[4] << 8) | payload[5];
  const anCount = (payload[6] << 8) | payload[7];

  const fields = {
    transaction_id: `0x${txId.toString(16).padStart(4, '0')}`,
    type: isResponse ? 'Response' : 'Query',
    opcode,
    rcode: isResponse ? rcode : undefined,
    questions: qdCount,
    answers: anCount,
    payload_length: fullLen,
  };

  // Try to extract query name (starts at byte 12)
  if (payload.length > 12) {
    const name = decodeDnsName(payload, 12);
    if (name) fields.query_name = name;
  }

  return {
    layer: { layer: 7, name: `DNS ${isResponse ? 'Response' : 'Query'}`, fields },
    summary: `DNS ${isResponse ? 'Response' : 'Query'}${fields.query_name ? ' ' + fields.query_name : ''}`,
  };
}

function decodeDnsName(data, offset) {
  const parts = [];
  let pos = offset;
  let safety = 0;
  while (pos < data.length && safety++ < 30) {
    const len = data[pos];
    if (len === 0) break;
    if ((len & 0xc0) === 0xc0) break; // compression pointer — stop
    pos++;
    if (pos + len > data.length) break;
    parts.push(String.fromCharCode(...data.slice(pos, pos + len)));
    pos += len;
  }
  return parts.join('.') || null;
}

// ── SCSI / NVMe opcode tables ──

const SCSI_CDB_OPCODES = {
  0x00: 'TEST UNIT READY', 0x03: 'REQUEST SENSE', 0x08: 'READ(6)',
  0x0a: 'WRITE(6)', 0x12: 'INQUIRY', 0x1a: 'MODE SENSE(6)',
  0x25: 'READ CAPACITY(10)', 0x28: 'READ(10)', 0x2a: 'WRITE(10)',
  0x2f: 'VERIFY(10)', 0x35: 'SYNCHRONIZE CACHE(10)',
  0x3b: 'WRITE BUFFER', 0x3c: 'READ BUFFER',
  0x88: 'READ(16)', 0x8a: 'WRITE(16)',
  0x9e: 'READ CAPACITY(16)/SERVICE ACTION IN',
  0xa0: 'REPORT LUNS', 0xa3: 'REPORT SUPPORTED OPCODES',
};

const SCSI_STATUS = {
  0x00: 'GOOD', 0x02: 'CHECK CONDITION', 0x04: 'CONDITION MET',
  0x08: 'BUSY', 0x18: 'RESERVATION CONFLICT', 0x28: 'TASK SET FULL',
  0x30: 'ACA ACTIVE', 0x40: 'TASK ABORTED',
};

const NVME_OPCODES = {
  0x00: 'Delete I/O SQ', 0x01: 'Create I/O SQ', 0x02: 'Get Log Page',
  0x04: 'Delete I/O CQ', 0x05: 'Create I/O CQ', 0x06: 'Identify',
  0x08: 'Abort', 0x09: 'Set Features', 0x0a: 'Get Features',
  0x0c: 'Async Event Request', 0x10: 'Fabric Cmd',
  // I/O commands (different namespace)
  0x80: 'Flush', 0x81: 'Write', 0x82: 'Read',
};

// ── Formatting helpers ──

function formatHexDump(bytes) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const hex = Array.from(bytes.slice(i, i + 16))
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ');
    lines.push(hex);
  }
  return lines.join('\n');
}

function formatAscii(bytes) {
  return Array.from(bytes)
    .map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.')
    .join('');
}

function formatHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

function readUint32(data, offset) {
  return (data[offset] << 24 | data[offset + 1] << 16 | data[offset + 2] << 8 | data[offset + 3]) >>> 0;
}
