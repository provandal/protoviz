/**
 * Full packet dissection pipeline: Ethernet → IPv4/IPv6 → UDP/TCP/ICMPv6 → RoCE / ULP
 */
import { dissectEthernet } from './dissectors/ethernet.js';
import { dissectIPv4 } from './dissectors/ip.js';
import { dissectIPv6, dissectICMPv6 } from './dissectors/ipv6.js';
import { dissectUDP, ROCE_V2_PORT } from './dissectors/udp.js';
import { dissectTCP } from './dissectors/tcp.js';
import { dissectBTH, dissectRETH, dissectAETH, RETH_OPCODES, AETH_OPCODES } from './dissectors/roce.js';
import { dissectPayload } from './dissectors/payload.js';

export function dissectPacket(packet) {
  const { data } = packet;
  const layers = [];
  let summary = '';

  // Layer 2: Ethernet
  const eth = dissectEthernet(data);
  if (!eth) return { layers, summary: 'Truncated Ethernet' };
  layers.push(eth);

  // Layer 3
  if (eth.nextProtocol === 0x0800) {
    const ip = dissectIPv4(data, eth.nextOffset);
    if (!ip) return { layers, summary: `Truncated IPv4 from ${eth.fields.src_mac}` };
    layers.push(ip);
    summary = `${ip.fields.src_ip} → ${ip.fields.dst_ip}`;

    // Layer 4
    if (ip.nextProtocol === 17) {
      const udp = dissectUDP(data, ip.nextOffset);
      if (udp) {
        layers.push(udp);

        // RoCEv2
        if (udp.fields.dst_port === ROCE_V2_PORT || udp.fields.src_port === ROCE_V2_PORT) {
          const bth = dissectBTH(data, udp.nextOffset);
          if (bth) {
            layers.push(bth);
            summary += ` | RoCEv2 ${bth.fields.opcode_name} QP=${bth.fields.dest_qp} PSN=${bth.fields.psn}`;

            let nextOff = bth.nextOffset;

            if (RETH_OPCODES.includes(bth.opcode)) {
              const reth = dissectRETH(data, nextOff);
              if (reth) {
                layers.push(reth);
                nextOff = reth.nextOffset;
              }
            }

            if (AETH_OPCODES.includes(bth.opcode)) {
              const aeth = dissectAETH(data, nextOff);
              if (aeth) {
                layers.push(aeth);
              }
            }
          }
        } else {
          // Non-RoCE UDP: try ULP dissection
          const { layer: ulpLayer, summary: ulpSummary } = dissectPayload(
            data, udp.nextOffset, udp.fields.src_port, udp.fields.dst_port, 'udp'
          );
          if (ulpLayer) layers.push(ulpLayer);
          summary += ulpSummary
            ? ` | ${ulpSummary}`
            : ` | UDP ${udp.fields.src_port}→${udp.fields.dst_port}`;
        }
      }
    } else if (ip.nextProtocol === 6) {
      const tcp = dissectTCP(data, ip.nextOffset);
      if (tcp) {
        layers.push(tcp);
        summary += ` | TCP ${tcp.fields.src_port}→${tcp.fields.dst_port} [${tcp.fields.flag_names}]`;

        // ULP dissection on TCP payload
        const payloadOffset = tcp.nextOffset;
        const payloadLen = data.length - payloadOffset;
        if (payloadLen > 0) {
          const { layer: ulpLayer, summary: ulpSummary } = dissectPayload(
            data, payloadOffset, tcp.fields.src_port, tcp.fields.dst_port, 'tcp'
          );
          if (ulpLayer) {
            layers.push(ulpLayer);
            if (ulpSummary) summary += ` | ${ulpSummary}`;
          }
        }
      }
    } else {
      summary += ` | ${ip.fields.protocol_name}`;
    }
  } else if (eth.nextProtocol === 0x86dd) {
    const ip6 = dissectIPv6(data, eth.nextOffset);
    if (!ip6) return { layers, summary: `Truncated IPv6 from ${eth.fields.src_mac}` };
    layers.push(ip6);
    summary = `${ip6.fields.src_ip} → ${ip6.fields.dst_ip}`;

    // Layer 4
    if (ip6.nextProtocol === 17) {
      const udp = dissectUDP(data, ip6.nextOffset);
      if (udp) {
        layers.push(udp);
        const { layer: ulpLayer, summary: ulpSummary } = dissectPayload(
          data, udp.nextOffset, udp.fields.src_port, udp.fields.dst_port, 'udp'
        );
        if (ulpLayer) layers.push(ulpLayer);
        summary += ulpSummary
          ? ` | ${ulpSummary}`
          : ` | UDP ${udp.fields.src_port}→${udp.fields.dst_port}`;
      }
    } else if (ip6.nextProtocol === 6) {
      const tcp = dissectTCP(data, ip6.nextOffset);
      if (tcp) {
        layers.push(tcp);
        summary += ` | TCP ${tcp.fields.src_port}→${tcp.fields.dst_port} [${tcp.fields.flag_names}]`;

        const payloadOffset = tcp.nextOffset;
        const payloadLen = data.length - payloadOffset;
        if (payloadLen > 0) {
          const { layer: ulpLayer, summary: ulpSummary } = dissectPayload(
            data, payloadOffset, tcp.fields.src_port, tcp.fields.dst_port, 'tcp'
          );
          if (ulpLayer) {
            layers.push(ulpLayer);
            if (ulpSummary) summary += ` | ${ulpSummary}`;
          }
        }
      }
    } else if (ip6.nextProtocol === 58) {
      const icmp6 = dissectICMPv6(data, ip6.nextOffset);
      if (icmp6) {
        layers.push(icmp6);
        summary += ` | ICMPv6 ${icmp6.fields.type_name}`;
        if (icmp6.fields.target_address) summary += ` target=${icmp6.fields.target_address}`;
      }
    } else {
      summary += ` | ${ip6.fields.protocol_name}`;
    }
  } else if (eth.nextProtocol === 0x0806) {
    summary = `ARP ${eth.fields.src_mac} → ${eth.fields.dst_mac}`;
  } else {
    summary = `${eth.fields.ethertype_name} (${eth.fields.ethertype})`;
  }

  return { layers, summary };
}
