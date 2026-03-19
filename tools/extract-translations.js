#!/usr/bin/env node

/**
 * extract-translations.js
 *
 * Reads a ProtoViz scenario YAML file and outputs a blank translation overlay
 * JSON template.  Translators fill in the values (initially set to the English
 * source text) and save as:
 *
 *   public/scenario-i18n/{locale}/{slug}.json
 *
 * Usage:
 *   node tools/extract-translations.js public/scenarios/tcp/tcp-3way-handshake-data-fin.yaml
 *   node tools/extract-translations.js <path-to-yaml> > overlay-template.json
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

function trimText(val) {
  if (typeof val === 'string') return val.trim();
  return val ?? '';
}

// ───────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node tools/extract-translations.js <scenario.yaml>');
  process.exit(1);
}

const filePath = resolve(args[0]);
const raw = yaml.load(readFileSync(filePath, 'utf8'));

const overlay = {
  _comment: 'Translation overlay template — replace English text with the target language. Do not modify keys or add/remove entries.',
};

// ── Meta ──────────────────────────────────────────────────────────
overlay.meta = {
  title: trimText(raw.meta?.title),
  description: trimText(raw.meta?.description),
  learning_objectives: (raw.meta?.learning_objectives || []).map(trimText),
};

// ── Actors ────────────────────────────────────────────────────────
overlay.actors = {};
for (const actor of raw.topology?.actors || []) {
  overlay.actors[actor.id] = {
    label: trimText(actor.label),
    description: trimText(actor.description),
  };
}

// ── Timeline ──────────────────────────────────────────────────────
overlay.timeline = {};
(raw.timeline || []).forEach((ev, idx) => {
  overlay.timeline[String(idx)] = {
    _event_id: ev.id,
    text: trimText(ev.annotation?.text),
    detail: trimText(ev.annotation?.detail),
  };
});

// ── Walkthroughs ──────────────────────────────────────────────────
overlay.walkthroughs = {};
for (const wt of raw.walkthroughs || []) {
  const steps = {};
  (wt.steps || []).forEach((s, idx) => {
    steps[String(idx)] = trimText(s.narration);
  });
  overlay.walkthroughs[wt.id] = {
    title: trimText(wt.title),
    description: trimText(wt.description),
    steps,
  };
}

// ── Glossary ──────────────────────────────────────────────────────
overlay.glossary = {};
for (const g of raw.glossary || []) {
  overlay.glossary[g.term] = {
    term: trimText(g.term),
    definition: trimText(g.definition),
  };
}

// ── Frames ────────────────────────────────────────────────────────
overlay.frames = {};
for (const frame of raw.frames || []) {
  overlay.frames[frame.id] = {
    name: trimText(frame.name),
  };
}

// ── Output ────────────────────────────────────────────────────────
console.log(JSON.stringify(overlay, null, 2));
