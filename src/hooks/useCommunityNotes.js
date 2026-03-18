import { useState, useEffect, useRef, useCallback } from 'react';

const REPO_OWNER = 'provandal';
const REPO_NAME = 'protoviz';
const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/discussions`;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// In-memory cache shared across all hook instances
const cache = {};

/**
 * Parse community note metadata tags from discussion/comment body.
 * Supports:
 *   <!-- protoviz:scenario=SLUG:step=STEP_NUM -->
 *   <!-- protoviz:scenario=SLUG:step=STEP_NUM:field=FIELD_ABBREV -->
 *
 * Returns array of { step, field? } for matching scenario slug.
 */
function parseMetadataTags(body, scenarioSlug) {
  const results = [];
  if (!body) return results;
  const regex = /<!--\s*protoviz:scenario=([^:]+):step=(\d+)(?::field=([^\s>]+))?\s*-->/g;
  let match;
  while ((match = regex.exec(body)) !== null) {
    if (match[1] === scenarioSlug) {
      results.push({
        step: parseInt(match[2], 10),
        field: match[3] || null,
      });
    }
  }
  return results;
}

/**
 * Extract the note text from a discussion body.
 * Strips out metadata comments and leading/trailing whitespace.
 */
function extractNoteText(body) {
  if (!body) return '';
  return body
    .replace(/<!--\s*protoviz:[^>]*-->/g, '')
    .trim();
}

/**
 * Hook to fetch and cache community notes from GitHub Discussions.
 *
 * @param {string} scenarioSlug - The current scenario slug
 * @returns {{ notesByStep: Object, loading: boolean, error: string|null, stepsWithNotes: Set }}
 */
export default function useCommunityNotes(scenarioSlug) {
  const [notesByStep, setNotesByStep] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!scenarioSlug) {
      setNotesByStep({});
      return;
    }

    const cacheKey = scenarioSlug;

    // Check cache first
    if (cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < CACHE_TTL) {
      setNotesByStep(cache[cacheKey].notesByStep);
      setLoading(false);
      setError(null);
      return;
    }

    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    fetchCommunityNotes(scenarioSlug, controller.signal)
      .then(notes => {
        if (!controller.signal.aborted) {
          cache[cacheKey] = { notesByStep: notes, timestamp: Date.now() };
          setNotesByStep(notes);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          // If the API is unavailable (auth required, rate limited, etc.),
          // fall back to static JSON
          fetchStaticNotes(scenarioSlug)
            .then(notes => {
              if (!controller.signal.aborted) {
                cache[cacheKey] = { notesByStep: notes, timestamp: Date.now() };
                setNotesByStep(notes);
                setLoading(false);
              }
            })
            .catch(() => {
              if (!controller.signal.aborted) {
                setNotesByStep({});
                setError(null); // Silently fail -- no community notes yet
                setLoading(false);
              }
            });
        }
      });

    return () => controller.abort();
  }, [scenarioSlug]);

  // Set of step indices that have community notes
  const stepsWithNotes = new Set(
    Object.keys(notesByStep).map(Number).filter(k => notesByStep[k]?.length > 0)
  );

  const getNotesForStep = useCallback((stepIdx) => {
    return notesByStep[stepIdx] || [];
  }, [notesByStep]);

  return { notesByStep, loading, error, stepsWithNotes, getNotesForStep };
}

/**
 * Fetch community notes from GitHub REST API (unauthenticated, 60 req/hr).
 */
async function fetchCommunityNotes(scenarioSlug, signal) {
  const res = await fetch(`${API_BASE}?per_page=100`, { signal });

  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}`);
  }

  const discussions = await res.json();
  if (!Array.isArray(discussions)) {
    throw new Error('Unexpected response format');
  }

  return parseDiscussions(discussions, scenarioSlug);
}

/**
 * Fallback: fetch curated notes from static JSON in the repo.
 */
async function fetchStaticNotes(scenarioSlug) {
  const base = import.meta.env.BASE_URL || '/';
  const url = `${base}community-notes/${scenarioSlug}.json`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Static notes not found for ${scenarioSlug}`);
  }

  const data = await res.json();
  // Expected format: { notes: [{ step, author, date, text, url?, field? }] }
  if (!data?.notes) return {};

  const notesByStep = {};
  for (const note of data.notes) {
    const step = note.step;
    if (!notesByStep[step]) notesByStep[step] = [];
    notesByStep[step].push(note);
  }
  return notesByStep;
}

/**
 * Parse discussions array into notesByStep map.
 */
function parseDiscussions(discussions, scenarioSlug) {
  const notesByStep = {};

  for (const disc of discussions) {
    const tags = parseMetadataTags(disc.body, scenarioSlug);
    if (tags.length === 0) continue;

    const noteText = extractNoteText(disc.body);
    if (!noteText) continue;

    for (const tag of tags) {
      const step = tag.step;
      if (!notesByStep[step]) notesByStep[step] = [];
      notesByStep[step].push({
        step,
        field: tag.field,
        author: disc.user?.login || 'unknown',
        avatarUrl: disc.user?.avatar_url || null,
        date: disc.created_at,
        text: noteText,
        url: disc.html_url,
        title: disc.title,
      });
    }
  }

  return notesByStep;
}

/**
 * Build a GitHub Discussions URL pre-filled with the metadata tag.
 */
export function buildDiscussionUrl(scenarioSlug, stepIndex, scenarioTitle) {
  const tag = `<!-- protoviz:scenario=${scenarioSlug}:step=${stepIndex} -->`;
  const title = encodeURIComponent(`[Community Note] ${scenarioTitle || scenarioSlug} - Step ${stepIndex + 1}`);
  const body = encodeURIComponent(`${tag}\n\n<!-- Write your note below this line -->\n\n`);
  return `https://github.com/${REPO_OWNER}/${REPO_NAME}/discussions/new?category=general&title=${title}&body=${body}`;
}
