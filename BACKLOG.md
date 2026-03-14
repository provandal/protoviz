# ProtoViz Backlog

> Prioritized feature backlog for ProtoViz.
> Status: `planned` → `in-progress` → `done`
> Priority: P0 (foundation) → P1 (core value) → P2 (differentiation) → P3 (expansion)

---

## Phase 1 — Foundation

These unblock everything else. No user-facing features ship without these.

### 1.1 Project Scaffolding & Build System
- **Priority:** P0
- **Status:** planned
- **Description:** Set up Vite + React project structure. Split `ProtoViz.jsx`
  (903 lines) into proper components: `OsiStack`, `SequenceDiagram`,
  `PacketInspector`, `PlaybackControls`, `ScenarioLoader`, `App`. Add
  `package.json`, dev server, and production build.
- **Why first:** Nothing else can ship without a build system.

### 1.2 GitHub Pages Deployment
- **Priority:** P0
- **Status:** planned
- **Description:** GitHub Actions workflow to build and deploy to GitHub Pages
  on push to `main`. Target URL: `https://<user>.github.io/ProtoViz/`.
- **Depends on:** 1.1

### 1.3 License Change — MIT + Attribution
- **Priority:** P0
- **Status:** planned
- **Description:** Replace dual license (Apache+Commons Clause / CC BY 4.0)
  with single MIT license. Required attribution in LICENSE, README, and app
  footer/about panel:
  - **Creator:** Erik Smith (with LinkedIn URL)
  - **Contributors:** Claude.AI and Claude Code (Anthropic)
  - **Affiliation:** Dell; Chair, SNIA Data, Storage & Networking (DSN) Community
- **Why early:** Must be settled before attracting contributors.

### 1.4 Dynamic Scenario Loading
- **Priority:** P0
- **Status:** planned
- **Description:** Decouple scenario data from the viewer component. Viewer
  fetches scenario YAML/JSON files at runtime (from `/scenarios/` directory or
  via URL parameter). Enables multiple scenarios without rebuilding.
- **Depends on:** 1.1

---

## Phase 2 — Core User Experience

The features that make ProtoViz usable and shareable as a standalone tool.

### 2.1 Scenario Gallery / Landing Page
- **Priority:** P1
- **Status:** planned
- **Description:** Index page listing available scenarios. Browse by protocol,
  difficulty, tags. Card-based layout with scenario metadata (title, protocol,
  description, difficulty, author). Click to open viewer.
- **Depends on:** 1.4

### 2.2 Shareable URLs (Deep Links)
- **Priority:** P1
- **Status:** planned
- **Description:** URL routing so users can link to a specific scenario at a
  specific step. Format: `#/scenario-slug/step/12`. Paste in Slack, docs, or
  email and the recipient lands exactly where you intended.
- **Why:** This is how tools go viral in engineering teams.
- **Depends on:** 1.4

### 2.3 Responsive Design & Mobile Support
- **Priority:** P1
- **Status:** planned
- **Description:** Ensure the viewer is usable on tablets and large phones.
  Collapse the three-column layout to stacked/tabbed on smaller screens.
  The OSI stack and packet inspector can be toggled panels on mobile.
- **Depends on:** 1.1

### 2.4 Keyboard Navigation & Accessibility
- **Priority:** P1
- **Status:** planned
- **Description:** Arrow keys for step forward/back, spacebar for play/pause,
  Escape to close packet inspector. ARIA labels on interactive elements.
  Screen reader support for sequence diagram events.
- **Depends on:** 1.1

---

## Phase 3 — Annotations & Community

Features that transform ProtoViz from a viewer into a collaborative learning
platform.

### 3.1 Local Annotations
- **Priority:** P1
- **Status:** planned
- **Description:** Users can add personal notes to any timeline step or packet
  field. Stored in `localStorage`. Exportable/importable as JSON. Useful for
  instructors preparing a lesson or engineers bookmarking key moments.
- **Depends on:** 1.4

### 3.2 Community Notes
- **Priority:** P2
- **Status:** planned
- **Description:** Shared annotation layer — anyone can submit a note on a
  step/field (like X/Twitter Community Notes). Requires a lightweight backend
  or GitHub-based storage (e.g., GitHub Discussions API or a JSON file in the
  repo updated via PR). Moderation workflow needed.
- **Options:**
  - GitHub Discussions integration (free, no backend)
  - Lightweight serverless API (Cloudflare Workers / Netlify Functions)
  - JSON files in repo with PR-based contribution (fully static)
- **Depends on:** 3.1

### 3.3 Guided Walkthroughs / Tutorial Mode
- **Priority:** P2
- **Status:** planned
- **Description:** Authors can define a "guided path" through a scenario with
  callouts: "Notice this field..." / "This is where the handshake completes."
  Stored as an overlay in the scenario YAML. Supports step-by-step narration.
- **Depends on:** 1.4

### 3.4 Quiz / Assessment Mode
- **Priority:** P3
- **Status:** planned
- **Description:** Interactive questions embedded in scenarios: "What layer
  does this event happen at?", "What will the target respond with?", "What's
  wrong with this field value?" Useful for certification prep, onboarding,
  university courses.
- **Depends on:** 3.3

---

## Phase 4 — Troubleshooter

The diagnostic engine — turns ProtoViz from educational to operational.

### 4.1 Client-Side PCAP Parser
- **Priority:** P2
- **Status:** planned
- **Description:** In-browser PCAP/PCAPng parsing using JavaScript (e.g.,
  `pcap-parser` or custom WebAssembly module). Extracts packet headers into
  structured format without uploading data anywhere. Privacy-first: all
  parsing happens locally.
- **Depends on:** 1.1

### 4.2 Rule-Based Spec Compliance Checker
- **Priority:** P2
- **Status:** planned
- **Description:** State machine engine that validates protocol exchanges
  against spec rules:
  - PSN sequencing (gaps, duplicates, wrapping)
  - QP state machine transitions (RESET→INIT→RTR→RTS)
  - CM handshake completeness (REQ→REP→RTU)
  - Required field values (opcode validity, key authorization)
  - Timeout violations (CM timeouts, retry limits)
  - PFC/ECN consistency
  Rules are defined declaratively (JSON/YAML) so they can be extended per
  protocol.
- **Depends on:** 4.1

### 4.3 AI-Powered Deep Analysis (Hybrid Option B)
- **Priority:** P2
- **Status:** planned
- **Description:** Optional "Deep Analysis" button. Browser sends structured
  (not raw) packet summary to Claude API. Claude identifies:
  - Spec violations with specific section references
  - Interop mismatches (both sides compliant but incompatible behavior)
  - Performance issues (excessive retries, suboptimal MTU, missing ECN)
  - Suggested fixes with kernel/driver configuration references
  User provides their own API key or uses a future ProtoViz API proxy.
  Clear consent UX before any data leaves the browser.
- **Depends on:** 4.1, 4.2

### 4.4 Troubleshooter Results Visualization
- **Priority:** P2
- **Status:** planned
- **Description:** Display analysis results as an annotated scenario. The
  uploaded trace becomes a ProtoViz scenario with diagnostic overlays:
  red highlights on violations, warning icons on interop issues, green
  checkmarks on compliant exchanges. Users can step through their own
  trace the same way they explore reference scenarios.
- **Depends on:** 4.3, 1.4

### 4.5 Comparison Mode
- **Priority:** P2
- **Status:** planned
- **Description:** Side-by-side view of two scenarios — e.g., reference
  (working) vs. uploaded trace (broken). Highlights divergence points.
  "Here's where your connection went wrong compared to the reference."
- **Depends on:** 4.4

---

## Phase 5 — AI Agent Integration

Making ProtoViz useful for AI agents, not just humans.

### 5.1 MCP Server (Model Context Protocol)
- **Priority:** P2
- **Status:** planned
- **Description:** Expose ProtoViz scenarios as an MCP server. AI agents can
  query protocol knowledge contextually:
  - List available protocols and scenarios
  - Query field definitions, valid values, state machines
  - Look up spec references for a given header/field
  - Retrieve expected packet sequences for an operation
  Runs as a local MCP server or hosted service.
- **Depends on:** 1.4

### 5.2 Agent-Consumable Troubleshooter API
- **Priority:** P3
- **Status:** planned
- **Description:** REST/JSON API for the troubleshooter. An AI agent managing
  infrastructure can submit a PCAP programmatically and receive structured
  findings: spec violations, state machine errors, interop mismatches — all
  with spec references and suggested fixes. Could run as a serverless
  function or container.
- **Depends on:** 4.3

### 5.3 Protocol Knowledge Base for RAG
- **Priority:** P3
- **Status:** planned
- **Description:** Package scenario files as optimized RAG documents for AI
  coding assistants. An agent helping someone write RDMA code can pull in the
  exact field layout, kernel function reference, and spec section. Publish
  as a structured dataset or API endpoint.
- **Depends on:** 1.4

### 5.4 Live Scenario Generation by Agents
- **Priority:** P3
- **Status:** planned
- **Description:** AI agents monitoring networks generate ProtoViz scenarios
  from live or captured traffic. Creates a living library of real-world
  protocol exchanges that humans can review. Extends converter.py into an
  agent-callable service.
- **Depends on:** 4.1, 5.2

---

## Phase 6 — Ecosystem & Reach

Features that extend ProtoViz beyond the main site.

### 6.1 Embeddable Widget
- **Priority:** P2
- **Status:** planned
- **Description:** `<iframe>` embed code for any scenario (optionally locked
  to a step range). Blog authors, vendor docs, and training courses can embed
  interactive protocol visualizations inline. Compact mode with reduced chrome.
- **Depends on:** 2.2

### 6.2 Vendor-Specific Behavior Annotations
- **Priority:** P2
- **Status:** planned
- **Description:** Annotate where NIC implementations diverge from each other
  (ConnectX, E810, EFA, etc.) — not just from the spec. Schema extension for
  `vendor_notes` on fields. Leverages Erik's cross-vendor visibility from
  Dell/SNIA position.
- **Depends on:** 1.4

### 6.3 Additional Protocol Scenarios
- **Priority:** P2 (ongoing)
- **Status:** planned
- **Description:** Expand scenario library:
  - NVMe-oF over TCP
  - NVMe-oF over RDMA (RoCEv2)
  - iWARP
  - TCP (deep dive: congestion control, retransmission)
  - InfiniBand (native, non-RoCE)
  - PFC / ECN / DCQCN (congestion management deep dive)
  - ARP / NDP
  - BGP / OSPF (stretch goal)

### 6.4 Scenario Authoring Tool
- **Priority:** P3
- **Status:** planned
- **Description:** Visual editor for creating scenarios without hand-writing
  YAML. Drag-and-drop actors, define events, add field annotations. Lowers
  the contribution barrier significantly. Could be a separate page on the
  same GitHub Pages site.
- **Depends on:** 1.4, scenario.schema.json

### 6.5 Print / Export Mode
- **Priority:** P3
- **Status:** planned
- **Description:** Export a scenario (or a step range) as a PDF or set of
  images for use in slide decks, printed training materials, or
  documentation. Renders the sequence diagram and packet details as
  static images.
- **Depends on:** 1.1

---

## Dependency Graph (simplified)

```
1.1 Scaffolding
 ├── 1.2 GitHub Pages
 ├── 1.3 License
 ├── 1.4 Dynamic Loading
 │    ├── 2.1 Gallery
 │    ├── 2.2 Deep Links
 │    ├── 3.1 Local Annotations → 3.2 Community Notes
 │    ├── 3.3 Walkthroughs → 3.4 Quiz Mode
 │    ├── 5.1 MCP Server
 │    ├── 5.3 RAG Knowledge Base
 │    ├── 6.2 Vendor Annotations
 │    ├── 6.3 Protocol Scenarios
 │    └── 6.4 Authoring Tool
 ├── 2.3 Responsive Design
 ├── 2.4 Accessibility
 ├── 4.1 PCAP Parser
 │    ├── 4.2 Rule Checker
 │    │    └── 4.3 AI Analysis
 │    │         ├── 4.4 Results Viz → 4.5 Comparison Mode
 │    │         └── 5.2 Agent API → 5.4 Live Generation
 │    └── 5.4 Live Generation
 └── 6.5 Print/Export

2.2 Deep Links → 6.1 Embeddable Widget
```
