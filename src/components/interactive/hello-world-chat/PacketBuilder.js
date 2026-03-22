/**
 * PacketBuilder — constructs a structured packet object with headers for each OSI layer.
 * Each field has: name, abbrev, bits, value, desc (elementary voice), synthetic flag.
 *
 * connectionInfo must include: srcIp, dstIp, srcMAC, dstMAC, srcPort, dstPort
 * These are direction-aware: the caller swaps src/dst for sent vs received packets.
 */

function toHex(num, bytes) {
  return '0x' + (num >>> 0).toString(16).padStart(bytes * 2, '0');
}

const PacketBuilder = {
  build({ text, mode, seqNum, connectionInfo }) {
    const payload = new TextEncoder().encode(text);
    const payloadLen = payload.length;
    const srcIp = connectionInfo?.srcIp || '192.168.1.100';
    const dstIp = connectionInfo?.dstIp || '192.168.1.101';
    const srcPort = connectionInfo?.srcPort || 49152;
    const dstPort = connectionInfo?.dstPort || 443;
    const srcMAC = connectionInfo?.srcMAC || '00:00:00:00:00:00';
    const dstMAC = connectionInfo?.dstMAC || '00:00:00:00:00:00';

    // WebSocket frame fields
    const maskKey = crypto.getRandomValues(new Uint8Array(4));
    const maskKeyHex = Array.from(maskKey).map(b => b.toString(16).padStart(2, '0')).join('');

    // Masked payload (client→server per RFC 6455 §5.1)
    const maskedPayload = new Uint8Array(payloadLen);
    for (let i = 0; i < payloadLen; i++) {
      maskedPayload[i] = payload[i] ^ maskKey[i % 4];
    }

    const layers = {
      7: {
        name: 'Application (WebSocket)',
        layer: 7,
        fields: [
          {
            name: 'FIN + Opcode',
            abbrev: 'ws.fin_opcode',
            bits: 8,
            value: '0x81',
            desc: 'This byte says "this is the complete message and it contains text." The FIN bit (1) means there are no more pieces coming, and opcode 0x1 means text data.',
            synthetic: false,
            rfc: 'RFC 6455 §5.2',
          },
          {
            name: 'Mask + Payload Length',
            abbrev: 'ws.mask_len',
            bits: 8,
            value: toHex(0x80 | (payloadLen < 126 ? payloadLen : 126), 1),
            desc: `The mask bit is set to 1 because browsers must always mask data they send (it's a security rule). The length tells the receiver how many bytes of your message to expect: ${payloadLen} bytes.`,
            synthetic: false,
            rfc: 'RFC 6455 §5.1',
          },
          ...(payloadLen >= 126 ? [{
            name: 'Extended Payload Length',
            abbrev: 'ws.ext_len',
            bits: 16,
            value: toHex(payloadLen, 2),
            desc: `Your message is ${payloadLen} bytes — too big for the 7-bit length field, so we use 16 extra bits to write the real length.`,
            synthetic: false,
            rfc: 'RFC 6455 §5.2',
          }] : []),
          {
            name: 'Masking Key',
            abbrev: 'ws.mask_key',
            bits: 32,
            value: '0x' + maskKeyHex,
            desc: 'A random 4-byte key used to scramble (XOR) your message bytes. This prevents network middleboxes from accidentally treating WebSocket data as HTTP — a clever security trick.',
            synthetic: false,
            rfc: 'RFC 6455 §5.3',
          },
          {
            name: 'Payload Data',
            abbrev: 'ws.payload',
            bits: payloadLen * 8,
            value: text,
            desc: `Your actual message: "${text}" — but XOR'd with the masking key so it looks like random bytes on the wire. The server XORs it back to read your message.`,
            synthetic: false,
          },
        ],
      },

      6: mode === 3 ? {
        name: 'Presentation (TLS 1.3)',
        layer: 6,
        fields: [
          {
            name: 'Content Type',
            abbrev: 'tls.content_type',
            bits: 8,
            value: '0x17',
            desc: 'Type 0x17 means "application data" — your message is inside, encrypted. Anyone who intercepts this packet sees only random-looking bytes.',
            synthetic: false,
            rfc: 'RFC 8446 §5.1',
          },
          {
            name: 'Protocol Version',
            abbrev: 'tls.version',
            bits: 16,
            value: '0x0303',
            desc: 'Says "TLS 1.2" on the wire, but it is actually TLS 1.3. This white lie exists because some broken middleboxes choke on version 1.3, so TLS 1.3 disguises itself as 1.2.',
            synthetic: false,
            rfc: 'RFC 8446 §5.1',
          },
          {
            name: 'Encrypted Payload',
            abbrev: 'tls.encrypted',
            bits: (payloadLen + 29) * 8, // ~overhead estimate
            value: '[encrypted]',
            desc: 'Your message, encrypted with AES-256-GCM. Even though we know what you typed, on the real wire this would be indistinguishable from random noise. Only the server can decrypt it.',
            synthetic: true,
          },
        ],
      } : {
        name: 'Presentation',
        layer: 6,
        fields: [
          {
            name: 'No TLS',
            abbrev: 'tls.none',
            bits: 0,
            value: 'plaintext',
            desc: `In Mode ${mode}, your message travels unencrypted${mode === 1 ? ' within your own computer' : ' on your local network'}. On the real internet (Mode 3), TLS would encrypt everything here.`,
            synthetic: true,
          },
        ],
      },

      4: {
        name: 'Transport (TCP)',
        layer: 4,
        fields: [
          {
            name: 'Source Port',
            abbrev: 'tcp.srcport',
            bits: 16,
            value: srcPort.toString(),
            desc: `Port ${srcPort} — your browser picked this random high number as its return address. Think of it like an apartment number: the IP address gets you to the building, the port gets you to the right app.`,
            synthetic: mode === 1,
            rfc: 'RFC 9293 §3.1',
          },
          {
            name: 'Destination Port',
            abbrev: 'tcp.dstport',
            bits: 16,
            value: dstPort.toString(),
            desc: `Port ${dstPort} (HTTPS) — the well-known port the server is listening on. Ports below 1024 are "well-known" and assigned by IANA.`,
            synthetic: mode === 1,
            rfc: 'RFC 9293 §3.1',
          },
          {
            name: 'Sequence Number',
            abbrev: 'tcp.seq',
            bits: 32,
            value: seqNum.toString(),
            desc: `Sequence number ${seqNum} — TCP uses this to put your data in order. It counts bytes, not packets. After this message, it will increase by ${payloadLen} (the number of bytes in your message).`,
            synthetic: false,
            rfc: 'RFC 9293 §3.3.1',
            endianness: false,
          },
          {
            name: 'Acknowledgment Number',
            abbrev: 'tcp.ack',
            bits: 32,
            value: '0',
            desc: 'This tells the other side "I have received all bytes up to this number." In a real connection this would be tracking what the server has sent us.',
            synthetic: true,
            rfc: 'RFC 9293 §3.3.1',
          },
          {
            name: 'Data Offset + Flags',
            abbrev: 'tcp.flags',
            bits: 16,
            value: '0x5018',
            desc: 'Data offset = 5 (20-byte header, no options). Flags: ACK + PSH — ACK means we acknowledge previous data, PSH means "deliver this to the app right away, don\'t buffer."',
            synthetic: false,
            rfc: 'RFC 9293 §3.1',
          },
          {
            name: 'Window Size',
            abbrev: 'tcp.window',
            bits: 16,
            value: '65535',
            desc: 'We are telling the server "I can receive up to 65,535 more bytes before I need to catch up." This is TCP flow control — it prevents a fast sender from overwhelming a slow receiver.',
            synthetic: true,
            rfc: 'RFC 9293 §3.1',
          },
          {
            name: 'Checksum',
            abbrev: 'tcp.checksum',
            bits: 16,
            value: toHex(Math.floor(Math.random() * 0xFFFF), 2),
            desc: 'A math formula run over the entire segment. The receiver runs the same formula — if the numbers do not match, a bit got flipped in transit and the data is thrown away.',
            synthetic: true,
            rfc: 'RFC 9293 §3.1',
          },
        ],
      },

      3: {
        name: 'Network (IPv4)',
        layer: 3,
        fields: [
          {
            name: 'Version + IHL',
            abbrev: 'ip.ver_ihl',
            bits: 8,
            value: '0x45',
            desc: 'Version 4 (IPv4) with an Internet Header Length of 5 (meaning 5 × 4 = 20 bytes). This first nibble is how routers instantly know whether they are looking at an IPv4 or IPv6 packet.',
            synthetic: false,
            rfc: 'RFC 791 §3.1',
          },
          {
            name: 'Total Length',
            abbrev: 'ip.total_length',
            bits: 16,
            value: (20 + 20 + payloadLen + 14).toString(),
            desc: `The entire packet is ${20 + 20 + payloadLen + 14} bytes. This field is stored in network byte order (big-endian) — the most-significant byte comes first on the wire, even if your CPU stores numbers the other way around.`,
            synthetic: false,
            rfc: 'RFC 791 §3.1',
            endianness: true,
          },
          {
            name: 'TTL',
            abbrev: 'ip.ttl',
            bits: 8,
            value: '64',
            desc: 'Time To Live = 64. Every router that forwards this packet subtracts 1. If it hits 0, the packet is destroyed and an ICMP "time exceeded" error is sent back. This prevents packets from looping forever.',
            synthetic: false,
            rfc: 'RFC 791 §3.1',
          },
          {
            name: 'Protocol',
            abbrev: 'ip.proto',
            bits: 8,
            value: '6',
            desc: 'Protocol 6 = TCP. This tells the receiving IP layer which transport protocol should get the payload. 17 would mean UDP, 1 would mean ICMP.',
            synthetic: false,
            rfc: 'RFC 791 §3.1',
          },
          {
            name: 'Source IP',
            abbrev: 'ip.src',
            bits: 32,
            value: srcIp,
            desc: `Your IP address: ${srcIp}. This is how the server knows where to send the reply. ${mode === 1 ? '(Synthetic — in same-machine mode, packets don\'t actually use IP.)' : ''}`,
            synthetic: mode === 1,
            rfc: 'RFC 791 §3.1',
          },
          {
            name: 'Destination IP',
            abbrev: 'ip.dst',
            bits: 32,
            value: dstIp,
            desc: `The server's IP address: ${dstIp}. Every router between you and the server reads this field to decide which hop is next.`,
            synthetic: mode === 1,
            rfc: 'RFC 791 §3.1',
          },
          {
            name: 'Header Checksum',
            abbrev: 'ip.checksum',
            bits: 16,
            value: toHex(Math.floor(Math.random() * 0xFFFF), 2),
            desc: 'Checksum of the IP header only (not the data). Each router recalculates this because the TTL changes at every hop. IPv6 removed this checksum entirely — it was slowing routers down.',
            synthetic: true,
            rfc: 'RFC 791 §3.1',
          },
        ],
      },

      2: {
        name: 'Data Link (Ethernet)',
        layer: 2,
        fields: [
          {
            name: 'Destination MAC',
            abbrev: 'eth.dst',
            bits: 48,
            value: dstMAC,
            desc: `The next-hop MAC address: ${dstMAC}. Unlike IP addresses that get you across the internet, MAC addresses only matter for the very next link. Your packet will get a new MAC header at every router.`,
            synthetic: true,
            rfc: 'IEEE 802.3',
          },
          {
            name: 'Source MAC',
            abbrev: 'eth.src',
            bits: 48,
            value: srcMAC,
            desc: `Your network card's MAC address: ${srcMAC}. This 48-bit address was burned into your network adapter at the factory (though you can override it).`,
            synthetic: true,
            rfc: 'IEEE 802.3',
          },
          {
            name: 'EtherType',
            abbrev: 'eth.type',
            bits: 16,
            value: '0x0800',
            desc: 'EtherType 0x0800 means the payload is an IPv4 packet. If this were IPv6 it would be 0x86DD. The switch reads this to know what is inside.',
            synthetic: false,
            rfc: 'IEEE 802.3',
          },
          {
            name: 'FCS (Frame Check Sequence)',
            abbrev: 'eth.fcs',
            bits: 32,
            value: toHex(Math.floor(Math.random() * 0xFFFFFFFF), 4),
            desc: 'A CRC-32 checksum computed over the entire frame. The network card checks this the instant the frame arrives — if it does not match, the frame is silently dropped. You never see FCS in Wireshark because the NIC strips it before handing the frame to the OS.',
            synthetic: true,
            rfc: 'IEEE 802.3 §3.2.9',
          },
        ],
      },

      1: {
        name: 'Physical',
        layer: 1,
        fields: [
          {
            name: 'Preamble',
            abbrev: 'phy.preamble',
            bits: 56,
            value: '10101010... (×7)',
            desc: 'Seven bytes of alternating 1s and 0s. This pattern lets the receiver\'s clock lock onto the signal — like a drummer counting "1, 2, 3, 4" before the band starts playing.',
            synthetic: true,
            rfc: 'IEEE 802.3 §3.2.1',
          },
          {
            name: 'SFD (Start Frame Delimiter)',
            abbrev: 'phy.sfd',
            bits: 8,
            value: '0xAB (10101011)',
            desc: 'The pattern breaks: ...10101011. That final "11" says "the real data starts NOW." Everything after this byte is part of the Ethernet frame.',
            synthetic: true,
            rfc: 'IEEE 802.3 §3.2.2',
          },
          {
            name: 'Signal Encoding',
            abbrev: 'phy.encoding',
            bits: 0,
            value: mode === 1 ? 'N/A (in-memory)' : 'PAM-4 / OFDM',
            desc: mode === 1
              ? 'In same-machine mode, bits do not actually become electrical signals — they stay in memory. But on a real network, each bit becomes a voltage level on copper or a light pulse in fiber.'
              : 'On a real cable: copper Ethernet uses PAM-4 (4 voltage levels per symbol) at 25 Gbaud for 100GbE. WiFi uses OFDM (many frequencies carrying data simultaneously). Fiber uses light: on = 1, off = 0.',
            synthetic: true,
          },
        ],
      },
    };

    // Compute total bits and bytes
    let totalBits = 0;
    for (const layer of Object.values(layers)) {
      for (const field of layer.fields) {
        totalBits += field.bits;
      }
    }

    return {
      layers,
      text,
      payloadBytes: payload,
      totalBits,
      totalBytes: Math.ceil(totalBits / 8),
      timestamp: Date.now(),
      seqNum,
    };
  },
};

export default PacketBuilder;
