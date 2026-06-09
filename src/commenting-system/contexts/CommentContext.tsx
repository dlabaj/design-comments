import * as React from 'react';
import { Comment, ComponentMetadata, Thread } from '../types';
import { getStoredUser, githubAdapter, isGitHubConfigured } from '../services/githubAdapter';

interface CommentContextType {
  threads: Thread[];
  commentsEnabled: boolean;
  setCommentsEnabled: (enabled: boolean) => void;
  showPinsEnabled: boolean;
  setShowPinsEnabled: (enabled: boolean) => void;
  drawerPinnedOpen: boolean;
  setDrawerPinnedOpen: (open: boolean) => void;
  floatingWidgetMode: boolean;
  setFloatingWidgetMode: (mode: boolean) => void;
  addThread: (cssSelector: string, elementDescription: string, componentMetadata: ComponentMetadata | null, xPercent: number, yPercent: number, route: string, version?: string) => string;
  addReply: (threadId: string, text: string, parentCommentId?: string) => void;
  syncFromGitHub: (route: string, version?: string) => Promise<void>;
  retrySync: () => Promise<void>;
  isSyncing: boolean;
  hasPendingSync: boolean;
  updateComment: (threadId: string, commentId: string, text: string) => void;
  deleteComment: (threadId: string, commentId: string) => void;
  closeThread: (threadId: string) => void;
  reopenThread: (threadId: string) => void;
  removePin: (threadId: string) => void;
  getThreadsForRoute: (route: string, version?: string) => Thread[];
  selectedThreadId: string | null;
  setSelectedThreadId: (threadId: string | null) => void;
}

const CommentContext = React.createContext<CommentContextType | undefined>(undefined);

export const CommentProvider: React.FunctionComponent<{ children: React.ReactNode }> = ({ children }) => {
  const stripHaleReplyMarkers = (body: string): string => {
    // Remove hidden markers we embed for threading reconstruction
    return body
      .replace(/<!--\s*hale-reply-to:\d+\s*-->\s*\n?/g, '')
      .replace(/<!--\s*hale-reply-to-local\s*-->\s*\n?/g, '')
      .trimEnd();
  };

  const buildGitHubReplyBody = (text: string, parent?: { githubCommentId?: number; author?: string; text?: string }) => {
    if (!parent) return text;
    if (!parent.githubCommentId) {
      // We can still preserve local threading, but GitHub can't link to a parent comment id we don't have.
      return `${text}\n\n<!-- hale-reply-to-local -->`;
    }

    // Hidden marker so we can reconstruct threading on sync
    const marker = `<!-- hale-reply-to:${parent.githubCommentId} -->`;

    // Light GitHub-like quoting (keeps context without needing true threading)
    const quoted = parent.text
      ? parent.text
          .split('\n')
          .slice(0, 6)
          .map((l) => `> ${l}`)
          .join('\n')
      : '';

    const header = parent.author ? `> Replying to @${parent.author}` : `> Replying to comment`;

    return [marker, header, quoted, '', text].filter(Boolean).join('\n');
  };

  const parseReplyParentFromGitHubBody = (body: string | undefined): number | undefined => {
    if (!body) return undefined;
    const m = body.match(/<!--\s*hale-reply-to:(\d+)\s*-->/);
    if (!m?.[1]) return undefined;
    const id = Number(m[1]);
    return Number.isNaN(id) ? undefined : id;
  };

  const inferReplyParentFromQuote = (body: string, candidates: Array<{ githubCommentId?: number; text: string }>) => {
    // GitHub "Quote reply" is flat; it includes a quoted block but no parent id.
    // Heuristic: extract the leading quoted block and find the best-matching prior comment text.
    const cleaned = stripHaleReplyMarkers(body);
    const lines = cleaned.split('\n');

    const quotedLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed.startsWith('>')) {
        quotedLines.push(trimmed.replace(/^>\s?/, ''));
        continue;
      }
      if (quotedLines.length === 0 && trimmed === '') continue;
      break;
    }

    const snippet = quotedLines.join('\n').trim();
    if (snippet.length < 12) return undefined;

    let best: { id: number; score: number } | undefined;
    for (const c of candidates) {
      if (!c.githubCommentId) continue;
      const hay = (c.text || '').toLowerCase();
      const needle = snippet.toLowerCase();
      const idx = hay.indexOf(needle);
      if (idx === -1) continue;
      const score = needle.length;
      if (!best || score > best.score) best = { id: c.githubCommentId, score };
    }
    return best?.id;
  };
  const STORAGE_KEY = 'hale_comment_threads_v1';
  const COMMENTS_ENABLED_KEY = 'hale_comments_enabled_v1';
  const SHOW_PINS_ENABLED_KEY = 'hale_show_pins_enabled_v1';
  const DRAWER_PINNED_OPEN_KEY = 'hale_drawer_pinned_open_v1';
  const FLOATING_WIDGET_MODE_KEY = 'hale_floating_widget_mode_v1';
  const HIDDEN_ISSUES_KEY = 'hale_hidden_issue_numbers_v1';
  const PENDING_CLOSE_ISSUES_KEY = 'hale_pending_close_issue_numbers_v1';

  const readNumberSet = (key: string): Set<number> => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.map((n) => Number(n)).filter((n) => !Number.isNaN(n)));
    } catch {
      return new Set();
    }
  };

  const writeNumberSet = (key: string, set: Set<number>) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(Array.from(set)));
    } catch {
      // ignore
    }
  };

  const hiddenIssueNumbersRef = React.useRef<Set<number>>(new Set());
  const pendingCloseIssueNumbersRef = React.useRef<Set<number>>(new Set());
  const removedThreadIdsRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    hiddenIssueNumbersRef.current = readNumberSet(HIDDEN_ISSUES_KEY);
    pendingCloseIssueNumbersRef.current = readNumberSet(PENDING_CLOSE_ISSUES_KEY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadThreads = (): Thread[] => {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed as Thread[];
    } catch {
      return [];
    }
  };

  const [threads, setThreads] = React.useState<Thread[]>(() => loadThreads());
  const [commentsEnabled, setCommentsEnabledState] = React.useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(COMMENTS_ENABLED_KEY);
      // If explicitly set in localStorage, use that value
      if (raw !== null) {
        return raw === 'true';
      }
      // If not set, default to enabled when GitHub is not configured (standalone mode)
      // This allows the commenting system to work without GitHub/Jira integration
      return !isGitHubConfigured();
    } catch {
      // On error, default to enabled if GitHub is not configured
      return !isGitHubConfigured();
    }
  });
  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(null);
  const [drawerPinnedOpen, setDrawerPinnedOpen] = React.useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(DRAWER_PINNED_OPEN_KEY);
      // If explicitly set in localStorage, use that value
      if (raw !== null) {
        return raw === 'true';
      }
      // If not set, default to open when GitHub is not configured (standalone mode)
      // This makes the commenting system visible immediately
      return !isGitHubConfigured();
    } catch {
      // On error, default to open if GitHub is not configured
      return !isGitHubConfigured();
    }
  });
  const [floatingWidgetMode, setFloatingWidgetMode] = React.useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(FLOATING_WIDGET_MODE_KEY);
      return raw === 'true';
    } catch {
      return false;
    }
  });
  const [showPinsEnabled, setShowPinsEnabled] = React.useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(SHOW_PINS_ENABLED_KEY);
      return raw === 'true';
    } catch {
      return false;
    }
  });

  /** Turning comments on should show pins so existing threads stay visible while commenting. */
  const setCommentsEnabled = React.useCallback((enabled: boolean) => {
    setCommentsEnabledState(enabled);
    if (enabled) {
      setShowPinsEnabled(true);
    }
  }, []);
  const [syncInFlightCount, setSyncInFlightCount] = React.useState(0);
  const isSyncing = syncInFlightCount > 0;
  const syncInFlightByKey = React.useRef<Map<string, Promise<void>>>(new Map());
  const threadsRef = React.useRef<Thread[]>([]);

  React.useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  // Persist threads so refreshes don't wipe pins/comments.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      // Filter out temporary threads before saving to localStorage
      const persistedThreads = threads.filter(t => !t.isTemporary);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedThreads));
    } catch {
      // ignore quota/serialization errors
    }
  }, [threads]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(COMMENTS_ENABLED_KEY, String(commentsEnabled));
    } catch {
      // ignore
    }
  }, [commentsEnabled]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(DRAWER_PINNED_OPEN_KEY, String(drawerPinnedOpen));
    } catch {
      // ignore
    }
  }, [drawerPinnedOpen]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(FLOATING_WIDGET_MODE_KEY, String(floatingWidgetMode));
    } catch {
      // ignore
    }
  }, [floatingWidgetMode]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(SHOW_PINS_ENABLED_KEY, String(showPinsEnabled));
    } catch {
      // ignore
    }
  }, [showPinsEnabled]);

  const addThread = (cssSelector: string, elementDescription: string, componentMetadata: ComponentMetadata | null, xPercent: number, yPercent: number, route: string, version?: string): string => {
    const threadId = `thread-${Date.now()}`;
    const isConfigured = isGitHubConfigured();

    console.log('📌 addThread called:', {
      threadId,
      route,
      version,
      cssSelector,
      elementDescription,
      xPercent: xPercent.toFixed(1),
      yPercent: yPercent.toFixed(1),
      isGitHubConfigured: isConfigured,
    });

    const newThread: Thread = {
      id: threadId,
      cssSelector,
      elementDescription,
      componentMetadata: componentMetadata || undefined,
      xPercent,
      yPercent,
      route,
      version,
      comments: [],
      provider: 'github',
      syncStatus: 'local',
      status: 'open',
      isTemporary: true, // Mark as temporary until first comment is added
    };
    setThreads((prev) => [...prev, newThread]);

    console.log(`📌 Thread created as temporary (will persist when first comment is added)`);

    // Don't sync to GitHub yet - wait for first comment
    // This prevents creating empty GitHub issues
    /* Commented out - only sync when comment is added
    if (isConfigured) {
      console.log(`🔵 Creating GitHub issue for thread ${threadId}...`);

      githubAdapter
        .createIssue({
          title: `Feedback: ${route}`,
          body: `Thread created from pin at (${xPercent.toFixed(1)}%, ${yPercent.toFixed(1)}%).`,
          route,
          xPercent,
          yPercent,
          version,
        })
        .then((result) => {
          console.log(`🔵 GitHub createIssue response:`, result);

          if (result.success) {
            console.log(`✅ Successfully created GitHub issue #${result.data?.number}`);
          } else {
            console.error(`❌ Failed to create GitHub issue:`, result.error);
          }

          // If the user removed the pin before issue creation completed, immediately close the issue and tombstone it.
          if (result.success && result.data?.number && removedThreadIdsRef.current.has(threadId)) {
            const num = result.data.number;
            hiddenIssueNumbersRef.current.add(num);
            writeNumberSet(HIDDEN_ISSUES_KEY, hiddenIssueNumbersRef.current);
            githubAdapter.closeIssue(num).catch(() => undefined);
            removedThreadIdsRef.current.delete(threadId);
          }

          setThreads((prev) =>
            prev.map((t) =>
              t.id === threadId
                ? {
                    ...t,
                    issueNumber: result.success ? result.data?.number : undefined,
                    issueUrl: result.success ? result.data?.html_url : undefined,
                    syncStatus: result.success ? 'synced' : 'error',
                    syncError: result.success ? undefined : result.error,
                  }
                : t,
            ),
          );

          console.log(`📌 Thread ${threadId} syncStatus updated to: ${result.success ? 'synced' : 'error'}`);
        })
        .catch((err) => {
          console.error(`❌ Exception during GitHub issue creation:`, err);

          setThreads((prev) =>
            prev.map((t) => (t.id === threadId ? { ...t, syncStatus: 'error', syncError: 'Failed to create issue' } : t)),
          );

          console.log(`📌 Thread ${threadId} syncStatus updated to: error (exception caught)`);
        });
    }
    */

    return threadId;
  };

  const parseMetadataFromIssueBody = (body: string): {
    cssSelector?: string;
    elementDescription?: string;
    xPercent: number;
    yPercent: number;
  } => {
    let cssSelector: string | undefined;
    let elementDescription: string | undefined;
    let xPercent = 0;
    let yPercent = 0;

    // Parse CSS Selector
    const selectorMatch = body.match(/CSS Selector:\s*`([^`]+)`/i);
    if (selectorMatch) {
      cssSelector = selectorMatch[1];
    }

    // Parse Target Component
    const componentMatch = body.match(/Target Component:\s*`([^`]+)`/i);
    if (componentMatch) {
      elementDescription = componentMatch[1];
    }

    // Parse Fallback Position (new format) or Coordinates (old format)
    const fallbackMatch = body.match(/Fallback Position:\s*`?\(([\d.]+)%?,\s*([\d.]+)%?\)`?/i);
    const coordMatch = body.match(/Coordinates:\s*`?\(([\d.]+)%?,\s*([\d.]+)%?\)`?/i);

    const match = fallbackMatch || coordMatch;
    if (match) {
      const x = Number(match[1]);
      const y = Number(match[2]);
      if (!Number.isNaN(x) && !Number.isNaN(y)) {
        xPercent = x;
        yPercent = y;
      }
    }

    return { cssSelector, elementDescription, xPercent, yPercent };
  };

  const syncFromGitHub = async (route: string, version?: string) => {
    if (!isGitHubConfigured()) return;

    const key = `${route}::${version ?? ''}`;
    const existing = syncInFlightByKey.current.get(key);
    if (existing) {
      console.log(`⏭️ Sync already in progress for ${key}, skipping`);
      return existing;
    }

    // Skip sync if there are threads actively syncing to prevent race conditions
    const activelySyncingThreads = threadsRef.current.filter(
      (t) => t.route === route && (t.version ?? '1') === (version ?? '1') && t.syncStatus === 'syncing'
    );
    if (activelySyncingThreads.length > 0) {
      console.log(`⏭️ Skipping sync for ${key} - ${activelySyncingThreads.length} thread(s) actively syncing:`, activelySyncingThreads.map(t => t.id));
      return;
    }

    console.log(`🔄 Starting sync for ${key}`);

    const run = (async () => {
      setSyncInFlightCount((c) => c + 1);
      try {
        const issuesResult = await githubAdapter.fetchIssuesForRouteAndVersion(route, version);
        if (!issuesResult.success || !issuesResult.data) return;

        const hidden = hiddenIssueNumbersRef.current;
        const issues = issuesResult.data.filter((i: { number?: number }) => {
          const num = i?.number as number | undefined;
          if (!num) return true;
          return !hidden.has(num);
        });

        // Build thread objects from GitHub issues + issue comments
        const ghThreads: Thread[] = [];
        for (const issue of issues) {
          const issueNumber = issue?.number as number | undefined;
          const issueUrl = issue?.html_url as string | undefined;
          if (!issueNumber) continue;

          const metadata = parseMetadataFromIssueBody(issue?.body || '');

          const commentsResult = await githubAdapter.fetchIssueComments(issueNumber);
          const ghComments = commentsResult.success && commentsResult.data ? commentsResult.data : [];

          const mappedComments: Comment[] = (Array.isArray(ghComments) ? ghComments : []).map(
            (c: {
              id: number;
              body?: string;
              user?: { login?: string };
              created_at?: string;
            }) => {
            const rawBody = c?.body || '';
            return {
              id: `ghc-${c.id}`,
              githubCommentId: c.id,
              parentGitHubCommentId: parseReplyParentFromGitHubBody(rawBody),
              author: c?.user?.login,
              text: stripHaleReplyMarkers(rawBody),
              createdAt: c?.created_at || new Date().toISOString(),
            };
          });

          // Second pass: infer parent from quoted blocks when no explicit hale marker exists.
          for (const c of mappedComments) {
            if (c.parentGitHubCommentId) continue;
            const raw = (Array.isArray(ghComments) ? ghComments : []).find(
              (x: { id?: number; body?: string }) => x?.id === c.githubCommentId,
            )?.body || '';
            const inferred = inferReplyParentFromQuote(raw, mappedComments);
            if (inferred && inferred !== c.githubCommentId) {
              c.parentGitHubCommentId = inferred;
            }
          }

          ghThreads.push({
            id: `gh-${issueNumber}`,
            route,
            version,
            cssSelector: metadata.cssSelector,
            elementDescription: metadata.elementDescription,
            xPercent: metadata.xPercent,
            yPercent: metadata.yPercent,
            comments: mappedComments,
            issueNumber,
            issueUrl,
            provider: 'github',
            syncStatus: 'synced',
            status: issue?.state === 'closed' ? 'closed' : 'open',
          });
        }

        // Merge: keep local-only comments (those without githubCommentId)
        setThreads((prev) => {
          const prevByIssue = new Map<number, Thread>();
          for (const t of prev) {
            if (t.issueNumber) prevByIssue.set(t.issueNumber, t);
          }

          const merged = ghThreads.map((gt) => {
            const existing = gt.issueNumber ? prevByIssue.get(gt.issueNumber) : undefined;
            if (!existing) return gt;

            const localOnly = existing.comments.filter((c) => !c.githubCommentId);
            const mergedComments = [...gt.comments, ...localOnly];

            return {
              ...gt,
              version: gt.version ?? existing.version,
              xPercent: gt.xPercent || existing.xPercent,
              yPercent: gt.yPercent || existing.yPercent,
              comments: mergedComments,
            };
          });

          // Track which issue numbers were returned from GitHub
          const githubIssueNumbers = new Set(ghThreads.map(gt => gt.issueNumber).filter((n): n is number => !!n));

          // Keep local threads on this route/version that:
          // 1. Don't have an issueNumber yet, OR
          // 2. Are actively syncing (prevents race condition where issue was created but GitHub API hasn't returned it yet), OR
          // 3. Have an issueNumber but GitHub didn't return it (preserve existing threads even if GitHub API fails or issue is hidden)
          const localUnlinked = prev.filter(
            (t) =>
              t.route === route &&
              (t.version ?? '1') === (version ?? '1') &&
              (!t.issueNumber || t.syncStatus === 'syncing' || !githubIssueNumbers.has(t.issueNumber)),
          );

          // Remove duplicates: if a thread is both in localUnlinked and merged, prefer the merged version
          const localUnlinkedDeduped = localUnlinked.filter(
            (local) => !merged.some((m) => m.issueNumber && m.issueNumber === local.issueNumber)
          );

          // Preserve threads from other routes/versions unchanged.
          const other = prev.filter((t) => !(t.route === route && (t.version ?? '1') === (version ?? '1')));

          console.log(`🔄 Sync merge for ${key}:`, {
            fromGitHub: ghThreads.length,
            merged: merged.length,
            localUnlinked: localUnlinked.length,
            localUnlinkedDeduped: localUnlinkedDeduped.length,
            other: other.length,
            total: other.length + localUnlinkedDeduped.length + merged.length,
            previousTotal: prev.length
          });

          return [...other, ...localUnlinkedDeduped, ...merged];
        });
      } finally {
        setSyncInFlightCount((c) => Math.max(0, c - 1));
        syncInFlightByKey.current.delete(key);
      }
    })();

    syncInFlightByKey.current.set(key, run);
    return run;
  };

  const addReply = (threadId: string, text: string, parentCommentId?: string) => {
    const author = getStoredUser()?.login;
    const createdAt = new Date().toISOString();
    const localCommentId = `comment-${Date.now()}`;
    const threadSnapshot = threadsRef.current.find((t) => t.id === threadId);
    const parent = parentCommentId
      ? threadSnapshot?.comments.find((c) => c.id === parentCommentId)
      : undefined;

    // Optimistically add locally
    setThreads((prev) =>
      prev.map((thread) => {
        if (thread.id !== threadId) return thread;
        const newComment: Comment = {
          id: localCommentId,
          author,
          text,
          createdAt,
          parentCommentId,
          parentGitHubCommentId: parent?.githubCommentId,
        };
        return {
          ...thread,
          comments: [...thread.comments, newComment],
          isTemporary: undefined, // Remove temporary flag - thread now persists
        };
      }),
    );

    // Background sync to GitHub issue comments (if available)
    const thread = threadsRef.current.find((t) => t.id === threadId);
    const issueNumber = thread?.issueNumber;

    if (!isGitHubConfigured() || !thread) return;

    // If the thread hasn't finished creating its issue yet, create it now, then backfill any local-only comments.
    const ensureIssueAndBackfill = async () => {
      try {
        setThreads((prev) =>
          prev.map((t) => (t.id === threadId ? { ...t, syncStatus: 'syncing', syncError: undefined } : t)),
        );

        let ensuredIssueNumber = thread.issueNumber;
        let ensuredIssueUrl = thread.issueUrl;

        if (!ensuredIssueNumber) {
          const created = await githubAdapter.createIssue({
            title: `Feedback: ${thread.route}`,
            body: `Thread created from pin${thread.elementDescription ? ` on ${thread.elementDescription}` : ''}.`,
            route: thread.route,
            cssSelector: thread.cssSelector,
            elementDescription: thread.elementDescription,
            xPercent: thread.xPercent,
            yPercent: thread.yPercent,
            version: thread.version,
          });

          if (!created.success || !created.data?.number) {
            throw new Error(created.error || 'Failed to create issue');
          }

          ensuredIssueNumber = created.data.number;
          ensuredIssueUrl = created.data.html_url;

          setThreads((prev) =>
            prev.map((t) =>
              t.id === threadId
                ? {
                    ...t,
                    issueNumber: ensuredIssueNumber,
                    issueUrl: ensuredIssueUrl,
                    syncStatus: 'syncing', // Keep syncing while backfilling comments
                    syncError: undefined,
                  }
                : t,
            ),
          );
        }

        // Backfill all comments that don't yet have a GitHub comment id (including the one we just added),
        // ensuring parents are synced before children so replies can reference a parent GitHub comment id.
        const latest = threadsRef.current.find((t) => t.id === threadId);
        const comments = latest?.comments || [];
        const pending = comments.filter((c) => !c.githubCommentId);
        const pendingIds = new Set(pending.map((c) => c.id));

        const createdGitHubIdsByLocalId = new Map<string, number>();

        const canSync = (c: Comment) => {
          if (!c.parentCommentId) return true;
          const parent = comments.find((pc) => pc.id === c.parentCommentId);
          if (!parent) return true;
          if (parent.githubCommentId) return true;
          if (createdGitHubIdsByLocalId.has(parent.id)) return true;
          // if parent isn't pending, nothing we can do
          if (!pendingIds.has(parent.id)) return true;
          return false;
        };

        const queue = [...pending];
        let guard = 0;
        while (queue.length > 0 && guard < 10000) {
          guard++;
          const idx = queue.findIndex(canSync);
          if (idx === -1) break;
          const c = queue.splice(idx, 1)[0];

          const parentForBody = c.parentCommentId ? comments.find((pc) => pc.id === c.parentCommentId) : undefined;
          const resolvedParentGitHubId =
            parentForBody?.githubCommentId ?? (parentForBody ? createdGitHubIdsByLocalId.get(parentForBody.id) : undefined);

          // keep local linkage for display; set parentGitHubCommentId once we know it
          if (c.parentCommentId && resolvedParentGitHubId) {
            setThreads((prev) =>
              prev.map((t) => {
                if (t.id !== threadId) return t;
                return {
                  ...t,
                  comments: t.comments.map((cc) =>
                    cc.id === c.id ? { ...cc, parentGitHubCommentId: resolvedParentGitHubId } : cc,
                  ),
                };
              }),
            );
          }

          const body = buildGitHubReplyBody(c.text, resolvedParentGitHubId ? { ...parentForBody, githubCommentId: resolvedParentGitHubId } : parentForBody);
          const res = await githubAdapter.createComment(ensuredIssueNumber!, body);
          if (!res.success || !res.data?.id) {
            throw new Error(res.error || 'Failed to create GitHub comment');
          }
          const newId = res.data.id as number;
          createdGitHubIdsByLocalId.set(c.id, newId);
          setThreads((prev) =>
            prev.map((t) => {
              if (t.id !== threadId) return t;
              return {
                ...t,
                comments: t.comments.map((cc) => (cc.id === c.id ? { ...cc, githubCommentId: newId } : cc)),
              };
            }),
          );
        }

        setThreads((prev) =>
          prev.map((t) => (t.id === threadId ? { ...t, syncStatus: 'synced', syncError: undefined } : t)),
        );
      } catch (e: unknown) {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  syncStatus: 'pending',
                  syncError: e instanceof Error ? e.message : 'Failed to sync reply',
                }
              : t,
          ),
        );
      }
    };

    if (issueNumber) {
      // If replying to a parent that hasn't synced to GitHub yet, backfill first so we can preserve threading markers.
      if (parentCommentId && parent && !parent.githubCommentId) {
        void ensureIssueAndBackfill();
        return;
      }

      const body = buildGitHubReplyBody(text, parent);
      githubAdapter
        .createComment(issueNumber, body)
        .then((result) => {
          if (!result.success) throw new Error(result.error || 'Failed to create GitHub comment');
          const githubCommentId = result.data?.id as number | undefined;
          if (!githubCommentId) throw new Error('No GitHub comment id returned');

          setThreads((prev) =>
            prev.map((t) => {
              if (t.id !== threadId) return t;
              return {
                ...t,
                syncStatus: 'synced',
                syncError: undefined,
                comments: t.comments.map((c) =>
                  c.id === localCommentId ? { ...c, githubCommentId } : c,
                ),
              };
            }),
          );
        })
        .catch(() => ensureIssueAndBackfill());
    } else {
      void ensureIssueAndBackfill();
    }
  };

  const updateComment = (threadId: string, commentId: string, text: string) => {
    const thread = threadsRef.current.find((t) => t.id === threadId);
    const issueNumber = thread?.issueNumber;
    const existingComment = thread?.comments.find((c) => c.id === commentId);
    const githubCommentId = existingComment?.githubCommentId;

    setThreads((prev) =>
      prev.map((thread) => {
        if (thread.id === threadId) {
          return {
            ...thread,
            comments: thread.comments.map((comment) =>
              comment.id === commentId ? { ...comment, text } : comment,
            ),
          };
        }
        return thread;
      }),
    );

    if (isGitHubConfigured() && issueNumber && githubCommentId) {
      githubAdapter.updateComment(githubCommentId, text).then((result) => {
        if (result.success) {
          setThreads((prev) =>
            prev.map((t) => (t.id === threadId ? { ...t, syncStatus: 'synced', syncError: undefined } : t)),
          );
          return;
        }
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId ? { ...t, syncStatus: 'pending', syncError: result.error || 'Failed to update comment' } : t,
          ),
        );
      });
    }
  };

  const deleteComment = (threadId: string, commentId: string) => {
    const thread = threadsRef.current.find((t) => t.id === threadId);
    const issueNumber = thread?.issueNumber;
    const existingComment = thread?.comments.find((c) => c.id === commentId);
    const githubCommentId = existingComment?.githubCommentId;

    console.log('🗑️ deleteComment called:', {
      threadId,
      commentId,
      issueNumber,
      githubCommentId,
      hasExistingComment: !!existingComment,
      isGitHubConfigured: isGitHubConfigured(),
    });

    // Remove from local state immediately (optimistic delete)
    setThreads((prev) =>
      prev.map((thread) => {
        if (thread.id === threadId) {
          return {
            ...thread,
            comments: thread.comments.filter((comment) => comment.id !== commentId),
          };
        }
        return thread;
      }),
    );

    // Attempt GitHub deletion if applicable
    if (isGitHubConfigured() && issueNumber && githubCommentId) {
      console.log(`🔵 Attempting to delete GitHub comment #${githubCommentId} on issue #${issueNumber}`);

      githubAdapter.deleteComment(githubCommentId).then((result) => {
        if (result.success) {
          console.log(`✅ Successfully deleted GitHub comment #${githubCommentId}`);
          setThreads((prev) =>
            prev.map((t) => (t.id === threadId ? { ...t, syncStatus: 'synced', syncError: undefined } : t)),
          );
          return;
        }

        console.error(`❌ Failed to delete GitHub comment #${githubCommentId}:`, result.error);

        // Restore comment if delete failed
        if (existingComment) {
          console.warn(`⚠️ Restoring comment locally due to GitHub deletion failure`);
          setThreads((prev) =>
            prev.map((t) => {
              if (t.id !== threadId) return t;
              return {
                ...t,
                syncStatus: 'error',
                syncError: result.error || 'Failed to delete comment on GitHub',
                comments: [...t.comments, existingComment],
              };
            }),
          );
        }
      }).catch((err) => {
        console.error(`❌ Exception during GitHub comment deletion:`, err);

        // Restore comment on exception
        if (existingComment) {
          setThreads((prev) =>
            prev.map((t) => {
              if (t.id !== threadId) return t;
              return {
                ...t,
                syncStatus: 'error',
                syncError: 'Exception during GitHub comment deletion',
                comments: [...t.comments, existingComment],
              };
            }),
          );
        }
      });
    } else {
      console.log(`ℹ️ GitHub deletion skipped:`, {
        reason: !isGitHubConfigured()
          ? 'GitHub not configured'
          : !issueNumber
          ? 'No issue number'
          : !githubCommentId
          ? 'Comment not synced to GitHub yet'
          : 'Unknown',
      });
    }
  };

  const closeThread = (threadId: string) => {
    const thread = threadsRef.current.find((t) => t.id === threadId);
    const issueNumber = thread?.issueNumber;

    console.log('🔒 closeThread called:', { threadId, issueNumber });

    // Mark thread as closed locally
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, status: 'closed' as const } : t))
    );

    // Keep the thread selected so the UI can switch to a "Reopen" state (GitHub-like)

    // Sync close to GitHub
    if (isGitHubConfigured() && issueNumber) {
      console.log(`🔵 Closing GitHub issue #${issueNumber}...`);

      githubAdapter.closeIssue(issueNumber).then((result) => {
        if (result.success) {
          console.log(`✅ Successfully closed GitHub issue #${issueNumber}`);
          setThreads((prev) =>
            prev.map((t) => (t.id === threadId ? { ...t, syncStatus: 'synced', syncError: undefined } : t))
          );
        } else {
          console.error(`❌ Failed to close GitHub issue #${issueNumber}:`, result.error);
          setThreads((prev) =>
            prev.map((t) =>
              t.id === threadId
                ? { ...t, syncStatus: 'error', syncError: result.error || 'Failed to close issue' }
                : t
            )
          );
        }
      });
    }
  };

  const reopenThread = (threadId: string) => {
    const thread = threadsRef.current.find((t) => t.id === threadId);
    const issueNumber = thread?.issueNumber;

    console.log('🔓 reopenThread called:', { threadId, issueNumber });

    // Mark thread as open locally
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, status: 'open' as const } : t))
    );

    // Sync reopen to GitHub
    if (isGitHubConfigured() && issueNumber) {
      console.log(`🔵 Reopening GitHub issue #${issueNumber}...`);

      githubAdapter.reopenIssue(issueNumber).then((result) => {
        if (result.success) {
          console.log(`✅ Successfully reopened GitHub issue #${issueNumber}`);
          setThreads((prev) =>
            prev.map((t) => (t.id === threadId ? { ...t, syncStatus: 'synced', syncError: undefined } : t))
          );
        } else {
          console.error(`❌ Failed to reopen GitHub issue #${issueNumber}:`, result.error);
          setThreads((prev) =>
            prev.map((t) =>
              t.id === threadId
                ? { ...t, syncStatus: 'error', syncError: result.error || 'Failed to reopen issue' }
                : t
            )
          );
        }
      });
    }
  };

  const removePin = (threadId: string) => {
    const thread = threadsRef.current.find((t) => t.id === threadId);
    const issueNumber = thread?.issueNumber;

    // Remove locally immediately.
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    if (selectedThreadId === threadId) setSelectedThreadId(null);

    if (!isGitHubConfigured()) return;

    if (!issueNumber) {
      // Issue may still be creating; mark so we can close it once we get the number.
      removedThreadIdsRef.current.add(threadId);
      return;
    }

    // Prevent re-appearing on sync even if close is slow/fails.
    hiddenIssueNumbersRef.current.add(issueNumber);
    writeNumberSet(HIDDEN_ISSUES_KEY, hiddenIssueNumbersRef.current);

    pendingCloseIssueNumbersRef.current.add(issueNumber);
    writeNumberSet(PENDING_CLOSE_ISSUES_KEY, pendingCloseIssueNumbersRef.current);

    githubAdapter.closeIssue(issueNumber).then((result) => {
      if (result.success) {
        pendingCloseIssueNumbersRef.current.delete(issueNumber);
        writeNumberSet(PENDING_CLOSE_ISSUES_KEY, pendingCloseIssueNumbersRef.current);
      }
    });
  };

  const getThreadsForRoute = (route: string, version?: string): Thread[] => {
    return threads.filter(
      (thread) => thread.route === route && (!version || (thread.version ?? '1') === version),
    );
  };

  const retrySync = async () => {
    if (!isGitHubConfigured()) return;
    setSyncInFlightCount((c) => c + 1);
    try {
      const current = threadsRef.current;

      // First, create issues for threads that don't have an issueNumber yet.
      for (const t of current) {
        if (t.issueNumber) continue;
        if (t.syncStatus !== 'error' && t.syncStatus !== 'pending' && t.syncStatus !== 'syncing' && t.syncStatus !== 'local') continue;

        setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, syncStatus: 'syncing', syncError: undefined } : x)));
        const created = await githubAdapter.createIssue({
          title: `Feedback: ${t.route}`,
          body: `Thread created from pin${t.elementDescription ? ` on ${t.elementDescription}` : ''}.`,
          route: t.route,
          cssSelector: t.cssSelector,
          elementDescription: t.elementDescription,
          xPercent: t.xPercent,
          yPercent: t.yPercent,
          version: t.version,
        });

        if (created.success && created.data?.number) {
          setThreads((prev) =>
            prev.map((x) =>
              x.id === t.id
                ? { ...x, issueNumber: created.data?.number, issueUrl: created.data?.html_url, syncStatus: 'synced', syncError: undefined }
                : x,
            ),
          );
        } else {
          setThreads((prev) =>
            prev.map((x) => (x.id === t.id ? { ...x, syncStatus: 'error', syncError: created.error || 'Failed to create issue' } : x)),
          );
        }
      }

      // Then, push any local-only comments (no githubCommentId) for threads with an issueNumber.
      const afterIssues = threadsRef.current;
      for (const t of afterIssues) {
        if (!t.issueNumber) continue;
        const localOnly = t.comments.filter((c) => !c.githubCommentId);
        if (localOnly.length === 0) continue;

        setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, syncStatus: 'syncing', syncError: undefined } : x)));

        for (const c of localOnly) {
          const res = await githubAdapter.createComment(t.issueNumber, c.text);
          if (res.success && res.data?.id) {
            const newId = res.data.id as number;
            setThreads((prev) =>
              prev.map((x) =>
                x.id === t.id
                  ? {
                      ...x,
                      comments: x.comments.map((cc) => (cc.id === c.id ? { ...cc, githubCommentId: newId } : cc)),
                    }
                  : x,
              ),
            );
          } else {
            setThreads((prev) =>
              prev.map((x) => (x.id === t.id ? { ...x, syncStatus: 'pending', syncError: res.error || 'Failed to sync comment' } : x)),
            );
          }
        }

        setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, syncStatus: 'synced', syncError: undefined } : x)));
      }
    } finally {
      setSyncInFlightCount((c) => Math.max(0, c - 1));
    }
  };

  const hasPendingSync = threads.some((t) => t.syncStatus === 'pending' || t.syncStatus === 'error');

  const value: CommentContextType = {
    threads,
    commentsEnabled,
    setCommentsEnabled,
    showPinsEnabled,
    setShowPinsEnabled,
    drawerPinnedOpen,
    setDrawerPinnedOpen,
    floatingWidgetMode,
    setFloatingWidgetMode,
    addThread,
    addReply,
    syncFromGitHub,
    retrySync,
    isSyncing,
    hasPendingSync,
    updateComment,
    deleteComment,
    closeThread,
    reopenThread,
    removePin,
    getThreadsForRoute,
    selectedThreadId,
    setSelectedThreadId,
  };

  return <CommentContext.Provider value={value}>{children}</CommentContext.Provider>;
};

export const useComments = (): CommentContextType => {
  const context = React.useContext(CommentContext);
  if (!context) {
    throw new Error('useComments must be used within a CommentProvider');
  }
  return context;
};
