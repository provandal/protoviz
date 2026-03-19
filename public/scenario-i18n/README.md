# Scenario Translation Overlays

ProtoViz scenarios are authored in English (YAML). Translations are provided as
JSON **overlay** files that replace user-visible text while leaving protocol
fields, spec references, abbreviations, and structural data untouched.

## Directory layout

```
public/scenario-i18n/
  {locale}/
    {scenario-slug}.json
```

Example:

```
public/scenario-i18n/
  es/
    tcp-3way-handshake-data-fin.json
  zh-CN/
    tcp-3way-handshake-data-fin.json
```

The locale code must match one of the `supportedLngs` in `src/i18n/i18n.js`.

## Overlay format

Each overlay JSON has these top-level sections (all optional — include only the
sections you are translating):

| Section        | Key strategy                         | What to translate                                  |
|----------------|--------------------------------------|----------------------------------------------------|
| `meta`         | Fixed keys                           | `title`, `description`, `learning_objectives[]`    |
| `actors`       | Keyed by actor `id`                  | `label`, `description`                             |
| `timeline`     | Keyed by zero-based index (string)   | `text` (annotation label), `detail`                |
| `walkthroughs` | Keyed by walkthrough `id`            | `title`, `description`, `steps` (keyed by index)   |
| `glossary`     | Keyed by original **English** term   | `term`, `definition`                               |
| `frames`       | Keyed by frame `id`                  | `name`                                             |

### Example (Spanish)

```json
{
  "meta": {
    "title": "TCP: Negociacion en 3 pasos ...",
    "description": "Ciclo de vida completo ..."
  },
  "actors": {
    "client": { "label": "Cliente", "description": "..." }
  },
  "timeline": {
    "0": { "text": "Enlace fisico activo ...", "detail": "..." },
    "1": { "text": "Solicitud ARP ...", "detail": "..." }
  },
  "walkthroughs": {
    "default": {
      "title": "Ciclo de vida de una conexion TCP",
      "steps": {
        "0": "Antes de poder intercambiar datos ...",
        "1": "El cliente quiere comunicarse ..."
      }
    }
  },
  "glossary": {
    "3-Way Handshake": {
      "term": "Negociacion en 3 pasos",
      "definition": "Procedimiento de establecimiento ..."
    }
  },
  "frames": {
    "arp_request": { "name": "Solicitud ARP" }
  }
}
```

## What NOT to translate

- Protocol abbreviations and technical terms that are universally recognized
  (SYN, ACK, FIN, MSS, ISN, etc.)
- IP addresses, MAC addresses, port numbers
- Sequence numbers, byte counts, timing values
- RFC document numbers and section references
- Linux kernel file paths and function names
- Field abbreviations (`tcp.flags`, `eth.dst`, etc.)
- Hex values

## Generating a template

Use the extraction tool to produce a blank overlay pre-filled with English text:

```bash
node tools/extract-translations.js public/scenarios/tcp/tcp-3way-handshake-data-fin.yaml > template.json
```

Copy the output to `public/scenario-i18n/{locale}/{slug}.json` and replace the
English text with the target language. Remove the `_event_id` helper keys from
the `timeline` entries if you wish (they are ignored at runtime).

## How it works at runtime

1. `useScenario` fetches and normalizes the YAML scenario (always English).
2. It checks the current i18n language (`i18n.language`).
3. If not English, it fetches `scenario-i18n/{locale}/{slug}.json`.
4. The `mergeOverlay()` function deep-merges translated text onto the normalized
   scenario clone.
5. When the user switches languages, the overlay is re-fetched and re-applied
   without reloading the YAML.

If a translation overlay is missing or a fetch fails, the English scenario is
used as-is — no error is shown to the user.

## Contributing a translation

1. Run the extraction tool to generate a template (see above).
2. Translate the text fields. Keep protocol terms consistent with established
   technical vocabulary in the target language.
3. Save as `public/scenario-i18n/{locale}/{slug}.json`.
4. Test by switching ProtoViz to the target language while viewing the scenario.
5. Submit a pull request.
