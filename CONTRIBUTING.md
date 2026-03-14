# Contributing to ProtoViz

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/provandal/protoviz.git
cd protoviz
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Adding a New Scenario

The recommended way to create a new scenario is to use the **Scenario Creator** built into ProtoViz. You do NOT need to write YAML by hand.

### Using the Scenario Creator (recommended)

1. Open ProtoViz and click **Create Scenario** on the landing page (or navigate to `/#/create`)
2. Enter your Anthropic API key (stored locally in your browser, never shared)
3. Describe the protocol exchange you want to visualize in plain English — for example:
   - *"TCP three-way handshake between a client and a web server, including SYN, SYN-ACK, and ACK with typical field values"*
   - *"NVMe-oF/TCP connection setup: TCP handshake, then NVMe-oF Connect command and response"*
4. Click **Generate Scenario** — the AI will produce a complete YAML file conforming to the ProtoViz schema
5. Download the generated `.yaml` file
6. Review and refine: check field values, spec references, and descriptions for accuracy
7. Place the file in `public/scenarios/<protocol>/` and add an entry to `public/scenarios/index.json`
8. Test with `npm run dev` — your scenario should appear in the gallery

### From a PCAP file

If you have a packet capture, use the Python converter:

```bash
pip install scapy pyyaml anthropic
python tools/converter.py my_capture.pcap --out public/scenarios/my_protocol/my_scenario.yaml
```

### Scenario YAML Structure

For reference, the key sections of a scenario file are:

- `meta` — Title, protocol, authors, description, learning objectives
- `topology` — Actors (hosts, switches) and their positions
- `osi_layers` — Per-actor OSI layer fields and initial state
- `frames` — Packet frames with headers, fields, spec refs, and kernel refs
- `timeline` — Step-by-step event sequence with frame references and state deltas
- `glossary` — Protocol terms with definitions

See `public/scenarios/roce/` for a complete example and `scenario.schema.json` for the full specification.

### Requirements for Scenario PRs

| Requirement | Details |
|---|---|
| Valid YAML | Must conform to `scenario.schema.json` |
| Field descriptions | No empty description fields |
| Spec references | Transport header fields should reference spec sections |
| Accuracy | Review AI-generated content for correctness before submitting |
| Attribution | Your name in `meta.authors` |

## Adding Compliance Rules

Rules live in `public/rules/` as JSON files. Supported rule types:

- `field_value` — Validate specific field values against expected/invalid lists
- `psn_sequence` — Check for PSN gaps in RoCE QP streams
- `sequence_pattern` — Verify expected packet sequence patterns appear

## Adding a Dissector

Protocol dissectors are in `src/pcap/dissectors/`. Each dissector:

1. Takes `(data, offset)` — raw packet bytes and starting offset
2. Returns `{ layer, name, fields, nextOffset, nextProtocol }`
3. Gets wired into the pipeline in `src/pcap/dissect.js`

## Code Style

- React 18 functional components with hooks
- Zustand for state management
- Inline styles (CSS modules migration planned)
- No TypeScript yet (planned)

## Pull Requests

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Verify `npm run build` succeeds
5. Submit a PR with a clear description

## Reporting Issues

Open an issue at [github.com/provandal/protoviz/issues](https://github.com/provandal/protoviz/issues).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
