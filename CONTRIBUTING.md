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

1. Create a YAML file in `public/scenarios/<protocol>/` following `scenario.schema.json`
2. Add an entry to `public/scenarios/index.json` with slug, title, protocol, difficulty, description, and tags
3. Test with `npm run dev` — your scenario should appear in the gallery

### Scenario YAML Structure

- `topology` — Define actors (hosts, switches) and their positions
- `osi_layers` — Define per-actor OSI layer fields and initial state
- `frames` — Define packet frames with headers, fields, spec refs, and kernel refs
- `timeline` — Define the step-by-step event sequence with frame references and state deltas
- `glossary` — Protocol terms with definitions

See `public/scenarios/roce/` for a complete example.

### Requirements for Scenario PRs

| Requirement | Details |
|---|---|
| Valid YAML | Must conform to `scenario.schema.json` |
| Field descriptions | No empty description fields |
| Spec references | Transport header fields should reference spec sections |
| Learning objectives | Include at least 3 in `meta.learning_objectives` |
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
