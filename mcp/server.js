import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { convertToScenarioYaml } from './lib/pcapToScenario.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = join(__dirname, '..', 'public', 'scenarios');
const MANIFEST_PATH = join(SCENARIOS_DIR, 'index.json');

// Cache
let manifest = null;
const scenarioCache = {};

function loadManifest() {
  if (!manifest) {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  }
  return manifest;
}

function loadScenario(slug) {
  if (scenarioCache[slug]) return scenarioCache[slug];

  const entry = loadManifest().scenarios.find(s => s.slug === slug);
  if (!entry) throw new Error(`Scenario "${slug}" not found`);

  const yamlPath = join(SCENARIOS_DIR, entry.path);
  const raw = yaml.load(readFileSync(yamlPath, 'utf-8'));
  scenarioCache[slug] = { meta: entry, data: raw };
  return scenarioCache[slug];
}

// --- MCP Server ---

const server = new McpServer({
  name: 'protoviz',
  version: '0.1.0',
});

// Tool: list_protocols
server.tool(
  'list_protocols',
  'List all available protocol visualization scenarios',
  {},
  async () => {
    const m = loadManifest();
    const list = m.scenarios.map(s => ({
      slug: s.slug,
      title: s.title,
      protocol: s.protocol,
      protocol_family: s.protocol_family,
      difficulty: s.difficulty,
      description: s.description,
      tags: s.tags,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
  }
);

// Tool: get_scenario_timeline
server.tool(
  'get_scenario_timeline',
  'Get the full timeline of events for a protocol scenario',
  {
    slug: z.string().describe('Scenario slug (e.g., "roce-v2-rc-connection-rdma-write-read")'),
  },
  async ({ slug }) => {
    const scenario = loadScenario(slug);
    const timeline = scenario.data.timeline || [];
    const events = timeline.map((ev, i) => ({
      step: i + 1,
      id: ev.id,
      type: ev.type,
      annotation: ev.annotation?.text || '',
      detail: ev.annotation?.detail || '',
      frame_id: ev.frame_id || null,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(events, null, 2) }] };
  }
);

// Tool: lookup_field
server.tool(
  'lookup_field',
  'Look up a protocol field definition by abbreviation (e.g., "bth.opcode", "reth.rkey")',
  {
    slug: z.string().describe('Scenario slug'),
    abbreviation: z.string().describe('Field abbreviation to look up'),
  },
  async ({ slug, abbreviation }) => {
    const scenario = loadScenario(slug);
    const frames = scenario.data.frames || [];
    const results = [];

    for (const frame of frames) {
      for (const header of (frame.headers || [])) {
        for (const field of (header.fields || [])) {
          if (field.abbreviation === abbreviation ||
              field.abbreviation?.includes(abbreviation) ||
              abbreviation.includes(field.abbreviation || '')) {
            results.push({
              frame: frame.id,
              header: header.name,
              layer: header.layer,
              field: {
                name: field.name,
                abbreviation: field.abbreviation,
                value: field.value,
                description: field.description,
                spec_refs: field.spec_refs,
                kernel_ref: field.kernel_ref,
              },
            });
          }
        }
      }
    }

    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No field matching "${abbreviation}" found in scenario "${slug}"` }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  }
);

// Tool: get_spec_reference
server.tool(
  'get_spec_reference',
  'Get spec references for a specific header or protocol element',
  {
    slug: z.string().describe('Scenario slug'),
    header_name: z.string().describe('Header name (e.g., "BTH", "RETH", "IPv4")'),
  },
  async ({ slug, header_name }) => {
    const scenario = loadScenario(slug);
    const frames = scenario.data.frames || [];
    const refs = [];

    for (const frame of frames) {
      for (const header of (frame.headers || [])) {
        if (header.name.toLowerCase().includes(header_name.toLowerCase())) {
          for (const field of (header.fields || [])) {
            if (field.spec_refs) {
              refs.push({
                field: field.name,
                abbreviation: field.abbreviation,
                spec_refs: field.spec_refs,
              });
            }
          }
        }
      }
    }

    if (refs.length === 0) {
      return { content: [{ type: 'text', text: `No spec references found for header "${header_name}" in scenario "${slug}"` }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(refs, null, 2) }] };
  }
);

// Tool: get_state_machine
server.tool(
  'get_state_machine',
  'Get state transitions for an actor across the scenario timeline',
  {
    slug: z.string().describe('Scenario slug'),
    actor_id: z.string().describe('Actor ID (e.g., "initiator", "target", "switch")'),
  },
  async ({ slug, actor_id }) => {
    const scenario = loadScenario(slug);
    const timeline = scenario.data.timeline || [];
    const transitions = [];

    for (let i = 0; i < timeline.length; i++) {
      const ev = timeline[i];
      const stateAfter = ev.state_after || [];
      const actorState = stateAfter.find(s => s.actor_id === actor_id);
      if (actorState) {
        transitions.push({
          step: i + 1,
          event_id: ev.id,
          annotation: ev.annotation?.text || '',
          layers: actorState.layers,
        });
      }
    }

    if (transitions.length === 0) {
      return { content: [{ type: 'text', text: `No state transitions found for actor "${actor_id}" in scenario "${slug}"` }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(transitions, null, 2) }] };
  }
);

// Tool: get_expected_sequence
server.tool(
  'get_expected_sequence',
  'Get the expected packet sequence for a specific operation (e.g., RDMA Write, QP setup)',
  {
    slug: z.string().describe('Scenario slug'),
    operation: z.string().optional().describe('Filter by operation type (e.g., "RDMA Write", "CM", "ARP")'),
  },
  async ({ slug, operation }) => {
    const scenario = loadScenario(slug);
    const timeline = scenario.data.timeline || [];

    let events = timeline.map((ev, i) => ({
      step: i + 1,
      id: ev.id,
      type: ev.type,
      annotation: ev.annotation?.text || '',
      frame_id: ev.frame_id || null,
    }));

    if (operation) {
      const op = operation.toLowerCase();
      events = events.filter(ev =>
        ev.annotation.toLowerCase().includes(op) ||
        ev.id.toLowerCase().includes(op) ||
        (ev.frame_id && ev.frame_id.toLowerCase().includes(op))
      );
    }

    if (events.length === 0) {
      return { content: [{ type: 'text', text: `No events matching "${operation}" found in scenario "${slug}"` }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(events, null, 2) }] };
  }
);

// Tool: generate_scenario
server.tool(
  'generate_scenario',
  'Generate a ProtoViz scenario from packet capture data. Accepts base64-encoded PCAP/pcapng or tshark JSON string. Returns a YAML scenario that can be loaded by the ProtoViz viewer.',
  {
    input_format: z.enum(['pcap_base64', 'tshark_json']).describe('Format of the input data'),
    data: z.string().describe('Base64-encoded PCAP file or tshark JSON string'),
    title: z.string().optional().describe('Custom title for the scenario'),
    scrub: z.boolean().optional().default(true).describe('Anonymize IPs, MACs, and strip payload data'),
    max_packets: z.number().optional().default(500).describe('Maximum packets to process'),
  },
  async ({ input_format, data, title, scrub, max_packets }) => {
    try {
      const yamlStr = convertToScenarioYaml({ input_format, data, title, scrub, max_packets });
      return {
        content: [{
          type: 'text',
          text: yamlStr,
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Error generating scenario: ${err.message}`,
        }],
        isError: true,
      };
    }
  }
);

// Resource: scenario data
server.resource(
  'scenario',
  'protoviz://scenarios/{slug}',
  async (uri) => {
    const slug = uri.pathname.split('/').pop();
    const scenario = loadScenario(slug);
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(scenario.data, null, 2),
      }],
    };
  }
);

// Start
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
