/**
 * RoCEv2 dissector — BTH, RETH, AETH, ImmDt
 */

export function dissectBTH(data, offset) {
  if (data.length < offset + 12) return null;

  const opcode = data[offset];
  const flags = data[offset + 1];
  const solicited = !!(flags & 0x80);
  const migReq = !!(flags & 0x40);
  const padCount = (flags >> 4) & 0x03;
  const version = flags & 0x0f;
  const pkey = (data[offset + 2] << 8) | data[offset + 3];
  const destQP = ((data[offset + 5] << 16) | (data[offset + 6] << 8) | data[offset + 7]) & 0x00ffffff;
  const ackReq = !!(data[offset + 8] & 0x80);
  const psn = ((data[offset + 9] << 16) | (data[offset + 10] << 8) | data[offset + 11]) & 0x00ffffff;

  const opName = BTH_OPCODES[opcode] || `Unknown(0x${opcode.toString(16)})`;

  return {
    layer: 5,
    name: 'BTH (Base Transport Header)',
    fields: {
      opcode: `0x${opcode.toString(16).padStart(2, '0')}`,
      opcode_name: opName,
      solicited,
      mig_req: migReq,
      pad_count: padCount,
      version,
      pkey: `0x${pkey.toString(16).padStart(4, '0')}`,
      dest_qp: destQP,
      ack_req: ackReq,
      psn,
    },
    nextOffset: offset + 12,
    opcode,
  };
}

export function dissectRETH(data, offset) {
  if (data.length < offset + 16) return null;

  // Virtual address is 8 bytes
  const vaHigh = readUint32(data, offset);
  const vaLow = readUint32(data, offset + 4);
  const rkey = readUint32(data, offset + 8);
  const dmaLength = readUint32(data, offset + 12);

  return {
    layer: 5,
    name: 'RETH (RDMA Extended Transport Header)',
    fields: {
      virtual_address: `0x${vaHigh.toString(16).padStart(8, '0')}${vaLow.toString(16).padStart(8, '0')}`,
      rkey: `0x${rkey.toString(16).padStart(8, '0')}`,
      dma_length: dmaLength,
    },
    nextOffset: offset + 16,
  };
}

export function dissectAETH(data, offset) {
  if (data.length < offset + 4) return null;

  const syndrome = data[offset];
  const msn = ((data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) & 0x00ffffff;

  const ackType = (syndrome >> 5) & 0x07;
  const ackName = AETH_TYPES[ackType] || 'Unknown';

  return {
    layer: 5,
    name: 'AETH (ACK Extended Transport Header)',
    fields: {
      syndrome: `0x${syndrome.toString(16).padStart(2, '0')}`,
      ack_type: ackName,
      credit_count: syndrome & 0x1f,
      msn,
    },
    nextOffset: offset + 4,
  };
}

function readUint32(data, offset) {
  return (data[offset] << 24 | data[offset + 1] << 16 | data[offset + 2] << 8 | data[offset + 3]) >>> 0;
}

// Subset of IB opcodes relevant to RoCEv2 RC
export const BTH_OPCODES = {
  0x00: 'RC Send First',
  0x01: 'RC Send Middle',
  0x02: 'RC Send Last',
  0x03: 'RC Send Last w/ Immediate',
  0x04: 'RC Send Only',
  0x05: 'RC Send Only w/ Immediate',
  0x06: 'RC RDMA Write First',
  0x07: 'RC RDMA Write Middle',
  0x08: 'RC RDMA Write Last',
  0x09: 'RC RDMA Write Last w/ Immediate',
  0x0a: 'RC RDMA Write Only',
  0x0b: 'RC RDMA Write Only w/ Immediate',
  0x0c: 'RC RDMA Read Request',
  0x0d: 'RC RDMA Read Response First',
  0x0e: 'RC RDMA Read Response Middle',
  0x0f: 'RC RDMA Read Response Last',
  0x10: 'RC RDMA Read Response Only',
  0x11: 'RC Acknowledge',
  0x12: 'RC Atomic Acknowledge',
  0x13: 'RC Compare & Swap',
  0x14: 'RC Fetch & Add',
};

const AETH_TYPES = {
  0: 'ACK',
  1: 'RNR NAK',
  2: 'Reserved',
  3: 'NAK',
};

// Opcodes that carry RETH
export const RETH_OPCODES = [0x06, 0x0a, 0x0b, 0x0c];
// Opcodes that carry AETH
export const AETH_OPCODES = [0x0d, 0x0f, 0x10, 0x11, 0x12];
