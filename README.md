# ProtoViz

**Interactive protocol visualization for network engineers, students, and anyone curious about what happens on the wire.**

[![Deploy to GitHub Pages](https://github.com/provandal/protoviz/actions/workflows/deploy.yml/badge.svg)](https://github.com/provandal/protoviz/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Live:** [https://provandal.github.io/protoviz/](https://provandal.github.io/protoviz/)

---

## What is ProtoViz?

ProtoViz is an open-source, browser-based platform that turns protocol exchanges into interactive, step-by-step visualizations. Each scenario is a YAML file describing a complete protocol interaction — from physical link establishment through application-layer operations — with every frame field annotated with spec references and Linux kernel source cross-links.

### Features

- **Animated Sequence Diagrams** — Phase-grouped timeline with play/pause/step and scrubbing
- **OSI Stack Visualization** — Live 7-layer state for each actor, updated per step
- **Wireshark-style Packet Inspector** — Drill into every header field with expandable details, spec references, and kernel source links
- **AI Chat** — Protocol Q&A with full context awareness (bring your own API key)
- **PCAP Troubleshooter** — Upload a capture file for client-side parsing and rule-based compliance checking (nothing leaves your browser)
- **Annotations** — Add personal notes to any step, export/import as JSON
- **Pop-out Detail Panel** — Detach the bottom pane to a separate window for multi-monitor setups
- **Keyboard Navigation** — Arrow keys, Space (play/pause), Home/End, 1-4 (tab switch)
- **Deep Links** — Shareable URLs pointing to a specific scenario and step
- **Scenario Gallery** — Browse, filter, and search available scenarios
- **MCP Server** — Protocol knowledge tools for AI agents via Model Context Protocol

### Current Scenarios

| Scenario | Protocol | Difficulty |
|----------|----------|------------|
| RoCEv2 RC: Link Training → QP Connection → RDMA WRITE → RDMA READ | RoCEv2 | Advanced |

More scenarios coming: NVMe-oF/TCP, NVMe-oF/RDMA, iWARP, TCP deep dive, native InfiniBand, PFC/ECN/DCQCN.

---

## Quick Start

```bash
git clone https://github.com/provandal/protoviz.git
cd protoviz
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Production Build

```bash
npm run build    # outputs to dist/
npm run preview  # preview the production build locally
```

### Convert a PCAP to a Scenario

```bash
pip install scapy pyyaml anthropic
python tools/converter.py my_capture.pcap --out public/scenarios/my_protocol/my_scenario.yaml
```

---

## PCAP Troubleshooter

Upload a `.pcap` file to analyze protocol compliance entirely in your browser — no data leaves your machine.

**Supported dissectors:** Ethernet, IPv4, UDP, TCP, RoCEv2 (BTH, RETH, AETH)

**Rule engine checks:** PSN continuity, RDMA Write/Read sequence patterns, field validation against spec.

---

## MCP Server

ProtoViz includes an MCP (Model Context Protocol) server that exposes protocol knowledge to AI agents.

```bash
cd mcp
npm install
npm start
```

| Tool | Description |
|------|-------------|
| `list_protocols` | List all available scenarios |
| `get_scenario_timeline` | Get the full event timeline |
| `lookup_field` | Look up a field by abbreviation (e.g., `bth.opcode`) |
| `get_spec_reference` | Get spec references for a header |
| `get_state_machine` | Get state transitions for an actor |
| `get_expected_sequence` | Get expected packet sequence for an operation |

---

## Project Structure

```
protoviz/
├── src/
│   ├── components/
│   │   ├── viewer/          # Sequence diagram, OSI stacks, packet inspector
│   │   ├── gallery/         # Landing page, scenario cards, filters
│   │   ├── layout/          # Split layout, bottom pane, popout view
│   │   ├── chat/            # AI chat panel
│   │   ├── troubleshooter/  # PCAP upload, packet list, findings
│   │   └── about/           # About panel
│   ├── hooks/               # useScenario, usePlayback, useKeyboardNav, usePopout, useAnnotations
│   ├── pcap/                # PCAP parser, dissectors (Ethernet, IPv4, UDP, TCP, RoCE), rule engine
│   ├── store/               # Zustand state management
│   ├── utils/               # Constants, state engine, scenario normalizer
│   └── styles/
├── public/
│   ├── scenarios/           # YAML scenario files + index.json manifest
│   └── rules/               # Declarative compliance rules
├── mcp/                     # MCP server for AI agents
├── tools/                   # Python PCAP converter
├── .github/workflows/       # GitHub Pages deployment
├── scenario.schema.json     # JSON Schema for scenario validation
└── index.html               # Vite entry point
```

---

## Scenario Format

Scenarios are YAML files conforming to `scenario.schema.json`. Key sections:

- `topology` — Actors (hosts, switches) and physical links
- `osi_layers` — Per-actor layer definitions with state schemas
- `frames` — Frame library with header trees and annotated fields
- `timeline` — Ordered events referencing frames and state deltas
- `glossary` — Protocol terms with definitions

Each field can carry `spec_refs` (IBTA, RFC, IEEE), `kernel_ref` (Linux kernel source), and `description`.

See `public/scenarios/roce/` for a complete example.

---

## How Source-to-Scenario Works

The viewer is grounded in Linux kernel source. Kernel references are cited at the field level:

| Scenario Element | Kernel Source |
|---|---|
| QP state machine transitions | `drivers/infiniband/core/verbs.c` → `ib_modify_qp()` |
| QP creation, WQE posting | `drivers/infiniband/hw/mlx5/qp.c` → `mlx5_ib_create_qp()` |
| Memory Region registration | `drivers/infiniband/hw/mlx5/mr.c` → `mlx5_ib_reg_user_mr()` |
| Connection Manager REQ/REP/RTU | `drivers/infiniband/core/cm.c` → `ib_send_cm_req()` |
| CQ polling | `drivers/infiniband/hw/mlx5/cq.c` → `mlx5_ib_poll_cq()` |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. We welcome new scenarios, dissectors, compliance rules, and viewer improvements.

---

## Authors

**Created by:** [Erik Smith](https://www.linkedin.com/in/erik-smith-a899ba3/)
Dell | Chair, SNIA Data, Storage & Networking (DSN) Community

**AI Contributors:** Built with [Claude.AI](https://claude.ai) and [Claude Code](https://claude.ai/claude-code) by Anthropic

## Acknowledgments

- SNIA (Storage Networking Industry Association) — education mission
- Linux RDMA community (`rdma-core`, `drivers/infiniband/`)
- InfiniBand Trade Association — IBTA specifications

---

## License

[MIT](LICENSE)
