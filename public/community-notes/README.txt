Community Notes Static Fallback
================================

This directory contains curated community notes as static JSON files.
These serve as a fallback when the GitHub Discussions API is unavailable
(e.g., rate-limited or requiring authentication).

File format: {scenario-slug}.json

Example content:
{
  "notes": [
    {
      "step": 0,
      "author": "username",
      "date": "2026-01-15T10:00:00Z",
      "text": "This step establishes the initial connection...",
      "url": "https://github.com/provandal/protoviz/discussions/1",
      "field": null
    }
  ]
}

To add curated notes:
1. Create a JSON file named after the scenario slug
2. Follow the format above
3. Each note must have at minimum: step, author, text
