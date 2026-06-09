import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  buildPromptForThread,
  buildPromptForThreads,
  buildThreadBlock,
  fetchSummary,
  threadSignature,
  threadsToSignature,
} from './summarizeService';
import type { Thread } from '../types';

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 't1',
    route: '/foo',
    elementDescription: 'Hero',
    xPercent: 10,
    yPercent: 20,
    comments: [
      { id: 'c1', author: 'A', text: 'Hello', createdAt: '2026-01-01T12:00:00.000Z' },
    ],
    ...overrides,
  };
}

describe('summarizeService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('threadsToSignature is stable for ordering and counts', () => {
    const a = makeThread({ id: 'a', comments: [{ id: '1', text: 'x', createdAt: '2026-01-01T00:00:00.000Z' }] });
    const b = makeThread({ id: 'b', comments: [] });
    expect(threadsToSignature([b, a], 'all')).toBe(threadsToSignature([a, b], 'all'));
    expect(threadsToSignature([a, b], 'thisPage')).toContain('thisPage:');
  });

  it('threadSignature changes when last comment timestamp changes', () => {
    const t = makeThread();
    const s1 = threadSignature(t);
    const t2 = {
      ...t,
      comments: [...t.comments, { id: 'c2', author: 'B', text: 'Reply', createdAt: '2026-01-02T12:00:00.000Z' }],
    };
    expect(threadSignature(t2)).not.toBe(s1);
  });

  it('buildThreadBlock includes route and comments', () => {
    const block = buildThreadBlock(makeThread());
    expect(block).toContain('/foo');
    expect(block).toContain('Hero');
    expect(block).toContain('Hello');
  });

  it('buildPromptForThreads includes scope wording', () => {
    const p = buildPromptForThreads([makeThread()], 'all');
    expect(p).toContain('across the prototype');
    const p2 = buildPromptForThreads([makeThread()], 'thisPage');
    expect(p2).toContain('on this page');
  });

  it('buildPromptForThread asks for a short summary', () => {
    const p = buildPromptForThread(makeThread());
    expect(p).toContain('2-4 sentences');
  });

  it('fetchSummary returns summary on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ summary: '  Done.  ' }),
      }),
    );
    const out = await fetchSummary('prompt');
    expect(out).toBe('Done.');
  });

  it('fetchSummary maps 404 to configuration hint', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({}),
      }),
    );
    const out = await fetchSummary('x');
    expect(out).toContain('SUMMARIZE_API_URL');
    errSpy.mockRestore();
  });
});
