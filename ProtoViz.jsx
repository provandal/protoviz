import { useState, useEffect, useRef, useCallback } from "react";

// ─── Embedded scenario data (subset of the full YAML, JSON form) ───────────
const SCENARIO = {
  meta: {
    title: "RoCEv2 RC: Link Training → QP Connection → RDMA WRITE → RDMA READ",
    protocol: "RoCEv2",
    description: "Complete RoCEv2 Reliable Connected exchange over 100GbE: physical link establishment, ARP, IB Connection Manager QP bring-up, RDMA WRITE (zero remote CPU), RDMA READ (zero remote CPU).",
    difficulty: "advanced",
    tags: ["RDMA","RoCEv2","InfiniBand","100GbE","PFC","SNIA"],
  },
  actors: [
    { id:"initiator", label:"Host A (Initiator)", type:"initiator", ip:"192.168.1.10", mac:"00:02:c9:12:34:56", hw:"Mellanox ConnectX-6 Dx", pos:"left" },
    { id:"switch",    label:"100GbE Switch",       type:"switch",    pos:"center" },
    { id:"target",    label:"Host B (Target)",     type:"target",    ip:"192.168.1.20", mac:"00:02:c9:ab:cd:ef", hw:"Mellanox ConnectX-6 Dx", pos:"right" },
  ],
  osi_layers: {
    initiator: [
      { layer:7, name:"Application / Verbs",   color:"#7c3aed", fields:{ app_state:"idle", posted_wr:"none", cq_entries:0, mr_registered:false } },
      { layer:6, name:"CM / rdma-cm",           color:"#6d28d9", fields:{ cm_state:"idle", cm_id:"null" } },
      { layer:5, name:"IB Transport (RC QP)",   color:"#1d4ed8", fields:{ qp_state:"RESET", qp_num:"—", psn_send:0, rkey:"—", remote_qpn:"—", pmtu:"—" } },
      { layer:4, name:"UDP (RoCEv2 / port 4791)",color:"#0369a1",fields:{ src_port:0, dst_port:4791 } },
      { layer:3, name:"IP / ECN",               color:"#0f766e", fields:{ src_ip:"192.168.1.10", dst_ip:"—", dscp:"0x28", ecn_state:"Not-ECT" } },
      { layer:2, name:"Ethernet / PFC 802.1Qbb",color:"#15803d", fields:{ link_state:"down", pfc_enabled:false, pfc_xoff:false, tx_queue:0 } },
      { layer:1, name:"Physical / RS-FEC",      color:"#b45309", fields:{ phy_state:"down", an_state:"idle", lt_state:"idle", speed:"unknown" } },
    ],
    target: [
      { layer:7, name:"Application / Verbs",   color:"#7c3aed", fields:{ app_state:"listening", mr_registered:false, mr_vaddr:"—", cpu_involvement:"none" } },
      { layer:6, name:"CM / rdma-cm",           color:"#6d28d9", fields:{ cm_state:"listening", cm_id:"null" } },
      { layer:5, name:"IB Transport (RC QP)",   color:"#1d4ed8", fields:{ qp_state:"RESET", qp_num:"—", psn_recv:0, rkey:"—", remote_qpn:"—" } },
      { layer:4, name:"UDP (RoCEv2 / port 4791)",color:"#0369a1",fields:{ dst_port:4791 } },
      { layer:3, name:"IP / ECN",               color:"#0f766e", fields:{ src_ip:"192.168.1.20", ecn_state:"Not-ECT" } },
      { layer:2, name:"Ethernet / PFC 802.1Qbb",color:"#15803d", fields:{ link_state:"down", pfc_enabled:false, pfc_xoff:false } },
      { layer:1, name:"Physical / RS-FEC",      color:"#b45309", fields:{ phy_state:"down", an_state:"idle", lt_state:"idle", speed:"unknown" } },
    ],
    switch: [
      { layer:2, name:"Switching / PFC / ECN",  color:"#15803d", fields:{ fwd_entries:0, pfc_p3_xoff:false, egress_q_p3:0 } },
      { layer:1, name:"Physical (2× 100GbE)",   color:"#b45309", fields:{ port_a:"down", port_b:"down" } },
    ],
  },
  timeline: [
    {
      id:"phy", t:0, phase:"Link",
      label:"PHY: Signal detected, AN starts",
      detail:"Optical transceiver detects light. Auto-Negotiation (IEEE 802.3cd cl.73) begins ability exchange. Both ends will agree on 100GbE + RS(544,514) FEC.",
      type:"state_change", color:"#b45309",
      state: {
        initiator:{ 1:{ phy_state:"AN_IN_PROGRESS", an_state:"ABILITY_DETECT", signal_detect:true } },
        target:{    1:{ phy_state:"AN_IN_PROGRESS", an_state:"ABILITY_DETECT", signal_detect:true } },
        switch:{    1:{ port_a:"AN_IN_PROGRESS", port_b:"AN_IN_PROGRESS" } },
      }
    },
    {
      id:"an_done", t:1, phase:"Link",
      label:"AN complete: 100GbE + RS-FEC agreed",
      detail:"Auto-Negotiation resolves to 100GBASE-SR4. RS(544,514) FEC is mandatory at 100G. Link Training begins to equalize the channel (pre/post-cursor emphasis coefficients exchanged via clause 72 backplane protocol).",
      type:"state_change", color:"#b45309",
      state: {
        initiator:{ 1:{ an_state:"COMPLETE", lt_state:"IN_PROGRESS", fec:"RS(544,514)", speed:"100Gbps" } },
        target:{    1:{ an_state:"COMPLETE", lt_state:"IN_PROGRESS", speed:"100Gbps" } },
      }
    },
    {
      id:"link_up", t:2, phase:"Link",
      label:"Link UP @ 100Gbps — PFC enabled (priority 3)",
      detail:"Link Training complete. PFC negotiated via DCBX (not shown). Priority 3 is lossless for RoCEv2 traffic. Switch has PFC enabled on both ports. Ethernet frames can now flow.",
      type:"state_change", color:"#15803d",
      state: {
        initiator:{ 1:{ phy_state:"UP", lt_state:"COMPLETE" }, 2:{ link_state:"up", pfc_enabled:true, pfc_priority:3 } },
        target:{    1:{ phy_state:"UP", lt_state:"COMPLETE" }, 2:{ link_state:"up", pfc_enabled:true } },
        switch:{    1:{ port_a:"up", port_b:"up" }, 2:{ fwd_entries:0 } },
      }
    },
    {
      id:"arp_req", t:3, phase:"ARP",
      label:"ARP Request → broadcast",
      detail:"RoCEv2 uses standard IP addressing. Initiator broadcasts ARP to resolve 192.168.1.20 → MAC. Required before IP routing can function.",
      type:"frame_tx", color:"#f0c040",
      from:"initiator", to:"target", via:["switch"],
      frame: {
        name:"ARP Request",
        bytes:42,
        headers:[
          { name:"Ethernet II", layer:2, fields:[
            { name:"Dst MAC", abbrev:"eth.dst", bits:48, value:"ff:ff:ff:ff:ff:ff", desc:"Broadcast MAC — ARP goes to all hosts", spec:[{doc:"IEEE 802.3",sec:"3.2.3",url:"https://standards.ieee.org/ieee/802.3/7661/"}] },
            { name:"Src MAC", abbrev:"eth.src", bits:48, value:"00:02:c9:12:34:56", desc:"Initiator NIC MAC address" },
            { name:"EtherType", abbrev:"eth.type", bits:16, value:"0x0806", desc:"0x0806 = ARP", spec:[{doc:"RFC 826",sec:"1",url:"https://datatracker.ietf.org/doc/html/rfc826"}] },
          ]},
          { name:"ARP", layer:3, fields:[
            { name:"Opcode", abbrev:"arp.opcode", bits:16, value:"1 (Request)", desc:"1=Request, 2=Reply" },
            { name:"Sender IP", abbrev:"arp.src.proto_ipv4", bits:32, value:"192.168.1.10", desc:"Initiator IP" },
            { name:"Target IP", abbrev:"arp.dst.proto_ipv4", bits:32, value:"192.168.1.20", desc:"IP we want to resolve" },
          ]},
        ]
      },
      state: { switch:{ 2:{ fwd_entries:1 } } }
    },
    {
      id:"arp_rep", t:4, phase:"ARP",
      label:"ARP Reply ← 00:02:c9:ab:cd:ef",
      detail:"Target responds unicast with its MAC. Initiator's ARP table now has the entry. IP routing is ready.",
      type:"frame_tx", color:"#f0c040",
      from:"target", to:"initiator", via:["switch"],
      frame: {
        name:"ARP Reply",
        bytes:42,
        headers:[
          { name:"Ethernet II", layer:2, fields:[
            { name:"Dst MAC", abbrev:"eth.dst", bits:48, value:"00:02:c9:12:34:56", desc:"Unicast reply to initiator" },
            { name:"Src MAC", abbrev:"eth.src", bits:48, value:"00:02:c9:ab:cd:ef", desc:"Target MAC — this is the answer" },
            { name:"EtherType", abbrev:"eth.type", bits:16, value:"0x0806", desc:"ARP" },
          ]},
          { name:"ARP", layer:3, fields:[
            { name:"Opcode", abbrev:"arp.opcode", bits:16, value:"2 (Reply)", desc:"2=Reply" },
            { name:"Sender MAC", abbrev:"arp.src.hw_mac", bits:48, value:"00:02:c9:ab:cd:ef", desc:"Answer: this is the MAC for 192.168.1.20" },
            { name:"Sender IP", abbrev:"arp.src.proto_ipv4", bits:32, value:"192.168.1.20", desc:"Target IP" },
          ]},
        ]
      },
      state: { initiator:{ 3:{ dst_ip:"192.168.1.20" } }, switch:{ 2:{ fwd_entries:2 } } }
    },
    {
      id:"mr_qp", t:5, phase:"Setup",
      label:"ibv_reg_mr() + ibv_create_qp() — QP: RESET",
      detail:"Both sides register Memory Regions (ibv_reg_mr → MLX5_CMD_OP_CREATE_MKEY — pins pages, builds RNIC MTT). QPs created via MLX5_CMD_OP_CREATE_QP — start in RESET state. lkey/rkey returned.",
      type:"state_change", color:"#7c3aed",
      state: {
        initiator:{ 7:{ mr_registered:true, app_state:"mr_registered" }, 5:{ qp_state:"RESET", qp_num:"0x00A001", lkey:"0xABC01234" } },
        target:{    7:{ mr_registered:true, mr_vaddr:"0x7f000000", app_state:"listening_mr_ready" }, 5:{ qp_state:"RESET", qp_num:"0x00B002", lkey:"0xDEF05678", rkey:"0xDEAD1234" } },
      }
    },
    {
      id:"qp_init", t:6, phase:"Setup",
      label:"ibv_modify_qp() → RESET→INIT",
      detail:"modify_qp(RESET→INIT) sets P_Key index, port number, access flags. QP can now receive WQEs. Linux: MLX5_CMD_OP_RST2INIT_QP. Required attrs: IB_QP_PKEY_INDEX | IB_QP_PORT | IB_QP_ACCESS_FLAGS.",
      type:"state_change", color:"#1d4ed8",
      state: {
        initiator:{ 5:{ qp_state:"INIT" } },
        target:{    5:{ qp_state:"INIT" } },
      }
    },
    {
      id:"cm_req", t:7, phase:"CM",
      label:"CM REQ → QP params + starting PSN",
      detail:"ib_send_cm_req(): sends initiator QPN (0x00A001), starting PSN (1234567, randomized), path MTU=4096, retry=7, RNR retry=7, private data (app can embed rkey here). Target QP still INIT.",
      type:"frame_tx", color:"#5b8dd9",
      from:"initiator", to:"target", via:["switch"],
      frame: {
        name:"CM REQ (Connection Request)",
        bytes:108,
        headers:[
          { name:"Ethernet II", layer:2, fields:[
            { name:"Dst MAC", abbrev:"eth.dst", bits:48, value:"00:02:c9:ab:cd:ef", desc:"Target MAC" },
            { name:"Src MAC", abbrev:"eth.src", bits:48, value:"00:02:c9:12:34:56", desc:"Initiator MAC" },
            { name:"EtherType", abbrev:"eth.type", bits:16, value:"0x0800", desc:"IPv4" },
          ]},
          { name:"IPv4", layer:3, fields:[
            { name:"Src IP", abbrev:"ip.src", bits:32, value:"192.168.1.10", desc:"Initiator" },
            { name:"Dst IP", abbrev:"ip.dst", bits:32, value:"192.168.1.20", desc:"Target" },
            { name:"Protocol", abbrev:"ip.proto", bits:8, value:"17 (UDP)", desc:"RoCEv2 always uses UDP encapsulation", spec:[{doc:"RFC 7871",sec:"3",url:"https://datatracker.ietf.org/doc/html/rfc7871"}] },
            { name:"DSCP/ECN", abbrev:"ip.dscp", bits:8, value:"0x28 (DSCP10+ECT(0))", desc:"DSCP AF11 for RoCEv2 QoS. Low 2 bits = ECT(0) — sender declares ECN capability.", spec:[{doc:"RFC 3168",sec:"5",url:"https://datatracker.ietf.org/doc/html/rfc3168#section-5"}] },
          ]},
          { name:"UDP", layer:4, fields:[
            { name:"Src Port", abbrev:"udp.srcport", bits:16, value:"49152", desc:"Ephemeral. Used by switches for ECMP flow hashing.", spec:[{doc:"RFC 7871",sec:"8",url:"https://datatracker.ietf.org/doc/html/rfc7871#section-8"}] },
            { name:"Dst Port", abbrev:"udp.dstport", bits:16, value:"4791", desc:"IANA well-known port for ALL RoCEv2 traffic.", spec:[{doc:"RFC 7871",sec:"7",url:"https://datatracker.ietf.org/doc/html/rfc7871#section-7"}] },
            { name:"Checksum", abbrev:"udp.checksum", bits:16, value:"0x0000", desc:"Always 0 for RoCEv2. ICRC in IB layer covers integrity.", spec:[{doc:"RFC 7871",sec:"6",url:"https://datatracker.ietf.org/doc/html/rfc7871#section-6"}] },
          ]},
          { name:"IB BTH", layer:5, fields:[
            { name:"Opcode", abbrev:"infiniband.bth.opcode", bits:8, value:"0x64 (CM Request)", desc:"Encodes service type (UD for CM MADs) + packet type", spec:[{doc:"IBTA Vol1",sec:"5.3.1",url:"https://www.infinibandta.org/ibta-specification/"}] },
            { name:"Dst QP", abbrev:"infiniband.bth.destqp", bits:24, value:"0x000001 (QP1)", desc:"QP1 = GSI — General Services Interface. ALL CM MADs go to QP1.", spec:[{doc:"IBTA Vol1",sec:"3.5.3",url:"https://www.infinibandta.org/ibta-specification/"}] },
            { name:"P_Key", abbrev:"infiniband.bth.pkey", bits:16, value:"0xFFFF (Full)", desc:"Full membership partition key. Defines virtual fabric partition.", spec:[{doc:"IBTA Vol1",sec:"10.9",url:"https://www.infinibandta.org/ibta-specification/"}] },
            { name:"FECN", abbrev:"infiniband.bth.fecn", bits:1, value:"0", desc:"Forward ECN — set by switch if congested. Triggers DCQCN rate reduction.", spec:[{doc:"IBTA Vol1",sec:"3.5.4",url:"https://www.infinibandta.org/ibta-specification/"}] },
            { name:"BECN", abbrev:"infiniband.bth.becn", bits:1, value:"0", desc:"Backward ECN — set by receiver in CNP to tell sender to reduce rate." },
            { name:"PSN", abbrev:"infiniband.bth.psn", bits:24, value:"0", desc:"24-bit packet sequence number. RC uses PSN for ordering and retransmit.", spec:[{doc:"IBTA Vol1",sec:"9.4",url:"https://www.infinibandta.org/ibta-specification/"}] },
          ]},
          { name:"IB MAD (CM REQ Payload)", layer:6, fields:[
            { name:"Local Comm ID", abbrev:"infiniband.mad.cm.local_comm_id", bits:32, value:"0xA1B2C3D4", desc:"Unique ID assigned by initiator. Both sides use this to correlate REQ/REP/RTU.", spec:[{doc:"IBTA Vol1",sec:"12.6.5",url:"https://www.infinibandta.org/ibta-specification/"}], kernel:{file:"drivers/infiniband/core/cm.c",fn:"ib_send_cm_req",note:"Generated via get_random_u32()"} },
            { name:"Local QPN", abbrev:"infiniband.mad.cm.local_qpn", bits:24, value:"0x00A001", desc:"Initiator data QP number. Target will use this as DestQP in all data packets.", kernel:{file:"drivers/infiniband/hw/mlx5/qp.c",fn:"mlx5_ib_create_qp",note:"Assigned by MLX5_CMD_OP_CREATE_QP"} },
            { name:"Starting PSN", abbrev:"infiniband.mad.cm.starting_psn", bits:24, value:"1234567", desc:"Initiator's proposed starting PSN. Randomized to reduce PSN collision on path reset.", kernel:{file:"drivers/infiniband/core/cm.c",fn:"cm_send_req",note:"get_random_u32() & 0xffffff"} },
            { name:"Path MTU", abbrev:"infiniband.mad.cm.path_mtu", bits:4, value:"5 (= 4096 bytes)", desc:"Encoding: 1=256B 2=512B 3=1024B 4=2048B 5=4096B. Determines max single-packet payload.", spec:[{doc:"IBTA Vol1",sec:"12.6.5",url:"https://www.infinibandta.org/ibta-specification/"}] },
            { name:"Retry Count", abbrev:"infiniband.mad.cm.retry_count", bits:3, value:"7 (infinite)", desc:"Max retransmissions. 7 = retry indefinitely.", kernel:{file:"drivers/infiniband/core/cm.c",fn:"ib_send_cm_req",note:"via struct ib_cm_req_param.retry_count"} },
            { name:"RNR Retry Count", abbrev:"infiniband.mad.cm.rnr_retry", bits:3, value:"7 (infinite)", desc:"Retries on RNR NAK (Receiver Not Ready). 7 = infinite.", spec:[{doc:"IBTA Vol1",sec:"9.7.5.2",url:"https://www.infinibandta.org/ibta-specification/"}] },
            { name:"Private Data", abbrev:"infiniband.mad.cm.private_data", bits:1792, value:"<app-specific: e.g. rkey + vaddr>", desc:"Up to 224 bytes of application data. Used by NVMe-oF, iSER, SDP to pass connection params." },
          ]},
        ]
      },
      state: {
        initiator:{ 6:{ cm_state:"REQ_SENT" }, 5:{ psn_send:1234567, pmtu:"4096" } },
      }
    },
    {
      id:"cm_rep", t:8, phase:"CM",
      label:"CM REP ← target QPN + PSN. QPs → RTR",
      detail:"ib_send_cm_rep(): target provides its QPN (0x00B002), starting PSN (7654321), ACK delay, and private data (rkey=0xDEAD1234 + vaddr). Both QPs transition INIT→RTR. Linux: MLX5_CMD_OP_INIT2RTR_QP sets: dest QPN, RQ PSN, path MTU, address vector.",
      type:"frame_tx", color:"#5b8dd9",
      from:"target", to:"initiator", via:["switch"],
      frame: {
        name:"CM REP (Connection Reply)",
        bytes:108,
        headers:[
          { name:"Ethernet II", layer:2, fields:[
            { name:"Dst MAC", abbrev:"eth.dst", bits:48, value:"00:02:c9:12:34:56", desc:"Initiator" },
            { name:"Src MAC", abbrev:"eth.src", bits:48, value:"00:02:c9:ab:cd:ef", desc:"Target" },
          ]},
          { name:"IPv4", layer:3, fields:[
            { name:"Src IP", abbrev:"ip.src", bits:32, value:"192.168.1.20", desc:"Target" },
            { name:"Dst IP", abbrev:"ip.dst", bits:32, value:"192.168.1.10", desc:"Initiator" },
          ]},
          { name:"UDP", layer:4, fields:[
            { name:"Dst Port", abbrev:"udp.dstport", bits:16, value:"4791", desc:"RoCEv2 well-known port" },
            { name:"Checksum", abbrev:"udp.checksum", bits:16, value:"0x0000", desc:"Always 0 for RoCEv2" },
          ]},
          { name:"IB BTH", layer:5, fields:[
            { name:"Opcode", abbrev:"infiniband.bth.opcode", bits:8, value:"0x65 (CM Reply)", desc:"CM Reply opcode" },
            { name:"Dst QP", abbrev:"infiniband.bth.destqp", bits:24, value:"0x000001 (QP1)", desc:"Always QP1 for CM MADs" },
          ]},
          { name:"IB MAD (CM REP Payload)", layer:6, fields:[
            { name:"Remote Comm ID", abbrev:"infiniband.mad.cm.remote_comm_id", bits:32, value:"0xA1B2C3D4", desc:"Echo initiator's Comm ID — ties this reply to the REQ" },
            { name:"Local QPN", abbrev:"infiniband.mad.cm.local_qpn", bits:24, value:"0x00B002", desc:"Target data QP number. Initiator will use this as DestQP in all sends.", kernel:{file:"drivers/infiniband/hw/mlx5/qp.c",fn:"mlx5_ib_create_qp",note:"From MLX5_CMD_OP_CREATE_QP response"} },
            { name:"Starting PSN", abbrev:"infiniband.mad.cm.starting_psn", bits:24, value:"7654321", desc:"Target's starting PSN for its responses (READ responses will use this)." },
            { name:"Target ACK Delay", abbrev:"infiniband.mad.cm.target_ack_delay", bits:5, value:"14", desc:"Local ACK timeout = 4.096µs × 2^14 = ~67ms. Initiator uses this to set QP timeout.", spec:[{doc:"IBTA Vol1",sec:"12.6.10",url:"https://www.infinibandta.org/ibta-specification/"}] },
            { name:"Private Data (rkey+vaddr)", abbrev:"infiniband.mad.cm.private_data", bits:1792, value:"rkey=0xDEAD1234, vaddr=0x7f000000, len=4096", desc:"Application-layer key exchange. Target passes its rkey and MR virtual address. NOT CM-defined — app convention." },
          ]},
        ]
      },
      state: {
        initiator:{ 6:{ cm_state:"REP_RECEIVED" }, 5:{ qp_state:"RTR", remote_qpn:"0x00B002", psn_recv:7654321, rkey:"0xDEAD1234", pmtu:"4096" } },
        target:{    6:{ cm_state:"REP_SENT" }, 5:{ qp_state:"RTR", remote_qpn:"0x00A001", psn_recv:1234567, pmtu:"4096" } },
      }
    },
    {
      id:"cm_rtu", t:9, phase:"CM",
      label:"CM RTU → connection ESTABLISHED. QPs → RTS",
      detail:"ib_send_cm_rtu(): last CM handshake. After sending RTU, initiator transitions QP RTR→RTS via MLX5_CMD_OP_RTR2RTS_QP. On receiving RTU, target transitions RTR→RTS. QP is now fully operational.",
      type:"frame_tx", color:"#5b8dd9",
      from:"initiator", to:"target", via:["switch"],
      frame: {
        name:"CM RTU (Ready To Use)",
        bytes:76,
        headers:[
          { name:"Ethernet II", layer:2, fields:[
            { name:"Dst MAC", abbrev:"eth.dst", bits:48, value:"00:02:c9:ab:cd:ef", desc:"Target" },
            { name:"Src MAC", abbrev:"eth.src", bits:48, value:"00:02:c9:12:34:56", desc:"Initiator" },
          ]},
          { name:"IB BTH", layer:5, fields:[
            { name:"Opcode", abbrev:"infiniband.bth.opcode", bits:8, value:"0x66 (CM RTU)", desc:"0x66 = CM Ready To Use. Final CM handshake message. No reply expected.", spec:[{doc:"IBTA Vol1",sec:"12.6.5",url:"https://www.infinibandta.org/ibta-specification/"}] },
            { name:"Dst QP", abbrev:"infiniband.bth.destqp", bits:24, value:"0x000001 (QP1)", desc:"QP1 — last CM message" },
          ]},
          { name:"IB MAD (CM RTU)", layer:6, fields:[
            { name:"Local Comm ID", abbrev:"infiniband.mad.cm.local_comm_id", bits:32, value:"0xA1B2C3D4", desc:"Initiator comm ID" },
            { name:"Remote Comm ID", abbrev:"infiniband.mad.cm.remote_comm_id", bits:32, value:"0xDEADBEEF", desc:"Echo target's comm ID — confirms receipt of REP" },
          ]},
        ]
      },
      state: {
        initiator:{ 7:{ app_state:"connected" }, 6:{ cm_state:"ESTABLISHED" }, 5:{ qp_state:"RTS", sq_psn:1234567 } },
        target:{    7:{ app_state:"connected" }, 6:{ cm_state:"ESTABLISHED" }, 5:{ qp_state:"RTS" } },
      }
    },
    {
      id:"wr_post", t:10, phase:"RDMA Write",
      label:"ibv_post_send(IBV_WR_RDMA_WRITE) — doorbell ring",
      detail:"Application posts RDMA WRITE Work Request. ibv_post_send() builds a 64-byte WQE in the SQ ring buffer and rings the RNIC doorbell via an MMIO write (no syscall). RNIC will DMA the local buffer and transmit. Zero CPU involvement expected on target.",
      type:"state_change", color:"#e05c5c",
      state: {
        initiator:{ 7:{ posted_wr:"RDMA_WRITE wr_id=1", app_state:"write_posted" } },
      }
    },
    {
      id:"rdma_write", t:11, phase:"RDMA Write",
      label:"RDMA WRITE Only → 4KB to remote memory (zero target CPU)",
      detail:"RNIC DMAs local buffer → builds BTH(0x0A)+RETH+UDP+IP+Eth → transmits. Target RNIC: verifies ICRC, checks rkey against MTT, DMAs payload directly to physical memory. Target CPU is NOT interrupted. This is the key RDMA advantage over SEND.",
      type:"frame_tx", color:"#e05c5c",
      from:"initiator", to:"target", via:["switch"],
      frame: {
        name:"RDMA WRITE Only (4096 bytes)",
        bytes:4162,
        headers:[
          { name:"Ethernet II", layer:2, fields:[
            { name:"Dst MAC", abbrev:"eth.dst", bits:48, value:"00:02:c9:ab:cd:ef", desc:"Target" },
            { name:"Src MAC", abbrev:"eth.src", bits:48, value:"00:02:c9:12:34:56", desc:"Initiator" },
            { name:"EtherType", abbrev:"eth.type", bits:16, value:"0x0800", desc:"IPv4" },
          ]},
          { name:"IPv4", layer:3, fields:[
            { name:"Src IP", abbrev:"ip.src", bits:32, value:"192.168.1.10", desc:"Initiator" },
            { name:"Dst IP", abbrev:"ip.dst", bits:32, value:"192.168.1.20", desc:"Target" },
            { name:"DSCP/ECN", abbrev:"ip.dscp", bits:8, value:"0x28 (ECT(0))", desc:"ECN capable transport. Switch may mark CE bits if congested (DCQCN trigger).", spec:[{doc:"RFC 3168",sec:"5",url:"https://datatracker.ietf.org/doc/html/rfc3168"}] },
            { name:"Total Length", abbrev:"ip.len", bits:16, value:"4148", desc:"20(IP)+8(UDP)+12(BTH)+16(RETH)+4096(data)+4(ICRC)" },
          ]},
          { name:"UDP", layer:4, fields:[
            { name:"Src Port", abbrev:"udp.srcport", bits:16, value:"49152", desc:"Flow-hashed for ECMP load balancing across switch paths" },
            { name:"Dst Port", abbrev:"udp.dstport", bits:16, value:"4791", desc:"RoCEv2 IANA port — constant for all RoCEv2" },
            { name:"Checksum", abbrev:"udp.checksum", bits:16, value:"0x0000", desc:"Zero — ICRC protects integrity end-to-end" },
          ]},
          { name:"IB BTH (Base Transport Header)", layer:5, fields:[
            { name:"Opcode", abbrev:"infiniband.bth.opcode", bits:8, value:"0x0A (RC RDMA Write Only)", desc:"0x0A = RC RDMA Write Only. 'Only' means data fits in one packet. Multi-packet: First=0x08, Middle=0x09, Last=0x0A.", spec:[{doc:"IBTA Vol1",sec:"A19",url:"https://www.infinibandta.org/ibta-specification/"}] },
            { name:"SE (Solicited Event)", abbrev:"infiniband.bth.se", bits:1, value:"0", desc:"SE=0: no solicited event. SE=1 would wake sleeping recv completions.", spec:[{doc:"IBTA Vol1",sec:"9.3",url:"https://www.infinibandta.org/ibta-specification/"}] },
            { name:"P_Key", abbrev:"infiniband.bth.pkey", bits:16, value:"0xFFFF", desc:"Full partition membership" },
            { name:"FECN", abbrev:"infiniband.bth.fecn", bits:1, value:"0", desc:"Forward ECN. Switch sets this if experiencing congestion — triggers DCQCN at receiver.", spec:[{doc:"IBTA Vol1",sec:"3.5.4",url:"https://www.infinibandta.org/ibta-specification/"}] },
            { name:"BECN", abbrev:"infiniband.bth.becn", bits:1, value:"0", desc:"Backward ECN. Receiver sets in CNP to request sender rate reduction." },
            { name:"Dst QP", abbrev:"infiniband.bth.destqp", bits:24, value:"0x00B002", desc:"Target's DATA QP (from CM REP). First use of data QP — CM used QP1." },
            { name:"ACK Req (A)", abbrev:"infiniband.bth.ackreq", bits:1, value:"1", desc:"Request ACK. Initiator needs this to generate send completion and reclaim SQ WQE." },
            { name:"PSN", abbrev:"infiniband.bth.psn", bits:24, value:"1234567", desc:"First data PSN — matches starting PSN from CM REQ. Increments per-packet.", spec:[{doc:"IBTA Vol1",sec:"9.4",url:"https://www.infinibandta.org/ibta-specification/"}] },
          ]},
          { name:"IB RETH (RDMA Extended Transport Header)", layer:5, fields:[
            { name:"Virtual Address", abbrev:"infiniband.reth.virtual_address", bits:64, value:"0x7f0000000000", desc:"Remote virtual address where data will be written. In target's registered MR. Passed out-of-band via CM private data.", spec:[{doc:"IBTA Vol1",sec:"9.7.5.3",url:"https://www.infinibandta.org/ibta-specification/"}], kernel:{file:"drivers/infiniband/hw/mlx5/qp.c",fn:"mlx5_post_one_wr",note:"From ibv_send_wr.wr.rdma.remote_addr → WQE RADDR field"} },
            { name:"R_Key", abbrev:"infiniband.reth.r_key", bits:32, value:"0xDEAD1234", desc:"Remote Memory Region key. Proves initiator is authorized to write this memory. Registered via ibv_reg_mr(), shared out-of-band.", spec:[{doc:"IBTA Vol1",sec:"10.6.3",url:"https://www.infinibandta.org/ibta-specification/"}], kernel:{file:"drivers/infiniband/hw/mlx5/mr.c",fn:"mlx5_ib_reg_user_mr",note:"rkey from MLX5_CMD_OP_CREATE_MKEY response"} },
            { name:"DMA Length", abbrev:"infiniband.reth.dma_length", bits:32, value:"4096", desc:"Total bytes to write. For multi-packet WRITE, only present in First packet." },
          ]},
          { name:"Payload (4096 bytes)", layer:7, fields:[
            { name:"Data", abbrev:"data.data", bits:32768, value:"<4096 bytes application data>", desc:"Payload written directly to target physical memory by RNIC DMA. Target CPU never executes a read() or memcpy()." },
          ]},
          { name:"IB ICRC (Invariant CRC)", layer:5, fields:[
            { name:"ICRC", abbrev:"infiniband.icrc", bits:32, value:"0x<computed>", desc:"CRC-32 over BTH + headers + payload. Mutable fields (TTL, FECN/BECN) zeroed before computation so routers don't invalidate it. Checked by receiving RNIC hardware.", spec:[{doc:"IBTA Vol1",sec:"9.4.1",url:"https://www.infinibandta.org/ibta-specification/"}] },
          ]},
        ]
      },
      state: {
        initiator:{ 5:{ psn_send:1234567 }, 2:{ tx_queue:4162 } },
        target:{    7:{ cpu_involvement:"NONE — RNIC DMA wrote to MR" }, 5:{ psn_recv:1234568 } },
        switch:{    2:{ egress_q_p3:4162 } },
      }
    },
    {
      id:"write_ack", t:12, phase:"RDMA Write",
      label:"RC ACK ← target RNIC (autonomous, no CPU). CQE posted.",
      detail:"Target RNIC hardware generates RC ACK autonomously. Zero CPU involvement on target. Initiator RNIC posts a CQE to the Completion Queue. Application learns of completion via ibv_poll_cq().",
      type:"frame_tx", color:"#5bd9a0",
      from:"target", to:"initiator", via:["switch"],
      frame: {
        name:"RC Acknowledge (for RDMA WRITE)",
        bytes:58,
        headers:[
          { name:"Ethernet II", layer:2, fields:[
            { name:"Dst MAC", abbrev:"eth.dst", bits:48, value:"00:02:c9:12:34:56", desc:"Initiator" },
            { name:"Src MAC", abbrev:"eth.src", bits:48, value:"00:02:c9:ab:cd:ef", desc:"Target RNIC — generated autonomously, no CPU" },
          ]},
          { name:"IPv4", layer:3, fields:[
            { name:"Src IP", abbrev:"ip.src", bits:32, value:"192.168.1.20", desc:"Target" },
            { name:"Dst IP", abbrev:"ip.dst", bits:32, value:"192.168.1.10", desc:"Initiator" },
          ]},
          { name:"IB BTH", layer:5, fields:[
            { name:"Opcode", abbrev:"infiniband.bth.opcode", bits:8, value:"0x11 (RC Acknowledge)", desc:"Pure ACK — no payload. Generated by RNIC firmware, not OS.", spec:[{doc:"IBTA Vol1",sec:"A19",url:"https://www.infinibandta.org/ibta-specification/"}] },
            { name:"Dst QP", abbrev:"infiniband.bth.destqp", bits:24, value:"0x00A001", desc:"Back to initiator's data QP" },
            { name:"PSN", abbrev:"infiniband.bth.psn", bits:24, value:"1234567", desc:"PSN being acknowledged" },
          ]},
          { name:"IB AETH (ACK Extended Transport Header)", layer:5, fields:[
            { name:"Syndrome", abbrev:"infiniband.aeth.syndrome", bits:8, value:"0x00 (ACK)", desc:"0x00 = ACK. 0x20-0x3F = RNR NAK (with timer). 0x60-0x9F = NAK codes (sequence, invalid request, etc).", spec:[{doc:"IBTA Vol1",sec:"9.7.7",url:"https://www.infinibandta.org/ibta-specification/"}] },
            { name:"MSN", abbrev:"infiniband.aeth.msn", bits:24, value:"1", desc:"Message Sequence Number — cumulative count of completed messages. Initiator uses to release SQ WQEs." },
          ]},
        ]
      },
      state: {
        initiator:{ 7:{ cq_entries:1, app_state:"write_complete" }, 5:{ psn_send:1234568 }, 2:{ tx_queue:0 } },
        switch:{    2:{ egress_q_p3:0 } },
      }
    },
    {
      id:"read_post", t:13, phase:"RDMA Read",
      label:"ibv_post_send(IBV_WR_RDMA_READ) — read request posted",
      detail:"Application posts RDMA READ WR with same rkey + vaddr + lkey for local destination buffer. RDMA READ requires a round trip: initiator sends READ REQUEST, target RNIC autonomously reads memory and sends READ RESPONSE.",
      type:"state_change", color:"#b05bd9",
      state: {
        initiator:{ 7:{ posted_wr:"RDMA_READ wr_id=2", app_state:"read_posted" } },
      }
    },
    {
      id:"rdma_read_req", t:14, phase:"RDMA Read",
      label:"RDMA READ Request → (no data, just RETH)",
      detail:"BTH(0x0C) + RETH only — no payload in READ REQUEST direction. RETH specifies what to read (rkey + vaddr + length). Target RNIC will DMA its own memory and send back READ RESPONSE packets.",
      type:"frame_tx", color:"#b05bd9",
      from:"initiator", to:"target", via:["switch"],
      frame: {
        name:"RDMA READ Request",
        bytes:74,
        headers:[
          { name:"Ethernet II", layer:2, fields:[
            { name:"Dst MAC", abbrev:"eth.dst", bits:48, value:"00:02:c9:ab:cd:ef", desc:"Target" },
          ]},
          { name:"IPv4", layer:3, fields:[
            { name:"Src IP", abbrev:"ip.src", bits:32, value:"192.168.1.10", desc:"Initiator" },
            { name:"Dst IP", abbrev:"ip.dst", bits:32, value:"192.168.1.20", desc:"Target" },
          ]},
          { name:"IB BTH", layer:5, fields:[
            { name:"Opcode", abbrev:"infiniband.bth.opcode", bits:8, value:"0x0C (RC RDMA Read Request)", desc:"0x0C = RC RDMA Read Request. Request only — no data. Target will respond with 0x0D/0x0E/0x0F/0x10.", spec:[{doc:"IBTA Vol1",sec:"A19",url:"https://www.infinibandta.org/ibta-specification/"}] },
            { name:"Dst QP", abbrev:"infiniband.bth.destqp", bits:24, value:"0x00B002", desc:"Target data QP" },
            { name:"PSN", abbrev:"infiniband.bth.psn", bits:24, value:"1234568", desc:"PSN after the WRITE (1234567+1)" },
          ]},
          { name:"IB RETH", layer:5, fields:[
            { name:"Virtual Address", abbrev:"infiniband.reth.virtual_address", bits:64, value:"0x7f0000000000", desc:"Read from same address we wrote — verifying the WRITE worked" },
            { name:"R_Key", abbrev:"infiniband.reth.r_key", bits:32, value:"0xDEAD1234", desc:"Same rkey authorizes read access" },
            { name:"DMA Length", abbrev:"infiniband.reth.dma_length", bits:32, value:"4096", desc:"Read back 4096 bytes" },
          ]},
        ]
      },
      state: {
        initiator:{ 5:{ psn_send:1234568 } },
      }
    },
    {
      id:"rdma_read_resp", t:15, phase:"RDMA Read",
      label:"RDMA READ Response ← target RNIC DMA (zero CPU). CQE posted.",
      detail:"Target RNIC: receives READ request → validates rkey → DMA reads physical memory → builds BTH(0x10)+AETH+data → transmits. Initiator RNIC: receives response → DMA writes to initiator's local buffer → posts READ CQE. Zero CPU on target. The returned data == what was written.",
      type:"frame_tx", color:"#b05bd9",
      from:"target", to:"initiator", via:["switch"],
      frame: {
        name:"RDMA READ Response Only (4096 bytes)",
        bytes:4162,
        headers:[
          { name:"Ethernet II", layer:2, fields:[
            { name:"Dst MAC", abbrev:"eth.dst", bits:48, value:"00:02:c9:12:34:56", desc:"Initiator" },
            { name:"Src MAC", abbrev:"eth.src", bits:48, value:"00:02:c9:ab:cd:ef", desc:"Target RNIC — no CPU involved" },
          ]},
          { name:"IPv4", layer:3, fields:[
            { name:"Src IP", abbrev:"ip.src", bits:32, value:"192.168.1.20", desc:"Target" },
            { name:"Dst IP", abbrev:"ip.dst", bits:32, value:"192.168.1.10", desc:"Initiator" },
          ]},
          { name:"IB BTH", layer:5, fields:[
            { name:"Opcode", abbrev:"infiniband.bth.opcode", bits:8, value:"0x10 (RC RDMA Read Response Only)", desc:"0x10 = fits in one packet. Multi-packet: First=0x0D, Middle=0x0E, Last=0x0F, Only=0x10.", spec:[{doc:"IBTA Vol1",sec:"A19",url:"https://www.infinibandta.org/ibta-specification/"}] },
            { name:"Dst QP", abbrev:"infiniband.bth.destqp", bits:24, value:"0x00A001", desc:"Initiator data QP" },
            { name:"PSN", abbrev:"infiniband.bth.psn", bits:24, value:"7654321", desc:"Target's PSN — starts from target starting PSN in CM REP" },
          ]},
          { name:"IB AETH", layer:5, fields:[
            { name:"Syndrome", abbrev:"infiniband.aeth.syndrome", bits:8, value:"0x00 (ACK)", desc:"Read completed successfully. Initiator generates READ completion on CQ." },
            { name:"MSN", abbrev:"infiniband.aeth.msn", bits:24, value:"1", desc:"First message from target's perspective" },
          ]},
          { name:"Payload (4096 bytes)", layer:7, fields:[
            { name:"Data", abbrev:"data.data", bits:32768, value:"<same 4096 bytes written by RDMA WRITE>", desc:"Data DMA'd from target memory by target RNIC. No CPU read() call executed on target. Data integrity protected by ICRC." },
          ]},
          { name:"IB ICRC", layer:5, fields:[
            { name:"ICRC", abbrev:"infiniband.icrc", bits:32, value:"0x<computed>", desc:"Verified by initiator RNIC hardware. If corrupt, silently dropped and RC transport triggers retransmit." },
          ]},
        ]
      },
      state: {
        initiator:{ 7:{ cq_entries:1, app_state:"read_complete" }, 5:{ psn_recv:7654322 } },
        target:{    7:{ cpu_involvement:"NONE — RNIC DMA read memory and responded" }, 5:{ psn_send:7654322 } },
      }
    },
  ],
};

// ─── OSI layer colors ──────────────────────────────────────────────────────
const L_COLOR = { 7:"#7c3aed",6:"#6d28d9",5:"#1d4ed8",4:"#0369a1",3:"#0f766e",2:"#15803d",1:"#92400e" };

// ─── Phase colors ──────────────────────────────────────────────────────────
const PHASE_COLORS = {
  "Link":"#92400e","ARP":"#b45309","Setup":"#0369a1","CM":"#1e40af","RDMA Write":"#991b1b","RDMA Read":"#6b21a8"
};

// ─── Merge state deltas into current host state ────────────────────────────
function applyStateDelta(current, delta) {
  if (!delta) return current;
  const next = current.map(layer => {
    const d = delta[layer.layer];
    if (!d) return layer;
    return { ...layer, fields: { ...layer.fields, ...d } };
  });
  return next;
}

function buildStateAtStep(actorId, stepIdx) {
  let layers = [...SCENARIO.osi_layers[actorId]].map(l => ({...l, fields:{...l.fields}}));
  for (let i = 0; i <= stepIdx; i++) {
    const ev = SCENARIO.timeline[i];
    if (ev.state && ev.state[actorId]) {
      layers = applyStateDelta(layers, ev.state[actorId]);
    }
  }
  return layers;
}

// ─── Packet Field ──────────────────────────────────────────────────────────
function PacketField({ field, depth=0 }) {
  const [expanded, setExpanded] = useState(false);
  const [showSpec, setShowSpec] = useState(false);
  const hasSpec = field.spec && field.spec.length > 0;
  const hasKernel = !!field.kernel;
  return (
    <div style={{ marginLeft: depth*12, borderLeft: depth>0?"2px solid #334155":"none", paddingLeft: depth>0?8:0 }}>
      <div
        onClick={() => setExpanded(e=>!e)}
        style={{
          display:"flex", alignItems:"flex-start", gap:8, padding:"5px 8px", cursor:"pointer",
          background: expanded ? "#1e293b" : "transparent",
          borderRadius:4, userSelect:"none",
          transition:"background 0.15s",
        }}
        onMouseEnter={e=>e.currentTarget.style.background="#1e293b"}
        onMouseLeave={e=>e.currentTarget.style.background=expanded?"#1e293b":"transparent"}
      >
        <span style={{color:"#64748b",fontFamily:"'JetBrains Mono',monospace",fontSize:10,minWidth:22,marginTop:1}}>{field.bits}b</span>
        <span style={{color:"#94a3b8",fontFamily:"'JetBrains Mono',monospace",fontSize:10,minWidth:160,marginTop:1}}>{field.abbrev}</span>
        <span style={{color:"#e2e8f0",fontSize:12,flex:1}}>{field.name}</span>
        <span style={{color:"#f59e0b",fontFamily:"'JetBrains Mono',monospace",fontSize:11,minWidth:120,textAlign:"right",marginTop:1}}>{String(field.value)}</span>
      </div>
      {expanded && (
        <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:6, margin:"2px 0 4px 22px", padding:10 }}>
          <p style={{color:"#cbd5e1",fontSize:12,margin:"0 0 8px",lineHeight:1.5}}>{field.desc}</p>
          {hasSpec && (
            <div>
              <button onClick={()=>setShowSpec(s=>!s)} style={{background:"none",border:"1px solid #334155",color:"#60a5fa",fontSize:10,borderRadius:4,padding:"2px 8px",cursor:"pointer",marginBottom:4}}>
                {showSpec?"▼":"▶"} Spec References ({field.spec.length})
              </button>
              {showSpec && field.spec.map((s,i)=>(
                <div key={i} style={{display:"flex",gap:8,alignItems:"center",padding:"3px 0"}}>
                  <span style={{background:"#1e3a5f",color:"#93c5fd",fontSize:10,padding:"1px 6px",borderRadius:3,fontFamily:"monospace"}}>{s.doc}</span>
                  <span style={{color:"#64748b",fontSize:10}}>§{s.sec}</span>
                  {s.url && <a href={s.url} target="_blank" rel="noreferrer" style={{color:"#34d399",fontSize:10,textDecoration:"none"}}>↗ Spec</a>}
                </div>
              ))}
            </div>
          )}
          {hasKernel && (
            <div style={{marginTop:6,padding:"6px 8px",background:"#0a0f1a",borderRadius:4,borderLeft:"3px solid #f59e0b"}}>
              <div style={{color:"#f59e0b",fontSize:10,fontWeight:700,marginBottom:2}}>🐧 Linux Kernel</div>
              <div style={{color:"#94a3b8",fontSize:10,fontFamily:"monospace"}}>{field.kernel.file}</div>
              <div style={{color:"#fbbf24",fontSize:10,fontFamily:"monospace"}}>{field.kernel.fn}()</div>
              {field.kernel.note && <div style={{color:"#64748b",fontSize:10,marginTop:2}}>{field.kernel.note}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Header block in packet inspector ─────────────────────────────────────
function HeaderBlock({ hdr }) {
  const [open, setOpen] = useState(true);
  const layerColor = L_COLOR[hdr.layer] || "#475569";
  return (
    <div style={{ marginBottom:6, border:`1px solid ${layerColor}44`, borderRadius:6, overflow:"hidden" }}>
      <div
        onClick={()=>setOpen(o=>!o)}
        style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:`${layerColor}22`,cursor:"pointer" }}
      >
        <span style={{background:layerColor,color:"#fff",fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:3}}>L{hdr.layer}</span>
        <span style={{color:"#e2e8f0",fontSize:12,fontWeight:600,flex:1}}>{hdr.name}</span>
        <span style={{color:"#475569",fontSize:10}}>{open?"▼":"▶"}</span>
      </div>
      {open && (
        <div style={{padding:"4px 0"}}>
          <div style={{display:"grid",gridTemplateColumns:"22px 160px 1fr 120px",padding:"2px 8px",marginBottom:2}}>
            {["Bits","Field","Name","Value"].map(h=>(
              <span key={h} style={{color:"#475569",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>{h}</span>
            ))}
          </div>
          {hdr.fields.map((f,i)=><PacketField key={i} field={f}/>)}
        </div>
      )}
    </div>
  );
}

// ─── OSI stack panel ───────────────────────────────────────────────────────
function OsiStack({ actorId, label, layers, activeStep, stepEvent }) {
  const activeLayers = new Set();
  if (stepEvent) {
    if (stepEvent.type === "frame_tx") {
      if (stepEvent.frame) {
        stepEvent.frame.headers.forEach(h => activeLayers.add(h.layer));
      }
    }
    if (stepEvent.state && stepEvent.state[actorId]) {
      Object.keys(stepEvent.state[actorId]).forEach(l => activeLayers.add(parseInt(l)));
    }
  }
  const sorted = [...layers].sort((a,b)=>b.layer-a.layer);
  return (
    <div style={{ display:"flex",flexDirection:"column",height:"100%" }}>
      <div style={{ padding:"8px 10px",background:"#0f172a",borderBottom:"1px solid #1e293b" }}>
        <div style={{color:"#f1f5f9",fontSize:12,fontWeight:700}}>{label}</div>
      </div>
      <div style={{ flex:1,overflowY:"auto",padding:6 }}>
        {sorted.map(layer => {
          const isActive = activeLayers.has(layer.layer);
          const color = L_COLOR[layer.layer] || "#475569";
          return (
            <div key={layer.layer} style={{
              marginBottom:4, borderRadius:5,
              border:`1px solid ${isActive ? color : color+"33"}`,
              background: isActive ? `${color}18` : "#0a0f1a",
              transition:"all 0.3s",
              boxShadow: isActive ? `0 0 8px ${color}44` : "none",
            }}>
              <div style={{ display:"flex",alignItems:"center",gap:6,padding:"4px 8px",borderBottom:`1px solid ${color}22` }}>
                <span style={{background:isActive?color:`${color}44`,color:"#fff",fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:3,transition:"background 0.3s"}}>L{layer.layer}</span>
                <span style={{color:isActive?"#f1f5f9":"#64748b",fontSize:10,fontWeight:600,transition:"color 0.3s"}}>{layer.name}</span>
                {isActive && <span style={{marginLeft:"auto",width:6,height:6,borderRadius:"50%",background:color,boxShadow:`0 0 4px ${color}`}}/>}
              </div>
              <div style={{ padding:"4px 8px 6px" }}>
                {Object.entries(layer.fields).map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"1px 0"}}>
                    <span style={{color:"#475569",fontSize:9,fontFamily:"monospace"}}>{k}</span>
                    <span style={{color: String(v).includes("RTS")||String(v).includes("UP")||String(v).includes("ESTABLISHED")||String(v).includes("complete") ? "#34d399" :
                                         String(v).includes("down")||String(v).includes("RESET")||String(v).includes("idle")||v===false ? "#475569" :
                                         "#fbbf24",
                                  fontSize:9,fontFamily:"monospace",fontWeight:600,maxWidth:120,textAlign:"right",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"
                    }}>{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sequence Diagram ──────────────────────────────────────────────────────
function SequenceDiagram({ timeline, currentStep, onStepSelect }) {
  const phases = [...new Set(timeline.map(e=>e.phase))];
  const phaseGroups = phases.map(p=>({phase:p,events:timeline.filter(e=>e.phase===p)}));
  return (
    <div style={{overflowY:"auto",flex:1}}>
      {phaseGroups.map(({phase,events})=>(
        <div key={phase} style={{marginBottom:8}}>
          <div style={{
            padding:"3px 10px",background:`${PHASE_COLORS[phase]}22`,
            borderLeft:`3px solid ${PHASE_COLORS[phase]}`,
            color:PHASE_COLORS[phase]||"#94a3b8",fontSize:10,fontWeight:700,letterSpacing:"0.08em",
            textTransform:"uppercase"
          }}>{phase}</div>
          {events.map(ev=>{
            const idx = timeline.indexOf(ev);
            const isCurrent = idx === currentStep;
            const isPast = idx < currentStep;
            const color = ev.color || "#475569";
            const isFrame = ev.type === "frame_tx";
            const dir = isFrame ? (ev.from === "initiator" ? "right" : "left") : null;
            return (
              <div
                key={ev.id}
                onClick={()=>onStepSelect(idx)}
                style={{
                  display:"flex",alignItems:"center",gap:0,padding:"5px 8px",cursor:"pointer",
                  background: isCurrent ? `${color}18` : isPast ? "#0a0f1a" : "transparent",
                  borderLeft: isCurrent ? `3px solid ${color}` : "3px solid transparent",
                  transition:"all 0.2s",
                }}
                onMouseEnter={e=>!isCurrent&&(e.currentTarget.style.background="#0f172a")}
                onMouseLeave={e=>!isCurrent&&(e.currentTarget.style.background=isPast?"#0a0f1a":"transparent")}
              >
                {/* Left actor column */}
                <div style={{width:70,display:"flex",justifyContent:"flex-end",paddingRight:6}}>
                  {isFrame && ev.from==="initiator" && (
                    <span style={{color:isPast?color+"99":color,fontSize:9,fontWeight:700}}>HOST A</span>
                  )}
                  {isFrame && ev.from==="target" && dir==="left" && (
                    <span style={{color:isPast?color+"99":color,fontSize:9,fontWeight:700,marginLeft:"auto"}}>◀</span>
                  )}
                </div>
                {/* Arrow / label */}
                <div style={{flex:1,textAlign:"center",position:"relative"}}>
                  {isFrame ? (
                    <div style={{position:"relative"}}>
                      <div style={{
                        height:1,background:isPast?color+"44":color,
                        margin:"8px 0",boxShadow:isCurrent?`0 0 6px ${color}`:undefined,
                        transition:"all 0.3s",
                      }}/>
                      <div style={{
                        position:"absolute",
                        [dir==="right"?"right":"left"]:0,
                        top:2,
                        fontSize:10,color:isPast?color+"88":color
                      }}>{dir==="right"?"▶":"◀"}</div>
                      <div style={{color:isPast?"#334155":isCurrent?"#f1f5f9":"#94a3b8",fontSize:10,fontWeight:isCurrent?700:400,transition:"color 0.2s"}}>
                        {ev.label}
                      </div>
                      {ev.frame && <div style={{color:"#475569",fontSize:9}}>{ev.frame.bytes} bytes</div>}
                    </div>
                  ) : (
                    <div style={{color:isPast?"#334155":isCurrent?"#f1f5f9":"#64748b",fontSize:10,fontWeight:isCurrent?700:400,padding:"4px 0",transition:"color 0.2s"}}>
                      ⟳ {ev.label}
                    </div>
                  )}
                </div>
                {/* Right actor column */}
                <div style={{width:70,paddingLeft:6}}>
                  {isFrame && ev.to==="target" && dir==="right" && (
                    <span style={{color:isPast?color+"99":color,fontSize:9,fontWeight:700}}>HOST B</span>
                  )}
                  {isFrame && ev.from==="target" && (
                    <span style={{color:isPast?color+"99":color,fontSize:9,fontWeight:700}}>HOST B</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────
export default function ProtoViz() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedField, setSelectedField] = useState(null);
  const [showPacket, setShowPacket] = useState(false);
  const intervalRef = useRef(null);
  const total = SCENARIO.timeline.length;
  const ev = SCENARIO.timeline[step];
  const initLayers = buildStateAtStep("initiator", step);
  const targLayers = buildStateAtStep("target", step);
  const swLayers = buildStateAtStep("switch", step);

  useEffect(()=>{
    if (playing) {
      intervalRef.current = setInterval(()=>{
        setStep(s=>{
          if(s>=total-1){setPlaying(false);return s;}
          return s+1;
        });
      },1800);
    }
    return ()=>clearInterval(intervalRef.current);
  },[playing,total]);

  const goTo = useCallback(idx=>{
    setStep(Math.max(0,Math.min(total-1,idx)));
    setShowPacket(false);
  },[total]);

  const phaseColor = PHASE_COLORS[ev.phase] || "#475569";

  return (
    <div style={{
      display:"flex",flexDirection:"column",height:"100vh",
      background:"#020817",color:"#e2e8f0",
      fontFamily:"'IBM Plex Sans',system-ui,sans-serif",overflow:"hidden",
    }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{
        padding:"10px 16px",borderBottom:"1px solid #1e293b",
        background:"#0a0f1a",flexShrink:0,
        display:"flex",alignItems:"center",justifyContent:"space-between",
      }}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",borderRadius:6,padding:"4px 8px"}}>
              <span style={{color:"#fff",fontSize:12,fontWeight:800,letterSpacing:"0.05em"}}>PROTO<span style={{color:"#a5f3fc"}}>VIZ</span></span>
            </div>
            <span style={{color:"#334155",fontSize:12}}>|</span>
            <span style={{color:"#94a3b8",fontSize:12,fontWeight:600}}>{SCENARIO.meta.title}</span>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{background:`${phaseColor}22`,color:phaseColor,fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:4,border:`1px solid ${phaseColor}44`}}>
            {ev.phase}
          </span>
          <span style={{color:"#475569",fontSize:10}}>Step {step+1}/{total}</span>
        </div>
      </div>

      {/* ── Main 3-column layout ────────────────────────────────── */}
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>

        {/* Host A OSI Stack */}
        <div style={{width:220,borderRight:"1px solid #1e293b",overflow:"hidden",display:"flex",flexDirection:"column",flexShrink:0}}>
          <OsiStack actorId="initiator" label="Host A — Initiator" layers={initLayers} activeStep={step} stepEvent={ev}/>
        </div>

        {/* Center: Sequence + Controls + Event Detail */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* Actor headers */}
          <div style={{display:"flex",padding:"6px 0",background:"#0a0f1a",borderBottom:"1px solid #1e293b",flexShrink:0}}>
            {[
              {label:"Host A (Initiator)",sub:"192.168.1.10 • ConnectX-6 Dx",color:"#3b82f6"},
              {label:"100GbE Switch",sub:"PFC Priority 3 • ECN/DCQCN",color:"#6b7280"},
              {label:"Host B (Target)",sub:"192.168.1.20 • ConnectX-6 Dx",color:"#8b5cf6"},
            ].map((a,i)=>(
              <div key={i} style={{flex:1,textAlign:"center"}}>
                <div style={{color:a.color,fontSize:11,fontWeight:700}}>{a.label}</div>
                <div style={{color:"#475569",fontSize:9}}>{a.sub}</div>
              </div>
            ))}
          </div>

          {/* Sequence diagram */}
          <div style={{flex:1,overflow:"hidden",background:"#020817"}}>
            <SequenceDiagram timeline={SCENARIO.timeline} currentStep={step} onStepSelect={goTo}/>
          </div>

          {/* Timeline scrubber */}
          <div style={{padding:"8px 12px",background:"#0a0f1a",borderTop:"1px solid #1e293b",flexShrink:0}}>
            <input
              type="range" min={0} max={total-1} value={step}
              onChange={e=>goTo(parseInt(e.target.value))}
              style={{width:"100%",accentColor:phaseColor,marginBottom:8}}
            />
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",gap:4}}>
                {[
                  {label:"⏮",fn:()=>goTo(0)},
                  {label:"◀",fn:()=>goTo(step-1)},
                  {label:playing?"⏸":"▶",fn:()=>setPlaying(p=>!p)},
                  {label:"▶",fn:()=>goTo(step+1)},
                  {label:"⏭",fn:()=>goTo(total-1)},
                ].map((b,i)=>(
                  <button key={i} onClick={b.fn} style={{
                    background:"#1e293b",border:"none",color:"#94a3b8",
                    width:28,height:28,borderRadius:4,cursor:"pointer",fontSize:12,
                  }}>{b.label}</button>
                ))}
              </div>
              <div style={{display:"flex",gap:6}}>
                {Object.entries(PHASE_COLORS).map(([p,c])=>(
                  <span key={p} style={{display:"flex",alignItems:"center",gap:3}}>
                    <span style={{width:6,height:6,borderRadius:"50%",background:c,display:"inline-block"}}/>
                    <span style={{color:"#475569",fontSize:9}}>{p}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Event detail panel */}
          <div style={{
            padding:"10px 14px",background:"#0a0f1a",borderTop:"1px solid #1e293b",
            flexShrink:0,minHeight:80,
          }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{color:phaseColor,fontSize:11,fontWeight:700,marginBottom:4}}>{ev.label}</div>
                <div style={{color:"#64748b",fontSize:11,maxWidth:600,lineHeight:1.4}}>{ev.detail}</div>
              </div>
              {ev.frame && (
                <button
                  onClick={()=>setShowPacket(p=>!p)}
                  style={{
                    background: showPacket ? `${phaseColor}33` : "#1e293b",
                    border:`1px solid ${showPacket ? phaseColor : "#334155"}`,
                    color: showPacket ? phaseColor : "#94a3b8",
                    padding:"4px 12px",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:600,
                    flexShrink:0,marginLeft:12,
                  }}
                >
                  {showPacket?"▼":"▶"} Inspect Packet
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Host B OSI Stack */}
        <div style={{width:220,borderLeft:"1px solid #1e293b",overflow:"hidden",display:"flex",flexDirection:"column",flexShrink:0}}>
          <OsiStack actorId="target" label="Host B — Target" layers={targLayers} activeStep={step} stepEvent={ev}/>
        </div>
      </div>

      {/* ── Packet Inspector overlay ──────────────────────────── */}
      {showPacket && ev.frame && (
        <div style={{
          position:"fixed",bottom:0,left:220,right:220,
          background:"#0a0f1a",borderTop:"2px solid #3b82f6",
          height:"45vh",display:"flex",flexDirection:"column",zIndex:100,
          boxShadow:"0 -8px 32px rgba(0,0,0,0.6)",
        }}>
          <div style={{
            padding:"6px 12px",background:"#0f172a",borderBottom:"1px solid #1e293b",
            display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,
          }}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{color:"#3b82f6",fontSize:11,fontWeight:800}}>PACKET INSPECTOR</span>
              <span style={{color:"#475569",fontSize:11}}>—</span>
              <span style={{color:"#e2e8f0",fontSize:11}}>{ev.frame.name}</span>
              <span style={{background:"#1e293b",color:"#94a3b8",fontSize:9,padding:"1px 6px",borderRadius:3}}>{ev.frame.bytes} bytes total</span>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{color:"#475569",fontSize:9}}>Click any field to expand • Spec refs & kernel source available</span>
              <button onClick={()=>setShowPacket(false)} style={{background:"none",border:"1px solid #334155",color:"#64748b",padding:"2px 8px",borderRadius:4,cursor:"pointer",fontSize:11}}>✕</button>
            </div>
          </div>
          <div style={{overflowY:"auto",flex:1,padding:8}}>
            {ev.frame.headers.map((h,i)=><HeaderBlock key={i} hdr={h}/>)}
          </div>
        </div>
      )}

      {/* Switch state footer strip */}
      <div style={{
        padding:"4px 12px",background:"#050d1a",borderTop:"1px solid #1e293b",
        display:"flex",gap:16,alignItems:"center",flexShrink:0,
      }}>
        <span style={{color:"#334155",fontSize:9,fontWeight:700}}>SWITCH</span>
        {swLayers.map(l=>
          Object.entries(l.fields).map(([k,v])=>(
            <span key={k} style={{display:"flex",gap:4,alignItems:"center"}}>
              <span style={{color:"#334155",fontSize:9,fontFamily:"monospace"}}>{k}</span>
              <span style={{color: String(v).includes("up")||v===true?"#34d399":"#475569",fontSize:9,fontFamily:"monospace",fontWeight:600}}>{String(v)}</span>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
