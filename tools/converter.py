#!/usr/bin/env python3
"""
proto-viz PCAP → Scenario Converter
====================================
Parses a PCAP file, classifies the protocol exchange using Scapy + custom
dissectors, calls the Claude API for description generation and field
annotation, and emits a proto-viz scenario YAML.

Usage:
    python pcap_to_scenario.py <input.pcap> [--out <output.yaml>] [--api-key <key>]

Requirements:
    pip install scapy pyyaml anthropic

Supported protocols (Phase 1):
    - RoCEv2 (BTH/RETH/AETH over UDP/4791)
    - ARP
    - ICMP / Ping
    - TCP (3-way handshake detection)
    - iWARP (DDP/RDMAP over TCP)
    - NVMe-oF/TCP (basic)

Architecture:
    1. Dissection   — Scapy layer parsing + custom RoCE/IB dissectors
    2. Classification — Rule-based protocol exchange classifier
    3. Annotation   — Per-field description + spec ref enrichment
    4. AI Enhancement — Claude API for natural language description + edge cases
    5. Serialization  — YAML output conforming to scenario.schema.json
"""

import sys
import os
import json
import hashlib
import datetime
import argparse
from collections import defaultdict
from typing import Optional

try:
    import yaml
    YAML_AVAILABLE = True
except ImportError:
    YAML_AVAILABLE = False
    print("Warning: PyYAML not installed. Output will be JSON. pip install pyyaml")

try:
    from scapy.all import rdpcap, Ether, IP, IPv6, UDP, TCP, ARP, ICMP, Raw
    SCAPY_AVAILABLE = True
except ImportError:
    SCAPY_AVAILABLE = False
    print("Error: Scapy not installed. pip install scapy")
    sys.exit(1)

try:
    import anthropic
    CLAUDE_AVAILABLE = True
except ImportError:
    CLAUDE_AVAILABLE = False
    print("Warning: anthropic not installed. AI annotation disabled. pip install anthropic")


# ─── IB/RoCE Constants ────────────────────────────────────────────────────

ROCEV2_UDP_PORT = 4791

IB_OPCODES = {
    0x00: "RC Send First",
    0x01: "RC Send Middle",
    0x02: "RC Send Last",
    0x03: "RC Send Last with Immediate",
    0x04: "RC Send Only",
    0x05: "RC Send Only with Immediate",
    0x06: "RC RDMA Write First",
    0x07: "RC RDMA Write Middle",
    0x08: "RC RDMA Write Last",
    0x09: "RC RDMA Write Last with Immediate",
    0x0A: "RC RDMA Write Only",
    0x0B: "RC RDMA Write Only with Immediate",
    0x0C: "RC RDMA Read Request",
    0x0D: "RC RDMA Read Response First",
    0x0E: "RC RDMA Read Response Middle",
    0x0F: "RC RDMA Read Response Last",
    0x10: "RC RDMA Read Response Only",
    0x11: "RC Acknowledge",
    0x12: "RC Atomic Acknowledge",
    0x13: "RC Compare and Swap",
    0x14: "RC Fetch and Add",
    0x15: "RC Resync",
    0x64: "CM Request",
    0x65: "CM Reply",
    0x66: "CM RTU",
    0x67: "CM Reject",
    0x68: "CM MRA",
    0x69: "CM DREQ",
    0x6A: "CM DREP",
}

CM_OPCODES = {0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A}

IB_OPCODE_HEADERS = {
    0x0A: ["BTH", "RETH", "Payload", "ICRC"],
    0x0B: ["BTH", "RETH", "ImmDt", "Payload", "ICRC"],
    0x0C: ["BTH", "RETH", "ICRC"],
    0x10: ["BTH", "AETH", "Payload", "ICRC"],
    0x11: ["BTH", "AETH", "ICRC"],
    0x64: ["BTH", "DETH", "MAD_CM_REQ", "ICRC"],
    0x65: ["BTH", "DETH", "MAD_CM_REP", "ICRC"],
    0x66: ["BTH", "DETH", "MAD_CM_RTU", "ICRC"],
}

# ─── Spec References Database ──────────────────────────────────────────────

SPEC_REFS = {
    "eth.type": [{"document":"IEEE 802.3","section":"3.2","title":"EtherType","url":"https://standards.ieee.org/ieee/802.3/7661/"}],
    "ip.proto": [{"document":"IANA","section":"Protocol Numbers","url":"https://www.iana.org/assignments/protocol-numbers/"}],
    "ip.dscp":  [{"document":"RFC 3168","section":"5","title":"ECN in IP","url":"https://datatracker.ietf.org/doc/html/rfc3168#section-5"}],
    "udp.dstport_4791": [{"document":"RFC 7871","section":"7","title":"RoCEv2 UDP Port 4791","url":"https://datatracker.ietf.org/doc/html/rfc7871#section-7"}],
    "bth.opcode": [{"document":"IBTA Vol1","section":"5.3.1","title":"BTH Opcode","url":"https://www.infinibandta.org/ibta-specification/"}],
    "bth.psn":    [{"document":"IBTA Vol1","section":"9.4","title":"Packet Sequence Number","url":"https://www.infinibandta.org/ibta-specification/"}],
    "bth.fecn":   [{"document":"IBTA Vol1","section":"3.5.4","title":"FECN","url":"https://www.infinibandta.org/ibta-specification/"}],
    "reth.vaddr": [{"document":"IBTA Vol1","section":"9.7.5.3","title":"RETH Virtual Address","url":"https://www.infinibandta.org/ibta-specification/"}],
    "reth.rkey":  [{"document":"IBTA Vol1","section":"10.6.3","title":"R_Key","url":"https://www.infinibandta.org/ibta-specification/"}],
    "aeth.syndrome":[{"document":"IBTA Vol1","section":"9.7.7","title":"AETH Syndrome","url":"https://www.infinibandta.org/ibta-specification/"}],
    "cm.local_qpn":[{"document":"IBTA Vol1","section":"12.6.5","title":"CM REQ QPN","url":"https://www.infinibandta.org/ibta-specification/"}],
    "pfc.quanta": [{"document":"IEEE 802.1Qbb","section":"36.2","title":"PFC PAUSE Quanta","url":"https://standards.ieee.org/ieee/802.1Qbb/4788/"}],
    "tcp.flags":  [{"document":"RFC 793","section":"3.1","title":"TCP Header Flags","url":"https://datatracker.ietf.org/doc/html/rfc793#section-3.1"}],
}

# ─── RoCE BTH Dissector ────────────────────────────────────────────────────

def parse_bth(raw: bytes) -> Optional[dict]:
    """Parse InfiniBand Base Transport Header (12 bytes)"""
    if len(raw) < 12:
        return None
    opcode = raw[0]
    flags_byte = raw[1]
    se = (flags_byte >> 7) & 1
    mig = (flags_byte >> 6) & 1
    padcnt = (flags_byte >> 4) & 3
    tver = flags_byte & 0xF
    pkey = (raw[2] << 8) | raw[3]
    fecn_becn_byte = raw[4]
    fecn = (fecn_becn_byte >> 7) & 1
    becn = (fecn_becn_byte >> 6) & 1
    res1 = fecn_becn_byte & 0x3F
    destqp = (raw[5] << 16) | (raw[6] << 8) | raw[7]
    ackreq_byte = raw[8]
    ackreq = (ackreq_byte >> 7) & 1
    psn = (raw[9] << 16) | (raw[10] << 8) | raw[11]
    return {
        "opcode": opcode,
        "opcode_name": IB_OPCODES.get(opcode, f"Unknown(0x{opcode:02X})"),
        "se": se,
        "mig": mig,
        "padcnt": padcnt,
        "tver": tver,
        "pkey": pkey,
        "fecn": fecn,
        "becn": becn,
        "destqp": destqp,
        "ackreq": ackreq,
        "psn": psn,
    }


def parse_reth(raw: bytes) -> Optional[dict]:
    """Parse RDMA Extended Transport Header (16 bytes)"""
    if len(raw) < 16:
        return None
    vaddr = int.from_bytes(raw[0:8], "big")
    rkey = int.from_bytes(raw[8:12], "big")
    dma_len = int.from_bytes(raw[12:16], "big")
    return {"vaddr": vaddr, "rkey": rkey, "dma_len": dma_len}


def parse_aeth(raw: bytes) -> Optional[dict]:
    """Parse ACK Extended Transport Header (4 bytes)"""
    if len(raw) < 4:
        return None
    syndrome = raw[0]
    msn = (raw[1] << 16) | (raw[2] << 8) | raw[3]
    syndrome_names = {
        0x00: "ACK",
        **{v: f"RNR NAK (timer={v&0x1F})" for v in range(0x20, 0x40)},
        0x60: "NAK: PSN Sequence Error",
        0x61: "NAK: Invalid Request",
        0x62: "NAK: Remote Access Error",
        0x63: "NAK: Remote Operation Error",
        0x64: "NAK: Invalid RD Request",
    }
    return {
        "syndrome": syndrome,
        "syndrome_name": syndrome_names.get(syndrome, f"NAK(0x{syndrome:02X})"),
        "msn": msn,
    }


# ─── Protocol Classifier ───────────────────────────────────────────────────

class ExchangeClassifier:
    """
    Classifies a sequence of parsed packets into a named protocol exchange.
    Returns a structured description suitable for scenario generation.
    """

    def classify(self, flows: list) -> dict:
        """
        flows: list of parsed packet dicts
        Returns: { type, subtype, description, actors, phases }
        """
        protocols = set(f["protocol"] for f in flows)
        has_rocev2 = "RoCEv2" in protocols
        has_arp = "ARP" in protocols
        has_tcp = "TCP" in protocols

        if has_rocev2:
            return self._classify_rocev2(flows)
        elif has_tcp:
            return self._classify_tcp(flows)
        elif has_arp:
            return {"type":"ARP","subtype":"arp_resolution","description":"ARP resolution exchange"}
        else:
            return {"type":"Unknown","subtype":"generic","description":"Unrecognized exchange"}

    def _classify_rocev2(self, flows):
        opcodes = [f.get("bth",{}).get("opcode") for f in flows if f.get("bth")]
        has_cm = any(op in CM_OPCODES for op in opcodes if op)
        has_write = any(op in {0x06,0x07,0x08,0x09,0x0A,0x0B} for op in opcodes if op)
        has_read = any(op == 0x0C for op in opcodes if op)
        has_send = any(op in {0x00,0x01,0x02,0x03,0x04,0x05} for op in opcodes if op)

        subtype = "rocev2_rc"
        desc_parts = ["RoCEv2 RC exchange including"]
        if has_cm: desc_parts.append("CM connection setup (REQ/REP/RTU)")
        if has_write: desc_parts.append("RDMA WRITE")
        if has_read: desc_parts.append("RDMA READ")
        if has_send: desc_parts.append("SEND")

        return {
            "type": "RoCEv2",
            "subtype": subtype,
            "description": " + ".join(desc_parts),
            "has_cm": has_cm,
            "has_write": has_write,
            "has_read": has_read,
            "has_send": has_send,
        }

    def _classify_tcp(self, flows):
        tcp_flags = [f.get("tcp_flags","") for f in flows]
        has_syn = any("S" in f and "A" not in f for f in tcp_flags)
        has_synack = any("SA" in f for f in tcp_flags)
        has_fin = any("F" in f for f in tcp_flags)
        if has_syn and has_synack:
            return {"type":"TCP","subtype":"tcp_connection","description":"TCP 3-way handshake" + (" + teardown" if has_fin else "")}
        return {"type":"TCP","subtype":"tcp_data","description":"TCP data exchange"}


# ─── Packet Parser ─────────────────────────────────────────────────────────

def parse_packet(pkt, pkt_idx: int) -> dict:
    """Extract structured info from a Scapy packet."""
    result = {
        "idx": pkt_idx,
        "protocol": "Unknown",
        "layers": [],
        "frame_bytes": len(pkt),
        "timestamp": float(pkt.time),
    }

    if pkt.haslayer(Ether):
        eth = pkt[Ether]
        result["eth"] = {
            "src": eth.src,
            "dst": eth.dst,
            "type": f"0x{eth.type:04X}",
        }
        result["src_mac"] = eth.src
        result["dst_mac"] = eth.dst
        result["layers"].append("Ethernet")

    if pkt.haslayer(ARP):
        arp = pkt[ARP]
        result["protocol"] = "ARP"
        result["arp"] = {
            "opcode": arp.op,
            "src_mac": arp.hwsrc,
            "dst_mac": arp.hwdst,
            "src_ip": arp.psrc,
            "dst_ip": arp.pdst,
        }
        result["layers"].append("ARP")
        return result

    if pkt.haslayer(IP):
        ip = pkt[IP]
        result["ip"] = {
            "src": ip.src,
            "dst": ip.dst,
            "ttl": ip.ttl,
            "proto": ip.proto,
            "dscp": (ip.tos >> 2) & 0x3F,
            "ecn": ip.tos & 0x3,
            "len": ip.len,
        }
        result["src_ip"] = ip.src
        result["dst_ip"] = ip.dst
        result["layers"].append("IPv4")

    if pkt.haslayer(UDP):
        udp = pkt[UDP]
        result["udp"] = {
            "sport": udp.sport,
            "dport": udp.dport,
            "len": udp.len,
        }
        result["layers"].append("UDP")

        if udp.dport == ROCEV2_UDP_PORT or udp.sport == ROCEV2_UDP_PORT:
            result["protocol"] = "RoCEv2"
            raw_payload = bytes(udp.payload)
            if len(raw_payload) >= 12:
                bth = parse_bth(raw_payload[:12])
                if bth:
                    result["bth"] = bth
                    result["opcode_name"] = bth["opcode_name"]
                    result["layers"].append(f"BTH({bth['opcode_name']})")
                    offset = 12

                    opcode = bth["opcode"]
                    if opcode in {0x0A,0x0B,0x06,0x0C} and len(raw_payload) >= offset+16:
                        reth = parse_reth(raw_payload[offset:offset+16])
                        if reth:
                            result["reth"] = reth
                            result["layers"].append("RETH")
                            offset += 16

                    if opcode in {0x10,0x0F,0x11,0x12} and len(raw_payload) >= offset+4:
                        aeth = parse_aeth(raw_payload[offset:offset+4])
                        if aeth:
                            result["aeth"] = aeth
                            result["layers"].append(f"AETH({aeth['syndrome_name']})")
                            offset += 4

                    payload_len = len(raw_payload) - offset - 4  # subtract ICRC
                    if payload_len > 0:
                        result["payload_bytes"] = payload_len
                        result["layers"].append(f"Payload({payload_len}B)")

    if pkt.haslayer(TCP):
        tcp = pkt[TCP]
        flags = ""
        if tcp.flags & 0x02: flags += "S"
        if tcp.flags & 0x10: flags += "A"
        if tcp.flags & 0x01: flags += "F"
        if tcp.flags & 0x04: flags += "R"
        if tcp.flags & 0x08: flags += "P"
        result["tcp"] = {
            "sport": tcp.sport,
            "dport": tcp.dport,
            "seq": tcp.seq,
            "ack": tcp.ack,
            "flags": flags,
        }
        result["tcp_flags"] = flags
        result["protocol"] = "TCP"
        result["layers"].append(f"TCP({flags})")

    if pkt.haslayer(ICMP):
        icmp = pkt[ICMP]
        result["protocol"] = "ICMP"
        result["icmp"] = {"type": icmp.type, "code": icmp.code}
        result["layers"].append(f"ICMP(type={icmp.type})")

    return result


# ─── Actor Extractor ───────────────────────────────────────────────────────

def extract_actors(parsed_pkts: list) -> list:
    """Infer actors (hosts, etc.) from packet flows."""
    seen = {}  # ip -> {mac, ...}
    for pkt in parsed_pkts:
        src_ip = pkt.get("src_ip")
        src_mac = pkt.get("src_mac")
        if src_ip and src_mac and src_ip not in seen:
            seen[src_ip] = {"ip": src_ip, "mac": src_mac}
        if pkt.get("arp"):
            arp = pkt["arp"]
            if arp["src_ip"] not in seen:
                seen[arp["src_ip"]] = {"ip": arp["src_ip"], "mac": arp["src_mac"]}

    actors = []
    ips = sorted(seen.keys())
    roles = ["initiator","target","third_party"]
    for i, ip in enumerate(ips):
        info = seen[ip]
        actor = {
            "id": roles[i] if i < len(roles) else f"host_{i}",
            "type": roles[i] if i < len(roles) else "host",
            "label": f"Host {chr(65+i)} ({roles[i].capitalize() if i<2 else 'Host'})",
            "ip": ip,
            "mac": info["mac"],
            "position": ["left","right","center"][min(i,2)],
        }
        actors.append(actor)

    # Add switch if we see packets going through the same MAC pairs
    if len(actors) >= 2:
        actors.insert(1, {
            "id": "switch",
            "type": "switch",
            "label": "Switch",
            "position": "center",
        })

    return actors


# ─── Timeline Builder ──────────────────────────────────────────────────────

def build_timeline(parsed_pkts: list, actors: list) -> list:
    """Convert parsed packets into timeline events."""
    events = []
    t0 = parsed_pkts[0]["timestamp"] if parsed_pkts else 0
    actor_by_ip = {a.get("ip"): a["id"] for a in actors if a.get("ip")}

    for pkt in parsed_pkts:
        t_ns = int((pkt["timestamp"] - t0) * 1e9)
        from_actor = actor_by_ip.get(pkt.get("src_ip"), "unknown")
        to_actor = actor_by_ip.get(pkt.get("dst_ip"), "broadcast")

        event = {
            "id": f"evt_{pkt['idx']}",
            "type": "frame_tx",
            "t_ns": t_ns,
            "frame_id": f"frame_{pkt['idx']}",
            "annotation": {
                "text": " + ".join(pkt["layers"]),
                "detail": describe_packet(pkt),
            }
        }
        events.append(event)

    return events


def describe_packet(pkt: dict) -> str:
    """Generate a human-readable description of a parsed packet."""
    parts = []
    protocol = pkt.get("protocol","Unknown")
    if protocol == "ARP":
        arp = pkt["arp"]
        if arp["opcode"] == 1:
            return f"ARP Request: Who has {arp['dst_ip']}? Tell {arp['src_ip']}"
        else:
            return f"ARP Reply: {arp['src_ip']} is at {arp['src_mac']}"
    if protocol == "RoCEv2":
        bth = pkt.get("bth", {})
        desc = f"RoCEv2 {bth.get('opcode_name','?')} | DestQP=0x{bth.get('destqp',0):06X} PSN={bth.get('psn',0)}"
        if pkt.get("reth"):
            reth = pkt["reth"]
            desc += f" | RETH vaddr=0x{reth['vaddr']:016X} rkey=0x{reth['rkey']:08X} len={reth['dma_len']}"
        if pkt.get("aeth"):
            aeth = pkt["aeth"]
            desc += f" | AETH {aeth['syndrome_name']} MSN={aeth['msn']}"
        if pkt.get("payload_bytes"):
            desc += f" | {pkt['payload_bytes']}B payload"
        return desc
    if protocol == "TCP":
        tcp = pkt["tcp"]
        return f"TCP [{tcp.get('flags','')}] {pkt.get('src_ip')}:{tcp['sport']} → {pkt.get('dst_ip')}:{tcp['dport']} seq={tcp['seq']}"
    return " | ".join(pkt.get("layers", ["Unknown"]))


# ─── AI Annotation via Claude ──────────────────────────────────────────────

def enhance_with_ai(scenario_dict: dict, classification: dict, api_key: Optional[str] = None) -> dict:
    """
    Use Claude API to:
    1. Write the meta.description
    2. Generate learning_objectives
    3. Add detailed field annotations for any fields missing descriptions
    """
    if not CLAUDE_AVAILABLE:
        return scenario_dict

    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        print("  (No ANTHROPIC_API_KEY — skipping AI enhancement)")
        return scenario_dict

    client = anthropic.Anthropic(api_key=key)

    prompt = f"""You are a network protocol expert and technical writer contributing to proto-viz,
an open-source interactive protocol education platform.

I have parsed a PCAP file and classified the exchange as:
{json.dumps(classification, indent=2)}

I have generated a partial scenario YAML. Please:
1. Write a detailed meta.description (2-3 sentences, technically accurate, suitable for network engineers)
2. Generate 4-6 learning_objectives (what will someone learn from watching this scenario?)
3. If this is a RoCEv2 exchange, note the specific IBTA spec sections most relevant

Respond with JSON only:
{{
  "description": "...",
  "learning_objectives": ["...", "..."],
  "spec_notes": "..."
}}"""

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1000,
            messages=[{"role":"user","content":prompt}]
        )
        text = response.content[0].text
        clean = text.strip().lstrip("```json").rstrip("```").strip()
        ai_data = json.loads(clean)
        scenario_dict["meta"]["description"] = ai_data.get("description", scenario_dict["meta"]["description"])
        scenario_dict["meta"]["learning_objectives"] = ai_data.get("learning_objectives", [])
        if ai_data.get("spec_notes"):
            scenario_dict["meta"]["spec_notes"] = ai_data["spec_notes"]
        print("  ✓ AI enhancement applied")
    except Exception as e:
        print(f"  Warning: AI enhancement failed: {e}")

    return scenario_dict


# ─── Scenario Builder ──────────────────────────────────────────────────────

def build_scenario(parsed_pkts: list, classification: dict, pcap_path: str) -> dict:
    """Assemble the complete scenario dict from parsed packets."""
    actors = extract_actors(parsed_pkts)
    timeline = build_timeline(parsed_pkts, actors)
    frames = build_frames(parsed_pkts, actors)

    slug = os.path.splitext(os.path.basename(pcap_path))[0].lower().replace(" ","-")
    slug = "".join(c for c in slug if c.isalnum() or c=="-")

    scenario = {
        "meta": {
            "id": slug,
            "title": f"Auto-generated: {classification['description']}",
            "protocol": classification["type"],
            "protocol_family": "RDMA" if "RoCE" in classification["type"] else classification["type"],
            "version": "1.0.0",
            "description": f"Auto-generated scenario from {os.path.basename(pcap_path)}. "
                           f"Classification: {classification['description']}. "
                           f"Review and enhance field annotations before publishing.",
            "learning_objectives": [],
            "difficulty": "intermediate",
            "authors": [
                {"name":"pcap_to_scenario.py (proto-viz)","org":"proto-viz","github":"proto-viz"}
            ],
            "created": datetime.date.today().isoformat(),
            "updated": datetime.date.today().isoformat(),
            "tags": list({classification["type"],"auto-generated"}),
            "primary_specs": [],
            "pcap_source": os.path.basename(pcap_path),
            "pcap_sha256": sha256_file(pcap_path),
        },
        "topology": {
            "actors": actors,
            "links": generate_links(actors),
        },
        "osi_layers": {},  # Populated per-actor by engine
        "frames": frames,
        "timeline": timeline,
        "glossary": [],
    }

    return scenario


def build_frames(parsed_pkts: list, actors: list) -> list:
    """Build frame library from parsed packets."""
    actor_by_ip = {a.get("ip"): a["id"] for a in actors if a.get("ip")}
    frames = []

    for pkt in parsed_pkts:
        frame = {
            "id": f"frame_{pkt['idx']}",
            "name": " / ".join(pkt["layers"][:3]),
            "description": describe_packet(pkt),
            "from": actor_by_ip.get(pkt.get("src_ip"), "unknown"),
            "to": actor_by_ip.get(pkt.get("dst_ip"), "broadcast"),
            "via": ["switch"],
            "timestamp_ns": 0,
            "total_bytes": pkt["frame_bytes"],
            "headers": build_headers(pkt),
        }
        frames.append(frame)

    return frames


def build_headers(pkt: dict) -> list:
    """Build header blocks from a parsed packet."""
    headers = []

    if pkt.get("eth"):
        eth = pkt["eth"]
        headers.append({
            "name": "Ethernet II",
            "abbrev": "eth",
            "layer": 2,
            "fields": [
                {"name":"Destination","abbrev":"eth.dst","bits":48,"value":eth["dst"],"description":"Destination MAC address"},
                {"name":"Source","abbrev":"eth.src","bits":48,"value":eth["src"],"description":"Source MAC address"},
                {"name":"EtherType","abbrev":"eth.type","bits":16,"value":eth["type"],"description":"Protocol identifier",
                 "spec_refs": SPEC_REFS.get("eth.type",[])},
            ]
        })

    if pkt.get("ip"):
        ip = pkt["ip"]
        ecn_names = {0:"Not-ECT",1:"ECT(1)",2:"ECT(0)",3:"CE (Congestion Experienced)"}
        headers.append({
            "name": "IPv4",
            "abbrev": "ip",
            "layer": 3,
            "fields": [
                {"name":"Source","abbrev":"ip.src","bits":32,"value":ip["src"],"description":"Source IP"},
                {"name":"Destination","abbrev":"ip.dst","bits":32,"value":ip["dst"],"description":"Destination IP"},
                {"name":"TTL","abbrev":"ip.ttl","bits":8,"value":ip["ttl"],"description":"Time To Live"},
                {"name":"Protocol","abbrev":"ip.proto","bits":8,"value":ip["proto"],"description":f"Protocol number ({ip['proto']} = {'UDP' if ip['proto']==17 else 'TCP' if ip['proto']==6 else 'ICMP' if ip['proto']==1 else 'other'})","spec_refs":SPEC_REFS.get("ip.proto",[])},
                {"name":"DSCP","abbrev":"ip.dscp","bits":6,"value":ip["dscp"],"description":f"Differentiated Services Code Point = {ip['dscp']}","spec_refs":SPEC_REFS.get("ip.dscp",[])},
                {"name":"ECN","abbrev":"ip.ecn","bits":2,"value":ip["ecn"],"description":ecn_names.get(ip["ecn"],str(ip["ecn"]))},
            ]
        })

    if pkt.get("udp"):
        udp = pkt["udp"]
        is_rocev2 = udp["dport"] == ROCEV2_UDP_PORT or udp["sport"] == ROCEV2_UDP_PORT
        headers.append({
            "name": "UDP",
            "abbrev": "udp",
            "layer": 4,
            "fields": [
                {"name":"Source Port","abbrev":"udp.srcport","bits":16,"value":udp["sport"],"description":"UDP source port"},
                {"name":"Destination Port","abbrev":"udp.dstport","bits":16,"value":udp["dport"],
                 "description":"4791 = RoCEv2 (IANA assigned)" if is_rocev2 else "UDP destination port",
                 "spec_refs": SPEC_REFS.get("udp.dstport_4791",[]) if is_rocev2 else []},
                {"name":"Length","abbrev":"udp.length","bits":16,"value":udp["len"],"description":"UDP datagram length"},
                {"name":"Checksum","abbrev":"udp.checksum","bits":16,"value":"0x0000" if is_rocev2 else "<computed>",
                 "description":"Always 0 for RoCEv2 — ICRC covers integrity" if is_rocev2 else "UDP checksum"},
            ]
        })

    if pkt.get("bth"):
        bth = pkt["bth"]
        hdr = {
            "name": f"IB BTH ({bth['opcode_name']})",
            "abbrev": "infiniband.bth",
            "layer": 5,
            "fields": [
                {"name":"Opcode","abbrev":"infiniband.bth.opcode","bits":8,
                 "value":f"0x{bth['opcode']:02X} ({bth['opcode_name']})","description":bth['opcode_name'],
                 "spec_refs":SPEC_REFS.get("bth.opcode",[])},
                {"name":"SE","abbrev":"infiniband.bth.se","bits":1,"value":bth["se"],"description":"Solicited Event"},
                {"name":"P_Key","abbrev":"infiniband.bth.pkey","bits":16,"value":f"0x{bth['pkey']:04X}","description":"Partition Key"},
                {"name":"FECN","abbrev":"infiniband.bth.fecn","bits":1,"value":bth["fecn"],
                 "description":"Forward ECN — congestion signal","spec_refs":SPEC_REFS.get("bth.fecn",[])},
                {"name":"BECN","abbrev":"infiniband.bth.becn","bits":1,"value":bth["becn"],"description":"Backward ECN"},
                {"name":"Destination QP","abbrev":"infiniband.bth.destqp","bits":24,
                 "value":f"0x{bth['destqp']:06X}","description":"Destination Queue Pair number"},
                {"name":"ACK Req","abbrev":"infiniband.bth.ackreq","bits":1,"value":bth["ackreq"],"description":"Request acknowledgement"},
                {"name":"PSN","abbrev":"infiniband.bth.psn","bits":24,"value":bth["psn"],
                 "description":"Packet Sequence Number","spec_refs":SPEC_REFS.get("bth.psn",[])},
            ]
        }
        headers.append(hdr)

    if pkt.get("reth"):
        reth = pkt["reth"]
        headers.append({
            "name": "IB RETH (RDMA Extended Transport Header)",
            "abbrev": "infiniband.reth",
            "layer": 5,
            "fields": [
                {"name":"Virtual Address","abbrev":"infiniband.reth.virtual_address","bits":64,
                 "value":f"0x{reth['vaddr']:016X}","description":"Remote memory virtual address",
                 "spec_refs":SPEC_REFS.get("reth.vaddr",[])},
                {"name":"R_Key","abbrev":"infiniband.reth.r_key","bits":32,
                 "value":f"0x{reth['rkey']:08X}","description":"Remote Memory Region authorization key",
                 "spec_refs":SPEC_REFS.get("reth.rkey",[])},
                {"name":"DMA Length","abbrev":"infiniband.reth.dma_length","bits":32,
                 "value":reth["dma_len"],"description":"Total RDMA operation length in bytes"},
            ]
        })

    if pkt.get("aeth"):
        aeth = pkt["aeth"]
        headers.append({
            "name": f"IB AETH ({aeth['syndrome_name']})",
            "abbrev": "infiniband.aeth",
            "layer": 5,
            "fields": [
                {"name":"Syndrome","abbrev":"infiniband.aeth.syndrome","bits":8,
                 "value":f"0x{aeth['syndrome']:02X} ({aeth['syndrome_name']})","description":aeth["syndrome_name"],
                 "spec_refs":SPEC_REFS.get("aeth.syndrome",[])},
                {"name":"MSN","abbrev":"infiniband.aeth.msn","bits":24,
                 "value":aeth["msn"],"description":"Message Sequence Number — cumulative completed messages"},
            ]
        })

    if pkt.get("arp"):
        arp = pkt["arp"]
        headers.append({
            "name": "ARP",
            "abbrev": "arp",
            "layer": 3,
            "fields": [
                {"name":"Opcode","abbrev":"arp.opcode","bits":16,
                 "value":f"{arp['opcode']} ({'Request' if arp['opcode']==1 else 'Reply'})","description":"ARP operation type"},
                {"name":"Sender MAC","abbrev":"arp.src.hw_mac","bits":48,"value":arp["src_mac"],"description":"Sender hardware address"},
                {"name":"Sender IP","abbrev":"arp.src.proto_ipv4","bits":32,"value":arp["src_ip"],"description":"Sender protocol address"},
                {"name":"Target MAC","abbrev":"arp.dst.hw_mac","bits":48,"value":arp["dst_mac"],"description":"Target hardware address (00:00:00:00:00:00 in request)"},
                {"name":"Target IP","abbrev":"arp.dst.proto_ipv4","bits":32,"value":arp["dst_ip"],"description":"Target protocol address"},
            ]
        })

    return headers


def generate_links(actors: list) -> list:
    """Generate plausible link definitions between actors."""
    links = []
    switch = next((a for a in actors if a.get("type")=="switch"), None)
    if switch:
        for actor in actors:
            if actor["id"] != "switch":
                links.append({
                    "id": f"link-{actor['id']}-sw",
                    "from": actor["id"],
                    "to": "switch",
                    "speed_gbps": 100,
                    "media": "fiber_sr",
                    "fec": "RS(544,514)",
                    "autoneg": True,
                })
    return links


def sha256_file(path: str) -> str:
    try:
        h = hashlib.sha256()
        with open(path,"rb") as f:
            h.update(f.read())
        return h.hexdigest()[:16]
    except:
        return "unknown"


# ─── Main ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="proto-viz PCAP → Scenario Converter")
    parser.add_argument("pcap", help="Input PCAP file")
    parser.add_argument("--out", help="Output YAML file (default: <input>.scenario.yaml)")
    parser.add_argument("--api-key", help="Anthropic API key (or set ANTHROPIC_API_KEY env var)")
    parser.add_argument("--no-ai", action="store_true", help="Skip Claude AI enhancement")
    parser.add_argument("--max-packets", type=int, default=200, help="Max packets to process (default 200)")
    args = parser.parse_args()

    if not os.path.exists(args.pcap):
        print(f"Error: File not found: {args.pcap}")
        sys.exit(1)

    print(f"proto-viz PCAP → Scenario Converter")
    print(f"Input: {args.pcap}")

    # 1. Load PCAP
    print("  Loading PCAP...")
    try:
        pkts = rdpcap(args.pcap)
    except Exception as e:
        print(f"Error reading PCAP: {e}")
        sys.exit(1)

    pkts = list(pkts)[:args.max_packets]
    print(f"  Loaded {len(pkts)} packets")

    # 2. Parse packets
    print("  Parsing packets...")
    parsed = [parse_packet(pkt, i) for i, pkt in enumerate(pkts)]
    protocols = set(p["protocol"] for p in parsed)
    print(f"  Protocols detected: {', '.join(protocols)}")

    # 3. Classify exchange
    print("  Classifying exchange...")
    classifier = ExchangeClassifier()
    classification = classifier.classify(parsed)
    print(f"  Classification: {classification['type']} — {classification['description']}")

    # 4. Build scenario
    print("  Building scenario...")
    scenario = build_scenario(parsed, classification, args.pcap)

    # 5. AI enhancement
    if not args.no_ai and CLAUDE_AVAILABLE:
        print("  Enhancing with Claude AI...")
        scenario = enhance_with_ai(scenario, classification, args.api_key)

    # 6. Output
    out_path = args.out or (os.path.splitext(args.pcap)[0] + ".scenario.yaml")
    print(f"  Writing: {out_path}")

    if YAML_AVAILABLE:
        with open(out_path, "w") as f:
            yaml.dump(scenario, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    else:
        out_path = out_path.replace(".yaml",".json")
        with open(out_path,"w") as f:
            json.dump(scenario, f, indent=2)

    print(f"\n✓ Done: {out_path}")
    print(f"  Packets: {len(parsed)} | Frames: {len(scenario['frames'])} | Events: {len(scenario['timeline'])}")
    print(f"\nNext steps:")
    print(f"  1. Review field descriptions in generated YAML")
    print(f"  2. Add osi_layers state definitions")
    print(f"  3. Add state_after entries to timeline events")
    print(f"  4. Submit PR to proto-viz/scenarios/")


if __name__ == "__main__":
    main()
