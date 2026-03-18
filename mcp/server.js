import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { convertToScenarioYaml, parseCapture } from './lib/pcapToScenario.js';
import { analyzePackets } from './lib/ruleEngine.js';
import { dissectPacketDetailed } from './lib/packetDissector.js';
import { groupFlows, filterFlows } from './lib/flowGrouper.js';

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

// ─── Scenario Helpers for validate_sequence ─────────────────────

/**
 * Build a protocol-to-scenario mapping from the manifest.
 */
function buildProtocolMap() {
  const m = loadManifest();
  const map = {};

  for (const s of m.scenarios) {
    // Index by protocol, protocol_family, and tags
    const keys = [
      s.protocol?.toLowerCase(),
      s.protocol_family?.toLowerCase(),
      ...(s.tags || []).map(t => t.toLowerCase()),
    ].filter(Boolean);

    for (const key of keys) {
      if (!map[key]) map[key] = [];
      if (!map[key].includes(s.slug)) {
        map[key].push(s.slug);
      }
    }
  }

  return map;
}

/**
 * Find the best matching scenario slug(s) for a protocol string.
 */
function findScenariosForProtocol(protocol) {
  const map = buildProtocolMap();
  const query = protocol.toLowerCase();

  // Exact match first
  if (map[query]) return map[query];

  // Partial match
  const matches = [];
  for (const [key, slugs] of Object.entries(map)) {
    if (key.includes(query) || query.includes(key)) {
      for (const slug of slugs) {
        if (!matches.includes(slug)) matches.push(slug);
      }
    }
  }

  return matches;
}

/**
 * Extract the opcode/operation sequence from a scenario timeline.
 * Produces a simplified list of step labels (TCP flags, RoCE opcodes, etc.).
 */
function extractSequence(scenario, operation) {
  const timeline = scenario.data.timeline || [];
  const frames = scenario.data.frames || [];

  // Build frame lookup
  const frameMap = {};
  for (const frame of frames) {
    frameMap[frame.id] = frame;
  }

  let steps = [];

  for (const ev of timeline) {
    if (ev.type !== 'frame_tx') continue;

    const annotation = ev.annotation?.text || '';
    const frameId = ev.frame_id || '';
    const frame = frameMap[frameId];

    // Extract a short label from the annotation or frame
    let label = '';

    // Try to get a concise opcode/flag name
    if (frame) {
      const frameName = frame.name || '';
      // Check for TCP flags
      const tcpMatch = frameName.match(/TCP\s*\[([^\]]+)\]/);
      if (tcpMatch) {
        label = tcpMatch[1]; // e.g., "SYN,ACK"
      }
      // Check for RoCE/BTH opcodes
      const bthHeader = (frame.headers || []).find(h => h.name && h.name.includes('BTH'));
      if (bthHeader) {
        const opcodeField = (bthHeader.fields || []).find(f =>
          f.name?.toLowerCase().includes('opcode') || f.abbreviation?.includes('opcode')
        );
        if (opcodeField) {
          label = opcodeField.value || opcodeField.description || frameName;
        } else {
          // Extract from BTH header name: "BTH (RC RDMA Write Only)"
          const bthMatch = bthHeader.name.match(/BTH\s*\((.+)\)/);
          if (bthMatch) label = bthMatch[1];
        }
      }
      if (!label) label = frameName;
    }

    if (!label) {
      // Fall back to annotation text, simplified.
      // Split on arrow/dash delimiters (with surrounding spaces) but preserve
      // hyphens inside tokens like "SYN-ACK".
      label = annotation
        .split(/\s+[→←—]\s+/)[0]  // Split on " → ", " ← ", " — "
        .trim();
      if (!label) label = annotation.split('—')[0].trim();
    }

    if (label) {
      steps.push({
        label,
        annotation,
        frame_id: frameId,
      });
    }
  }

  // Filter by operation if specified
  if (operation) {
    const op = operation.toLowerCase();
    // First try filtering the steps
    const filtered = steps.filter(s =>
      s.label.toLowerCase().includes(op) ||
      s.annotation.toLowerCase().includes(op) ||
      s.frame_id.toLowerCase().includes(op)
    );
    if (filtered.length > 0) {
      steps = filtered;
    }
    // If no match, return all steps (the whole scenario is the operation)
  }

  return steps;
}

/**
 * Fuzzy-compare a user-provided sequence against an expected sequence.
 * Returns comparison result with divergence info.
 */
function compareSequences(userSeq, expectedSteps) {
  const expectedLabels = expectedSteps.map(s => s.label);

  if (userSeq.length === 0) {
    return {
      match: false,
      expected_sequence: expectedLabels,
      divergence_point: {
        index: 0,
        expected: expectedLabels[0] || null,
        got: null,
        explanation: 'Empty sequence provided. Nothing to compare.',
      },
      suggestions: ['Provide at least one operation/opcode in the sequence.'],
    };
  }

  // Fuzzy matching: walk through expected and try to match user items
  let userIdx = 0;
  let expIdx = 0;
  const matched = [];
  const divergences = [];

  while (userIdx < userSeq.length && expIdx < expectedLabels.length) {
    const userItem = userSeq[userIdx].toLowerCase().trim();
    const expItem = expectedLabels[expIdx].toLowerCase().trim();

    if (expItem.includes(userItem) || userItem.includes(expItem) || fuzzyMatch(userItem, expItem)) {
      matched.push({ user: userSeq[userIdx], expected: expectedLabels[expIdx], index: userIdx });
      userIdx++;
      expIdx++;
    } else {
      // Try to find the user item further in expected
      let found = false;
      for (let ahead = expIdx + 1; ahead < expectedLabels.length && ahead < expIdx + 5; ahead++) {
        const aheadItem = expectedLabels[ahead].toLowerCase().trim();
        if (aheadItem.includes(userItem) || userItem.includes(aheadItem) || fuzzyMatch(userItem, aheadItem)) {
          // User skipped some expected steps
          for (let skip = expIdx; skip < ahead; skip++) {
            divergences.push({
              index: userIdx,
              type: 'missing_step',
              expected: expectedLabels[skip],
              explanation: `Expected "${expectedLabels[skip]}" before "${userSeq[userIdx]}" but it was not in the provided sequence.`,
            });
          }
          matched.push({ user: userSeq[userIdx], expected: expectedLabels[ahead], index: userIdx });
          userIdx++;
          expIdx = ahead + 1;
          found = true;
          break;
        }
      }

      if (!found) {
        // Try to find expected item further in user sequence
        let foundInUser = false;
        for (let uAhead = userIdx + 1; uAhead < userSeq.length && uAhead < userIdx + 5; uAhead++) {
          const uAheadItem = userSeq[uAhead].toLowerCase().trim();
          if (expItem.includes(uAheadItem) || uAheadItem.includes(expItem) || fuzzyMatch(uAheadItem, expItem)) {
            // User has extra steps
            for (let skip = userIdx; skip < uAhead; skip++) {
              divergences.push({
                index: skip,
                type: 'unexpected_step',
                got: userSeq[skip],
                explanation: `"${userSeq[skip]}" is not expected at position ${skip + 1} in the sequence.`,
              });
            }
            matched.push({ user: userSeq[uAhead], expected: expectedLabels[expIdx], index: uAhead });
            userIdx = uAhead + 1;
            expIdx++;
            foundInUser = true;
            break;
          }
        }

        if (!foundInUser) {
          // True divergence
          divergences.push({
            index: userIdx,
            type: 'wrong_step',
            expected: expectedLabels[expIdx],
            got: userSeq[userIdx],
            explanation: `Expected "${expectedLabels[expIdx]}" but got "${userSeq[userIdx]}" at position ${userIdx + 1}.`,
          });
          userIdx++;
          expIdx++;
        }
      }
    }
  }

  // Handle remaining user items
  while (userIdx < userSeq.length) {
    divergences.push({
      index: userIdx,
      type: 'extra_step',
      got: userSeq[userIdx],
      explanation: `"${userSeq[userIdx]}" at position ${userIdx + 1} is beyond the expected sequence length.`,
    });
    userIdx++;
  }

  // Handle remaining expected items
  while (expIdx < expectedLabels.length) {
    divergences.push({
      index: userSeq.length,
      type: 'missing_step',
      expected: expectedLabels[expIdx],
      explanation: `Expected "${expectedLabels[expIdx]}" but the provided sequence ended.`,
    });
    expIdx++;
  }

  const isMatch = divergences.length === 0;

  const result = {
    match: isMatch,
    expected_sequence: expectedLabels,
  };

  if (!isMatch && divergences.length > 0) {
    const first = divergences[0];
    result.divergence_point = {
      index: first.index,
      expected: first.expected || null,
      got: first.got || null,
      explanation: first.explanation,
    };
  }

  const suggestions = [];
  if (divergences.some(d => d.type === 'missing_step')) {
    const missing = divergences.filter(d => d.type === 'missing_step').map(d => d.expected);
    suggestions.push(`Missing steps in your sequence: ${missing.join(', ')}`);
  }
  if (divergences.some(d => d.type === 'extra_step')) {
    suggestions.push('Your sequence contains extra steps beyond what the reference scenario expects.');
  }
  if (divergences.some(d => d.type === 'wrong_step')) {
    suggestions.push('Some operations in your sequence do not match the expected protocol exchange. Check the expected_sequence for the correct order.');
  }
  result.suggestions = suggestions;

  return result;
}

/**
 * Simple fuzzy match: check if two strings share enough tokens.
 */
function fuzzyMatch(a, b) {
  const tokensA = a.toLowerCase().split(/[\s,_\-/]+/).filter(Boolean);
  const tokensB = b.toLowerCase().split(/[\s,_\-/]+/).filter(Boolean);

  let matchCount = 0;
  for (const ta of tokensA) {
    for (const tb of tokensB) {
      if (ta === tb || ta.includes(tb) || tb.includes(ta)) {
        matchCount++;
        break;
      }
    }
  }

  // At least half of the shorter token list should match
  const minLen = Math.min(tokensA.length, tokensB.length);
  return minLen > 0 && matchCount >= Math.ceil(minLen * 0.5);
}

// --- Shared Schemas ---

const flowFilterSchema = z.object({
  sni: z.string().optional().describe('Filter by TLS SNI hostname (substring, case-insensitive)'),
  dst_host: z.string().optional().describe('Filter by destination/server IP (exact or substring)'),
  dst_port: z.number().optional().describe('Filter by destination/server port (exact match)'),
  server_name: z.string().optional().describe('Filter by server name — matches SNI or DNS-resolved name (substring, case-insensitive)'),
  protocol: z.string().optional().describe('Filter by protocol (substring, case-insensitive, e.g. "TCP", "UDP", "RoCE")'),
}).optional().describe('Filter to select specific network flows. All provided fields are ANDed together.');

// --- MCP Server ---

const server = new McpServer({
  name: 'protoviz',
  version: '0.2.0',
});

// ═══════════════════════════════════════════════════════════════
// Existing Tools (unchanged)
// ═══════════════════════════════════════════════════════════════

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

// Tool: get_expected_sequence (enhanced — now supports protocol-based lookup without slug)
server.tool(
  'get_expected_sequence',
  'Get the expected packet/operation sequence for a protocol operation. Supports lookup by scenario slug or by protocol name. Useful for building protocol implementations or validating captures.',
  {
    slug: z.string().optional().describe('Scenario slug (e.g., "roce-v2-rc-connection-rdma-write-read"). If omitted, provide protocol instead.'),
    protocol: z.string().optional().describe('Protocol name to search for (e.g., "RoCEv2", "TCP", "iSCSI", "NVMe-oF/RDMA"). Used when slug is not provided.'),
    operation: z.string().optional().describe('Filter by operation type (e.g., "RDMA Write", "handshake", "login", "CM", "ARP")'),
  },
  async ({ slug, protocol, operation }) => {
    try {
      let scenarioSlugs = [];

      if (slug) {
        scenarioSlugs = [slug];
      } else if (protocol) {
        scenarioSlugs = findScenariosForProtocol(protocol);
        if (scenarioSlugs.length === 0) {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              error: `No scenarios found for protocol "${protocol}".`,
              available_protocols: loadManifest().scenarios.map(s => s.protocol),
              suggestion: 'Use list_protocols to see all available scenarios and their slugs.',
            }, null, 2) }],
          };
        }
      } else {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            error: 'Either slug or protocol must be provided.',
            suggestion: 'Provide a scenario slug or a protocol name like "TCP", "RoCEv2", "iSCSI".',
          }, null, 2) }],
        };
      }

      const results = [];

      for (const s of scenarioSlugs) {
        try {
          const scenario = loadScenario(s);
          const steps = extractSequence(scenario, operation);

          if (steps.length > 0) {
            results.push({
              scenario_slug: s,
              scenario_title: scenario.meta.title,
              protocol: scenario.meta.protocol,
              operation: operation || 'full',
              sequence: steps.map(st => st.label),
              detailed_steps: steps.map((st, i) => ({
                step: i + 1,
                label: st.label,
                annotation: st.annotation,
                frame_id: st.frame_id,
              })),
            });
          }
        } catch (e) {
          // Skip scenarios that fail to load
        }
      }

      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            error: `No matching sequence found${operation ? ` for operation "${operation}"` : ''}.`,
            searched_scenarios: scenarioSlugs,
            suggestion: 'Try a broader operation filter, or omit it to see the full scenario sequence.',
          }, null, 2) }],
        };
      }

      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          error: err.message,
          suggestion: 'Use list_protocols to see available scenarios.',
        }, null, 2) }],
        isError: true,
      };
    }
  }
);

// Tool: generate_scenario
server.tool(
  'generate_scenario',
  'Generate a ProtoViz scenario from packet capture data. Accepts base64-encoded PCAP/pcapng or tshark JSON string. Returns a YAML scenario that can be loaded by the ProtoViz viewer. Use the optional filter parameter to select specific network flows (e.g., only HTTPS traffic to a particular server).',
  {
    input_format: z.enum(['pcap_base64', 'tshark_json']).describe('Format of the input data'),
    data: z.string().describe('Base64-encoded PCAP file or tshark JSON string'),
    title: z.string().optional().describe('Custom title for the scenario'),
    scrub: z.boolean().optional().default(true).describe('Anonymize IPs, MACs, and strip payload data'),
    max_packets: z.number().optional().default(500).describe('Maximum packets to process'),
    filter: flowFilterSchema,
  },
  async ({ input_format, data, title, scrub, max_packets, filter }) => {
    try {
      const yamlStr = convertToScenarioYaml({ input_format, data, title, scrub, max_packets, filter });
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
          text: JSON.stringify({
            error: `Error generating scenario: ${err.message}`,
            suggestion: 'Ensure your data is valid base64-encoded PCAP or valid tshark JSON (tshark -T json output).',
          }, null, 2),
        }],
        isError: true,
      };
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// New Agent-Focused Tools
// ═══════════════════════════════════════════════════════════════

// Tool: analyze_capture
server.tool(
  'analyze_capture',
  'Analyze a packet capture for protocol violations, anomalies, and compliance issues. Returns structured findings with severity, packet references, and spec citations. Use the optional filter parameter to focus analysis on specific network flows.',
  {
    input_format: z.enum(['pcap_base64', 'tshark_json']).describe('Format of the input data'),
    data: z.string().describe('Base64-encoded PCAP file or tshark JSON string'),
    max_packets: z.number().optional().default(500).describe('Maximum packets to process'),
    filter: flowFilterSchema,
  },
  async ({ input_format, data, max_packets, filter }) => {
    try {
      // 1. Parse packets (reuse pcapToScenario parsing, with optional flow filtering)
      const parsed = parseCapture({ input_format, data, max_packets, filter });

      // 2. Run full analysis pipeline (rule engine + built-in checks)
      const result = analyzePackets(parsed.packets);

      // 3. Return structured JSON
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Analysis failed: ${err.message}`,
            suggestion: input_format === 'pcap_base64'
              ? 'Ensure the data is a valid base64-encoded PCAP or pcapng file. Only Ethernet link type is supported.'
              : 'Ensure the data is valid tshark JSON output (tshark -T json). It should be a JSON array of packet objects.',
          }, null, 2),
        }],
        isError: true,
      };
    }
  }
);

// Tool: list_flows
server.tool(
  'list_flows',
  'List detected network flows/conversations in a packet capture. Returns flow summaries with server names (from TLS SNI and DNS), protocols, packet counts, and byte totals. Use this before generate_scenario to understand what is in a capture and select relevant flows for filtering.',
  {
    input_format: z.enum(['pcap_base64', 'tshark_json']).describe('Format of the input data'),
    data: z.string().describe('Base64-encoded PCAP file or tshark JSON string'),
    max_packets: z.number().optional().default(500).describe('Maximum packets to process'),
  },
  async ({ input_format, data, max_packets }) => {
    try {
      const parsed = parseCapture({ input_format, data, max_packets });
      const { flows, dnsNameMap } = groupFlows(parsed.packets);

      // Convert dnsNameMap to a plain object for JSON serialization
      const dnsEntries = {};
      for (const [ip, name] of dnsNameMap) {
        dnsEntries[ip] = name;
      }

      const result = {
        flow_count: flows.length,
        packet_count: parsed.packets.length,
        dns_mappings: dnsEntries,
        flows: flows.map(f => ({
          id: f.id,
          protocol: f.protocol,
          server_name: f.serverName,
          server_ip: f.serverIp,
          server_port: f.serverPort,
          client_ip: f.clientIp,
          client_port: f.clientPort,
          packet_count: f.packetCount,
          bytes: f.bytes,
          duration_ms: f.durationMs,
          has_tls: f.hasTLS,
          has_dns: f.hasDNS,
        })),
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Flow listing failed: ${err.message}`,
            suggestion: input_format === 'pcap_base64'
              ? 'Ensure the data is a valid base64-encoded PCAP or pcapng file. Only Ethernet link type is supported.'
              : 'Ensure the data is valid tshark JSON output (tshark -T json). It should be a JSON array of packet objects.',
          }, null, 2),
        }],
        isError: true,
      };
    }
  }
);

// Tool: explain_packet
server.tool(
  'explain_packet',
  'Dissect a single packet from raw hex bytes. Returns a structured breakdown of every header field with descriptions and spec references.',
  {
    hex: z.string().describe('Hex string of packet bytes (e.g., "ffffffffffff001122334455080600010800...")'),
    offset: z.number().optional().default(0).describe('Byte offset to start dissection (0 = Ethernet header)'),
  },
  async ({ hex, offset }) => {
    try {
      // Validate and convert hex string
      const cleanHex = hex.replace(/[\s\-:]/g, '');
      if (!/^[0-9a-fA-F]*$/.test(cleanHex)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            error: 'Invalid hex string. Only hexadecimal characters (0-9, a-f, A-F) are allowed. Spaces, dashes, and colons are stripped automatically.',
            suggestion: 'Provide raw hex bytes, e.g., "ffffffffffff0011223344550806..." (no 0x prefix needed).',
          }, null, 2) }],
          isError: true,
        };
      }

      if (cleanHex.length < 2) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            error: 'Hex string too short. Need at least 14 bytes (28 hex chars) for an Ethernet header.',
            suggestion: 'Provide the full packet bytes starting from the Ethernet header.',
          }, null, 2) }],
          isError: true,
        };
      }

      // Convert to Uint8Array
      const bytes = new Uint8Array(cleanHex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
      }

      // Dissect
      const result = dissectPacketDetailed(bytes, offset);

      // Add metadata
      const output = {
        total_bytes: bytes.length,
        offset_start: offset,
        summary: result.summary,
        layers: result.layers,
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(output, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Dissection failed: ${err.message}`,
            suggestion: 'Ensure the hex string represents a valid Ethernet frame. Start from the destination MAC address.',
          }, null, 2),
        }],
        isError: true,
      };
    }
  }
);

// Tool: validate_sequence
server.tool(
  'validate_sequence',
  'Validate a sequence of protocol operations against known correct patterns from the ProtoViz scenario library. Returns whether the sequence matches, where it diverges, and what the expected sequence should be.',
  {
    protocol: z.string().describe('Protocol to validate against (e.g., "RoCEv2", "TCP", "NVMe-oF/RDMA", "iSCSI", "TLS 1.3")'),
    operation: z.string().optional().describe('Specific operation (e.g., "connection_setup", "data_transfer", "teardown", "handshake", "full")'),
    sequence: z.array(z.string()).describe('The sequence of operations/opcodes to validate (e.g., ["SYN", "SYN-ACK", "ACK", "PSH-ACK", "FIN"])'),
  },
  async ({ protocol, operation, sequence }) => {
    try {
      // 1. Find matching scenario(s) from the scenario library
      const slugs = findScenariosForProtocol(protocol);

      if (slugs.length === 0) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            match: false,
            error: `No reference scenarios found for protocol "${protocol}".`,
            available_protocols: loadManifest().scenarios.map(s => s.protocol),
            suggestions: ['Check available protocols using list_protocols.', 'Try a different protocol name or use tags like "RDMA", "TCP/IP", "SAN".'],
          }, null, 2) }],
        };
      }

      // 2. Try each matching scenario to find the best comparison
      let bestResult = null;
      let bestSlug = null;
      let bestMatchCount = -1;

      for (const slug of slugs) {
        try {
          const scenario = loadScenario(slug);
          const expectedSteps = extractSequence(scenario, operation);

          if (expectedSteps.length === 0) continue;

          const comparison = compareSequences(sequence, expectedSteps);

          // Count how many items matched
          const matchedCount = comparison.match
            ? sequence.length
            : (comparison.divergence_point?.index || 0);

          if (matchedCount > bestMatchCount || (matchedCount === bestMatchCount && comparison.match)) {
            bestResult = comparison;
            bestSlug = slug;
            bestMatchCount = matchedCount;
          }
        } catch (e) {
          // Skip scenarios that fail
        }
      }

      if (!bestResult) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            match: false,
            error: `Could not extract a comparable sequence from any matching scenario${operation ? ` for operation "${operation}"` : ''}.`,
            searched_scenarios: slugs,
            suggestions: [
              'Try omitting the operation parameter to compare against the full scenario.',
              'Use get_expected_sequence to see what sequences are available.',
            ],
          }, null, 2) }],
        };
      }

      // 3. Return comparison result
      const output = {
        ...bestResult,
        reference_scenario: bestSlug,
        your_sequence: sequence,
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(output, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Validation failed: ${err.message}`,
            suggestion: 'Use list_protocols to see available scenarios and their protocols.',
          }, null, 2),
        }],
        isError: true,
      };
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// Resource
// ═══════════════════════════════════════════════════════════════

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
