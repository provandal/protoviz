/**
 * Detect whether text content looks like tcpdump text output.
 * Returns true if the text matches common tcpdump line patterns.
 */
export function detectTcpdumpText(text) {
  const lines = text.split('\n').slice(0, 20).filter(l => l.trim());
  if (lines.length === 0) return false;

  // Common tcpdump timestamp + protocol patterns
  const tcpdumpPatterns = [
    /^\d{2}:\d{2}:\d{2}\.\d+\s+IP6?\s/,           // HH:MM:SS.us IP ...
    /^\d{2}:\d{2}:\d{2}\.\d+\s+ARP/,               // HH:MM:SS.us ARP ...
    /^\d{2}:\d{2}:\d{2}\.\d+\s+[0-9a-f]{2}:/,      // HH:MM:SS.us with -e (ethernet)
    /^\d+\.\d+\s+IP6?\s/,                           // epoch.us IP ... (-tt flag)
    /Flags\s*\[/,                                    // TCP Flags [S], [S.], [P.], etc.
    /\bseq\s+\d+/,                                  // seq 1234567
    /\back\s+\d+/,                                  // ack 1234567
    /\bwin\s+\d+/,                                  // win 65535
    /\blength\s+\d+/,                               // length 0
  ];

  let matchCount = 0;
  for (const line of lines) {
    if (tcpdumpPatterns.some(p => p.test(line))) matchCount++;
  }

  // If at least 30% of sampled lines match, it's likely tcpdump output
  return matchCount >= Math.max(1, lines.length * 0.3);
}
