export const L_COLOR = {
  7: '#7c3aed',
  6: '#6d28d9',
  5: '#1d4ed8',
  4: '#0369a1',
  3: '#0f766e',
  2: '#15803d',
  1: '#92400e',
};

export const PHASE_COLORS = {
  'Link': '#92400e',
  'ARP': '#b45309',
  'NDP': '#0f766e',
  'Setup': '#0369a1',
  'CM': '#1e40af',
  'RDMA Write': '#991b1b',
  'RDMA Read': '#6b21a8',
  // FC scenario phases
  'FLOGI': '#b45309',
  'Name Server': '#0f766e',
  'PLOGI': '#0369a1',
  'PRLI': '#1e40af',
  'SCSI Discovery': '#6d28d9',
  'SCSI Write': '#991b1b',
  'SCSI Read': '#6b21a8',
  // NVMe-oF/TCP scenario phases
  'mDNS Discovery': '#b45309',
  'NVMe/TCP Init': '#0f766e',
  'Fabrics Connect': '#1e40af',
  'DIM': '#6d28d9',
  'DDC Discovery': '#0e7490',
  'IOC Connect': '#15803d',
  'Discovery Log': '#0369a1',
  'Identify': '#0369a1',
  'IO Queue Setup': '#1e40af',
  'NVMe Write': '#991b1b',
  'NVMe Read': '#6b21a8',
  // PCAP conversation phases
  'TCP Handshake': '#0f766e',
  'TCP Data': '#0369a1',
  'TCP Teardown': '#64748b',
  'TCP Reset': '#dc2626',
  'UDP': '#1e40af',
  'RoCE': '#7c3aed',
  'RDMA Send': '#1d4ed8',
  'RDMA ACK': '#475569',
  // S3/RDMA scenario phases
  'S3/RDMA Connect': '#9b59b6',
  'S3 PUT': '#e74c3c',
  'S3 GET': '#2ecc71',
  'Library Init': '#7c3aed',
  // GPUDirect RDMA scenario phases
  'GPU Memory Setup': '#15803d',
  // GPUDirect Storage scenario phases
  'GDS Init': '#7c3aed',
  'GDS File Open': '#7c3aed',
  'GDS Buffer Register': '#7c3aed',
  'GDS Read': '#059669',
  'GDS Write': '#2563eb',
  'P2P DMA': '#dc2626',
  // iSCSI phases
  'iSCSI Login': '#0f766e',
  // PFC/ECN/DCQCN congestion control phases
  'PFC': '#e67e22',
  'ECN/DCQCN': '#7c3aed',
  'Congestion': '#dc2626',
  'Recovery': '#059669',
  // NCCL collective communication phases
  'Reduce-Scatter': '#dc2626',
  'AllGather': '#059669',
  // DNS phases
  'DNS': '#b45309',
  // HTTP/2 phases
  'HTTP/2': '#7c3aed',
  'HTTP/2 Data': '#059669',
  // TLS phases
  'TLS Handshake': '#1e40af',
  'TLS Data': '#0369a1',
  'TLS Close': '#64748b',
  // SMB Direct phases
  'SMB Direct Setup': '#7c3aed',
  'SMB Negotiate': '#1e40af',
  'SMB Session': '#0369a1',
  'SMB File Open': '#0e7490',
  'SMB Write': '#991b1b',
  'SMB Read': '#6b21a8',
  'Other': '#475569',
};
