# ProtoViz Roadmap

> Remaining features and ideas tracked as [GitHub Issues](https://github.com/provandal/protoviz/issues).
> This file is a high-level overview — see Issues for details and discussion.

---

## Up Next

### Responsive Design & Mobile Support
Collapse the three-column layout to stacked/tabbed on smaller screens.
Desktop is solid; tablet and mobile need work.

### Comparison Mode
Side-by-side view of two scenarios (e.g., reference vs. uploaded trace).
Highlight divergence points.

### Additional Protocol Scenarios
Expand the scenario library beyond RoCEv2 and Fibre Channel:
NVMe-oF/TCP, NVMe-oF/RDMA, iWARP, TCP deep dive, native InfiniBand,
PFC/ECN/DCQCN, ARP/NDP.

### Community Notes
Shared annotation layer via GitHub Discussions API. Public read,
GitHub auth to post.

---

## Future

### Guided Walkthroughs / Tutorial Mode
Authors define guided paths in scenario YAML with step-by-step narration
and callouts.

### Quiz / Assessment Mode
Interactive questions embedded in scenarios for certification prep,
onboarding, and university courses.

### Embeddable Widget
`<iframe>` embed code for any scenario, optionally locked to a step range.
Compact mode for blog posts, vendor docs, and training courses.

### Vendor-Specific Behavior Annotations
Schema extension for `vendor_notes` on fields — where NIC implementations
diverge from each other and from the spec.

### Print / Export Mode
Export a scenario or step range as PDF/images for slide decks and
training materials.

### Agent-Consumable Troubleshooter API
REST/JSON API wrapping the rule engine + AI analysis for programmatic
PCAP submission by AI agents.

### Protocol Knowledge Base for RAG
Package scenario files as optimized RAG documents for AI coding assistants.

### Live Scenario Generation by Agents
AI agents generate ProtoViz scenarios from live or captured traffic.
