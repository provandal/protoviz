# ProtoViz Backlog

> Prioritized feature backlog for ProtoViz.
> Status: `planned` → `in-progress` → `done`
> Priority: P0 (foundation) → P1 (core value) → P2 (differentiation) → P3 (expansion)

---

## Phase 1 — Foundation

### 1.1 Project Scaffolding & Build System
- **Priority:** P0
- **Status:** done
- **Description:** Vite + React project with Zustand state management. Monolithic
  `ProtoViz.jsx` (903 lines) split into 12+ components: `OsiStack`,
  `SequenceDiagram`, `PacketInspector`, `HeaderBlock`, `PacketField`,
  `PlaybackControls`, `EventDetail`, `ActorHeaders`, `SwitchFooter`,
  `SplitLayout`, `BottomPane`, `PopoutView`, and `ProtoVizViewer` orchestrator.

### 1.2 GitHub Pages Deployment
- **Priority:** P0
- **Status:** done
- **Description:** GitHub Actions workflow builds and deploys to GitHub Pages
  on push to `main`. Live at `https://provandal.github.io/protoviz/`.

### 1.3 License — MIT + Attribution
- **Priority:** P0
- **Status:** done
- **Description:** MIT license with attribution to Erik Smith (Distinguished
  Engineer - Dell Technologies) and AI contributors (Claude.AI, Claude Code
  by Anthropic). Attribution in LICENSE, README, and app footer.

### 1.4 Dynamic Scenario Loading
- **Priority:** P0
- **Status:** done
- **Description:** Scenarios loaded at runtime from YAML files in
  `public/scenarios/`. `useScenario` hook fetches, parses (js-yaml), and
  normalizes into internal format. Manifest-based discovery via `index.json`.

---

## Phase 2 — Core User Experience

### 2.1 Scenario Gallery / Landing Page
- **Priority:** P1
- **Status:** done
- **Description:** Card-based gallery at root route. Filterable by protocol
  family, difficulty, and full-text search across title/description/tags.
  Responsive grid layout. Two scenarios currently: RoCEv2 and FC Fabric Login.

### 2.2 Shareable URLs (Deep Links)
- **Priority:** P1
- **Status:** done
- **Description:** HashRouter routes: `/#/:scenarioSlug/step/:stepNum`.
  URL syncs bidirectionally with viewer step. 1-indexed in URL for
  human-friendly sharing.

### 2.3 Responsive Design & Mobile Support
- **Priority:** P1
- **Status:** in-progress
- **Description:** Flexbox layout with resizable split panes. Gallery uses
  responsive grid. Desktop experience is solid; tablet/mobile collapse logic
  and touch interactions still needed.

### 2.4 Keyboard Navigation & Accessibility
- **Priority:** P1
- **Status:** done
- **Description:** `useKeyboardNav` hook: Arrow keys (step), Space (play/pause),
  Home/End (first/last step), numpad 1-4 (tab switching). Ignores input when
  typing in form fields.

---

## Phase 3 — Annotations & Community

### 3.1 Local Annotations
- **Priority:** P1
- **Status:** done
- **Description:** `useAnnotations` hook stores notes per step in
  `localStorage` keyed by scenario slug. Export/import as JSON. Displayed
  in the Explain tab with inline edit UI.

### 3.2 Community Notes
- **Priority:** P2
- **Status:** planned
- **Description:** Shared annotation layer via GitHub Discussions API.
  Public read (no auth), GitHub auth to post. Structured metadata header
  links notes to specific scenario/step/field.

### 3.3 Guided Walkthroughs / Tutorial Mode
- **Priority:** P2
- **Status:** planned
- **Description:** Authors define guided paths in scenario YAML. Step-by-step
  narration with callouts. Overlay UI for guided navigation.

### 3.4 Quiz / Assessment Mode
- **Priority:** P3
- **Status:** planned
- **Description:** Interactive questions embedded in scenarios. Multiple choice
  or free-form at specific steps. Score tracking in localStorage.
- **Depends on:** 3.3

---

## Phase 4 — Troubleshooter

The diagnostic engine — turns ProtoViz from educational to operational.

### 4.1 Client-Side PCAP Parser
- **Priority:** P2
- **Status:** done
- **Description:** Custom JS parser supporting both PCAP and pcapng formats.
  Magic-byte-based format detection (not file extension). Dissector pipeline:
  Ethernet → IPv4 → TCP/UDP → RoCEv2 (BTH/RETH/AETH). Also supports
  `tshark -T json` import for full Wireshark dissection of 3000+ protocols.
  UTF-16 BOM handling for PowerShell output. Privacy-first: all parsing
  happens locally in the browser.

### 4.2 Rule-Based Spec Compliance Checker
- **Priority:** P2
- **Status:** done
- **Description:** Declarative JSON rule engine with four rule types:
  `field_value`, `psn_sequence`, `tcp_flag_present`, `sequence_pattern`.
  Rules in `public/rules/roce-v2.json`. Clickable findings navigate to
  the flagged packet. Returns structured findings with severity, packet
  index, description, and spec references.

### 4.3 AI-Powered Trace Analysis
- **Priority:** P2
- **Status:** done
- **Description:** Two AI chat integrations:
  - **Scenario Chat:** context-aware chat per step with spec/kernel references
  - **Trace Chat:** PCAP troubleshooter chat with full trace summary context
    (protocol breakdown, endpoints, findings, selected packet details)
  User-provided API key (stored in localStorage). Model selection
  (Sonnet/Opus/Haiku). Streaming responses with abort control.

### 4.4 ULP Payload Dissection
- **Priority:** P2
- **Status:** done
- **Description:** Captures first 64 bytes of payload after transport headers.
  Protocol-specific dissectors for iSCSI (BHS, CDB, SCSI status),
  NVMe-oF/TCP (PDU type, NVMe opcode), TLS (version, handshake type),
  HTTP (method, URI, status), and DNS (query/response, domain name).
  Falls back to hex dump + ASCII for unrecognized protocols.

### 4.5 Conversation-to-Scenario Conversion
- **Priority:** P2
- **Status:** done
- **Description:** Right-click any packet in the troubleshooter to extract
  the full conversation between two endpoints. Filters by IP pair, infers
  phases (TCP Handshake/Data/Teardown, RDMA operations), generates labels,
  and converts to a ProtoViz scenario viewable in the interactive viewer.

### 4.6 Comparison Mode
- **Priority:** P2
- **Status:** planned
- **Description:** Side-by-side view of two scenarios — reference (working)
  vs. uploaded trace (broken). Highlights divergence points.

---

## Phase 5 — AI Agent Integration

### 5.1 MCP Server (Model Context Protocol)
- **Priority:** P2
- **Status:** done
- **Description:** MCP server in `mcp/` exposing six tools: `list_protocols`,
  `get_scenario_timeline`, `lookup_field`, `get_spec_reference`,
  `get_state_machine`, `get_expected_sequence`. Plus scenario resources
  via `scenario://` URI scheme. Zod schema validation.

### 5.2 Agent-Consumable Troubleshooter API
- **Priority:** P3
- **Status:** planned
- **Description:** REST/JSON API wrapping the rule engine + AI analysis.
  Serverless function for programmatic PCAP submission and structured
  findings retrieval.

### 5.3 Protocol Knowledge Base for RAG
- **Priority:** P3
- **Status:** planned
- **Description:** Package scenario files as optimized RAG documents for
  AI coding assistants. Structured dataset or API endpoint.

### 5.4 Live Scenario Generation by Agents
- **Priority:** P3
- **Status:** planned
- **Description:** AI agents generate ProtoViz scenarios from live or
  captured traffic. Extends converter.py into an agent-callable service.

---

## Phase 6 — Ecosystem & Reach

### 6.1 AI-Powered Scenario Creator
- **Priority:** P2
- **Status:** done
- **Description:** `ScenarioCreator` page where users describe a protocol
  exchange in natural language and Claude generates valid scenario YAML.
  Example prompts provided. Lowers the contribution barrier — no need to
  hand-write YAML.

### 6.2 Embeddable Widget
- **Priority:** P2
- **Status:** planned
- **Description:** `<iframe>` embed code for any scenario (optionally locked
  to a step range). Compact mode with reduced chrome for embedding in
  blog posts, vendor docs, and training courses.

### 6.3 Additional Protocol Scenarios
- **Priority:** P2 (ongoing)
- **Status:** in-progress
- **Description:** Expand scenario library. Completed:
  - RoCEv2 RC Connection with RDMA Write/Read
  - Fibre Channel Fabric Login with SCSI I/O
  Planned:
  - NVMe-oF over TCP
  - NVMe-oF over RDMA (RoCEv2)
  - iWARP
  - TCP deep dive (congestion control, retransmission)
  - Native InfiniBand
  - PFC / ECN / DCQCN
  - ARP / NDP

### 6.4 Vendor-Specific Behavior Annotations
- **Priority:** P2
- **Status:** planned
- **Description:** Schema extension for `vendor_notes` on fields. Annotate
  where NIC implementations diverge from each other and from the spec.

### 6.5 Print / Export Mode
- **Priority:** P3
- **Status:** planned
- **Description:** Export a scenario or step range as PDF/images for slide
  decks, printed training materials, or documentation.

### 6.6 Pop-Out Detail Panel
- **Priority:** P1
- **Status:** done
- **Description:** Detail panel (Explain, Inspect, Chat, About tabs) can be
  popped out to a separate window via `usePopout` hook. Two-way
  BroadcastChannel sync for step changes, tab switches, and chat messages.

### 6.7 Resizable Split Layout
- **Priority:** P1
- **Status:** done
- **Description:** `SplitLayout` component with mouse-drag resize between
  top (visualization) and bottom (detail) panes. Constrained 20-85%.
  Position persisted in Zustand store.

---

## Dependency Graph (simplified)

```
1.1 Scaffolding ✓
 ├── 1.2 GitHub Pages ✓
 ├── 1.3 License ✓
 ├── 1.4 Dynamic Loading ✓
 │    ├── 2.1 Gallery ✓
 │    ├── 2.2 Deep Links ✓
 │    ├── 3.1 Local Annotations ✓ → 3.2 Community Notes
 │    ├── 3.3 Walkthroughs → 3.4 Quiz Mode
 │    ├── 5.1 MCP Server ✓
 │    ├── 5.3 RAG Knowledge Base
 │    ├── 6.3 Protocol Scenarios (in-progress)
 │    ├── 6.4 Vendor Annotations
 │    └── 6.1 Scenario Creator ✓
 ├── 2.3 Responsive Design (in-progress)
 ├── 2.4 Accessibility ✓
 ├── 4.1 PCAP Parser ✓
 │    ├── 4.2 Rule Checker ✓
 │    │    └── 4.3 AI Analysis ✓
 │    │         ├── 4.4 ULP Dissection ✓
 │    │         ├── 4.5 Conversation→Scenario ✓
 │    │         ├── 4.6 Comparison Mode
 │    │         └── 5.2 Agent API → 5.4 Live Generation
 │    └── 5.4 Live Generation
 └── 6.5 Print/Export

2.2 Deep Links ✓ → 6.2 Embeddable Widget
```
