import type { Thread } from '../types';

/** Dev: relative path (dev server proxy). Prod: set SUMMARIZE_API_URL at build time to your worker/backend URL. */
const SUMMARIZE_API = process.env.SUMMARIZE_API_URL || '/api/discussions-summarize';

const SUMMARY_CACHE_KEY = 'hale_commenting_summary_cache_v1';

interface CachedSummary {
  signature: string;
  title: string;
  content: string;
}

function getCache(): { list: Record<string, CachedSummary>; thread: Record<string, CachedSummary> } {
  try {
    const raw = localStorage.getItem(SUMMARY_CACHE_KEY);
    if (!raw) return { list: {}, thread: {} };
    return JSON.parse(raw);
  } catch {
    return { list: {}, thread: {} };
  }
}

function setCache(updater: (prev: { list: Record<string, CachedSummary>; thread: Record<string, CachedSummary> }) => void) {
  try {
    const prev = getCache();
    updater(prev);
    localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify(prev));
  } catch {
    // ignore
  }
}

/**
 * Signature for "all" or "thisPage" list summary: scope + sorted thread ids + per-thread comment count.
 * When this matches, we can show the cached summary instead of calling the API.
 */
export function threadsToSignature(threads: Thread[], scope: 'all' | 'thisPage'): string {
  const sorted = [...threads].sort((a, b) => a.id.localeCompare(b.id));
  const parts = sorted.map((t) => `${t.id}:${t.comments.length}`);
  return `${scope}:${parts.join(',')}`;
}

/**
 * Signature for a single-thread summary: thread id + comment count (and optional last activity).
 */
export function threadSignature(thread: Thread): string {
  const last = thread.comments.length > 0 ? thread.comments[thread.comments.length - 1].createdAt : '';
  return `thread:${thread.id}:${thread.comments.length}:${last}`;
}

export function getCachedSummary(scope: 'all' | 'thisPage', signature: string): { title: string; content: string } | null {
  const cache = getCache();
  const entry = cache.list[scope];
  if (!entry || entry.signature !== signature) return null;
  return { title: entry.title, content: entry.content };
}

export function setCachedSummary(scope: 'all' | 'thisPage', signature: string, title: string, content: string): void {
  setCache((prev) => {
    prev.list[scope] = { signature, title, content };
  });
}

export function getCachedSummaryForThread(
  threadId: string,
  signature: string,
): { title: string; content: string } | null {
  const cache = getCache();
  const entry = cache.thread[threadId];
  if (!entry || entry.signature !== signature) return null;
  return { title: entry.title, content: entry.content };
}

export function setCachedSummaryForThread(
  threadId: string,
  signature: string,
  title: string,
  content: string,
): void {
  setCache((prev) => {
    prev.thread[threadId] = { signature, title, content };
  });
}

/**
 * Builds a text block from a single thread for the summarization prompt.
 */
export function buildThreadBlock(thread: Thread): string {
  const lines: string[] = [];
  const location = thread.route + (thread.elementDescription ? ` — ${thread.elementDescription}` : '');
  lines.push(`[Thread: ${location}]`);
  for (const c of thread.comments) {
    const author = c.author || 'Anonymous';
    const date = c.createdAt ? new Date(c.createdAt).toLocaleString() : '';
    lines.push(`  ${author} (${date}): ${c.text}`);
  }
  return lines.join('\n');
}

/**
 * Builds the full prompt for summarizing multiple threads (global or this page).
 */
export function buildPromptForThreads(threads: Thread[], scope: 'all' | 'thisPage'): string {
  const scopeNote =
    scope === 'all'
      ? 'Summarize the following design feedback discussions from across the prototype.'
      : 'Summarize the following design feedback discussions on this page.';
  const blocks = threads.map(buildThreadBlock).join('\n\n');
  return (
    `${scopeNote} Focus on main topics and outcomes. Do not list component paths, CSS selectors, or technical identifiers in the summary. End with 1-3 sentences overall. Reply with only the summary, no preamble.\n\n` +
    `---\n\n${blocks}`
  );
}

/**
 * Builds the full prompt for summarizing a single thread.
 */
export function buildPromptForThread(thread: Thread): string {
  const block = buildThreadBlock(thread);
  return (
    'Summarize this design feedback thread in 2-4 sentences. Include the main topic and key points raised. Do not include component paths or technical identifiers. Reply with only the summary, no preamble.\n\n' +
    `---\n\n${block}`
  );
}

/**
 * Calls the summarization API (proxy when configured). Returns summary text or a fallback message.
 */
export async function fetchSummary(prompt: string): Promise<string> {
  try {
    const res = await fetch(SUMMARIZE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && typeof data.summary === 'string') {
      return data.summary.trim() || 'No summary generated.';
    }
    const errMsg =
      res.status === 404
        ? 'Summarization is not configured for this deployment. Set SUMMARIZE_API_URL when building for production (see README).'
        : typeof data.error === 'string'
          ? data.error
          : `${res.statusText || 'Request failed'} (${res.status})`;
    const userMessage = `Summarization unavailable: ${errMsg}`;
    console.error('[Summarize] Request failed:', {
      status: res.status,
      statusText: res.statusText,
      url: SUMMARIZE_API,
      body: data,
    });
    return userMessage;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    console.error('[Summarize] Error:', err);
    return `Summarization unavailable: ${message}`;
  }
}
