import * as React from 'react';
import { useLocation } from 'react-router-dom';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  EmptyStateBody,
  Label,
  Spinner,
  TextArea,
  Title,
} from '@patternfly/react-core';
import { ExternalLinkAltIcon, InfoCircleIcon } from '@patternfly/react-icons';
import { githubAdapter, isGitHubConfigured } from '../services/githubAdapter';
import {
  type IssueLinkScope,
  getPageKey,
  getSectionKey,
  getSectionRoute,
  normalizePathname,
} from '../utils/issueLinkRouteUtils';

type JiraScope = IssueLinkScope;

type JiraTicket = {
  key: string;
  url: string;
  summary: string;
  status: string;
  assignee: string;
  issueType: string;
  priority: string;
  created?: string;
  updated?: string;
  description?: string;
};

interface JiraRecord {
  jiraKeys: string[];
  scope: JiraScope;
  anchorRoute: string;
  updatedAt: string;
}

// Legacy format for backward compatibility
interface LegacyJiraRecord {
  jiraKey?: string;
  jiraKeys?: string[];
  scope: JiraScope;
  anchorRoute: string;
  updatedAt: string;
}

type JiraStore = Record<string, JiraRecord>;

// Jira Issue Cache
type CachedJiraIssue = {
  ticket: JiraTicket;
  fetchedAt: number; // timestamp
};
type JiraIssueCache = Record<string, CachedJiraIssue>;

const STORAGE_KEY = 'hale_commenting_jira_v1';
const CACHE_STORAGE_KEY = 'hale_commenting_jira_cache_v1';
const GH_JIRA_PATH = '.hale/jira.json';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function migrateRecord(record: LegacyJiraRecord): JiraRecord {
  // If it's already in the new format, return as-is
  if (Array.isArray(record.jiraKeys)) {
    return record as JiraRecord;
  }
  // Migrate from old format (single jiraKey)
  if (typeof record.jiraKey === 'string' && record.jiraKey.trim()) {
    return {
      jiraKeys: [record.jiraKey.trim()],
      scope: record.scope,
      anchorRoute: record.anchorRoute,
      updatedAt: record.updatedAt,
    };
  }
  // Empty record - return with empty array
  return {
    jiraKeys: [],
    scope: record.scope,
    anchorRoute: record.anchorRoute,
    updatedAt: record.updatedAt,
  };
}

function safeParseStore(raw: string | null): JiraStore {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const store = parsed as Record<string, LegacyJiraRecord>;
    // Migrate all records to new format
    const migrated: JiraStore = {};
    for (const [key, record] of Object.entries(store)) {
      migrated[key] = migrateRecord(record);
    }
    return migrated;
  } catch {
    return {};
  }
}

function getStore(): JiraStore {
  if (typeof window === 'undefined') return {};
  return safeParseStore(window.localStorage.getItem(STORAGE_KEY));
}

function setStore(next: JiraStore) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function getIssueCache(): JiraIssueCache {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as JiraIssueCache;
  } catch {
    return {};
  }
}

function setIssueCache(cache: JiraIssueCache) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache));
}

function getCachedIssue(key: string): JiraTicket | null {
  const cache = getIssueCache();
  const cached = cache[key];
  if (!cached) return null;

  const now = Date.now();
  const age = now - cached.fetchedAt;

  // Return cached data if it's still fresh
  if (age < CACHE_TTL_MS) {
    return cached.ticket;
  }

  // Expired - remove it
  delete cache[key];
  setIssueCache(cache);
  return null;
}

function setCachedIssue(key: string, ticket: JiraTicket) {
  const cache = getIssueCache();
  cache[key] = {
    ticket,
    fetchedAt: Date.now(),
  };
  setIssueCache(cache);
}

function loadForRoute(pathname: string): { record: JiraRecord | null; source: 'page' | 'section' | null } {
  const store = getStore();
  const pageKey = getPageKey(pathname);
  if (store[pageKey] && store[pageKey].jiraKeys.length > 0) {
    return { record: store[pageKey], source: 'page' };
  }

  const sectionRoute = getSectionRoute(pathname);
  const sectionKey = getSectionKey(sectionRoute);
  if (store[sectionKey] && store[sectionKey].jiraKeys.length > 0) {
    return { record: store[sectionKey], source: 'section' };
  }

  return { record: null, source: null };
}

const normalizeJiraKeys = (input: string): string[] => {
  const raw = input.trim();
  if (!raw) return [];
  
  // Split by comma, newline, or whitespace, then normalize each
  const keys = raw
    .split(/[,\n]+/)
    .map(k => k.trim())
    .filter(Boolean)
    .map(key => {
      // Allow users to paste full URLs; extract trailing key-ish segment.
      const m = key.match(/([A-Z][A-Z0-9]+-\d+)/i);
      if (m?.[1]) return m[1].toUpperCase();
      return key.toUpperCase();
    });
  
  // Remove duplicates and empty strings
  return Array.from(new Set(keys.filter(Boolean)));
};

const stripHtmlTags = (input: string): string => {
  // Jira sometimes returns HTML-ish strings (or users paste HTML). For our UI,
  // show readable plain text.
  return input.replace(/<[^>]*>/g, '').replace(/\r\n/g, '\n').trim();
};

type ParsedSection = { title: string; body: string };

const canonicalizeSectionTitle = (raw: string): string => {
  const t = raw.trim().replace(/\s+/g, ' ');
  const lower = t.toLowerCase();
  if (lower === 'problem statement') return 'Problem statement';
  if (lower === 'objective') return 'Objective';
  if (lower === 'definition of done') return 'Definition of Done';
  if (lower === 'job stories') return 'Job Stories';
  if (lower === 'stakeholders') return 'Stakeholders';
  return t;
};

const parseJiraTemplateSections = (rawText: string): ParsedSection[] => {
  const text = stripHtmlTags(rawText || '');
  if (!text) return [];

  const lines = text.split('\n');
  const sections: ParsedSection[] = [];

  let currentTitle: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (!currentTitle) return;
    const body = currentBody.join('\n').trim();
    sections.push({ title: canonicalizeSectionTitle(currentTitle), body });
    currentTitle = null;
    currentBody = [];
  };

  const isKnownHeading = (t: string) => {
    const lower = t.trim().toLowerCase();
    return (
      lower === 'problem statement' ||
      lower === 'objective' ||
      lower === 'job stories' ||
      lower === 'stakeholders' ||
      lower === 'definition of done'
    );
  };

  for (const rawLine of lines) {
    const line = rawLine.trimRight();
    const trimmed = line.trim();

    // Jira wiki-style headings often come through as: "h3. Problem statement"
    const m = trimmed.match(/^h3\.\s*(.+)$/i);
    if (m?.[1]) {
      flush();
      currentTitle = m[1].trim();
      continue;
    }

    // After HTML stripping, rendered headings may be left as plain lines like "Problem statement"
    // Treat them as headings when they match a known template title.
    if (isKnownHeading(trimmed)) {
      flush();
      currentTitle = trimmed;
      continue;
    }

    if (!currentTitle) {
      // ignore leading preamble until we hit the first known heading
      continue;
    }

    currentBody.push(line);
  }

  flush();
  return sections;
};

const renderBulletsOrText = (text: string) => {
  const cleaned = stripHtmlTags(text || '');
  if (!cleaned) return (
    <div style={{ fontSize: '0.875rem', color: 'var(--pf-t--global--text--color--subtle)' }}>—</div>
  );

  const lines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return <div style={{ fontSize: '0.875rem', whiteSpace: 'pre-wrap' }}>{cleaned}</div>;
  }

  const bulletLines = lines.filter((l) => /^(\*{1,2}\s+|[-•]\s+)/.test(l));
  const hasBullets = bulletLines.length > 0;

  if (!hasBullets) {
    return <div style={{ fontSize: '0.875rem', whiteSpace: 'pre-wrap' }}>{cleaned}</div>;
  }

  const items = lines
    .map((l) => l.replace(/^(\*{1,2}\s+|[-•]\s+)/, '').trim())
    .filter(Boolean);

  return (
    <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'grid', gap: '0.5rem' }}>
      {items.map((item, idx) => (
        // eslint-disable-next-line react/no-array-index-key
        <li key={idx} style={{ fontSize: '0.875rem' }}>
          {item}
        </li>
      ))}
    </ul>
  );
};

export const JiraTab: React.FunctionComponent = () => {
  const location = useLocation();
  const route = normalizePathname(location.pathname);
  const sectionRoute = getSectionRoute(route);

  const [{ record, source }, setResolved] = React.useState(() => loadForRoute(route));
  const [isEditing, setIsEditing] = React.useState(false);

  const [draftScope, setDraftScope] = React.useState<JiraScope>('section');
  const [draftKey, setDraftKey] = React.useState('');

  const [isLoadingRemote, setIsLoadingRemote] = React.useState(false);
  const [remoteError, setRemoteError] = React.useState<string | null>(null);
  const remoteShaRef = React.useRef<string | undefined>(undefined);

  const [isFetchingIssues, setIsFetchingIssues] = React.useState(false);
  const [issues, setIssues] = React.useState<Record<string, JiraTicket>>({});
  const [issueErrors, setIssueErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    setResolved(loadForRoute(route));
    setIsEditing(false);
  }, [route]);

  // Load Jira store from GitHub if configured.
  React.useEffect(() => {
    const load = async () => {
      if (!isGitHubConfigured()) return;
      setIsLoadingRemote(true);
      setRemoteError(null);
      try {
        const local = getStore();
        const res = await githubAdapter.getRepoFile(GH_JIRA_PATH);
        if (!res.success) {
          setRemoteError(res.error || 'Failed to load Jira store from GitHub');
          return;
        }

        if (!res.data) {
          // No remote file yet: initialize from local if we have anything.
          if (Object.keys(local).length > 0) {
            const created = await githubAdapter.putRepoFile({
              path: GH_JIRA_PATH,
              text: JSON.stringify(local, null, 2) + '\n',
              message: 'chore(jira): initialize jira store',
            });
            if (created.success) remoteShaRef.current = created.data?.sha;
          }
          return;
        }

        remoteShaRef.current = res.data.sha;
        const parsed = safeParseStore(res.data.text);
        setStore(parsed);
        setResolved(loadForRoute(route));
      } finally {
        setIsLoadingRemote(false);
      }
    };

    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch Jira issue details for all keys (with caching).
  React.useEffect(() => {
    const keys = record?.jiraKeys || [];
    if (keys.length === 0) {
      setIssues({});
      setIssueErrors({});
      return;
    }

    const run = async () => {
      setIsFetchingIssues(true);
      setIssueErrors({});
      const results: Record<string, JiraTicket> = {};
      const errors: Record<string, string> = {};

      // Check cache first
      const keysToFetch: string[] = [];
      for (const key of keys) {
        const cached = getCachedIssue(key);
        if (cached) {
          results[key] = cached;
        } else {
          keysToFetch.push(key);
        }
      }

      // Fetch uncached issues
      if (keysToFetch.length > 0) {
        await Promise.all(
          keysToFetch.map(async (key) => {
            try {
              const resp = await fetch(`/api/jira-issue?key=${encodeURIComponent(key)}`);
              const payload = await resp.json().catch(() => ({}));

              if (!resp.ok) {
                // Handle rate limiting specially
                if (resp.status === 429) {
                  errors[key] = 'Rate limit exceeded. Please wait a few minutes and refresh the page.';
                  return;
                }

                const raw = String(payload?.message || `Failed to fetch Jira issue (${resp.status})`);
                const sanitized = raw.trim().startsWith('<') ? 'Unauthorized or non-JSON response from Jira.' : raw;
                const hint = payload?.hint ? ` ${String(payload.hint)}` : '';
                errors[key] = `${sanitized}${hint}`;
                return;
              }

              const ticket = payload as JiraTicket;
              results[key] = ticket;

              // Cache the successful result
              setCachedIssue(key, ticket);
            } catch (e: unknown) {
              errors[key] = e instanceof Error ? e.message : 'Failed to fetch Jira issue';
            }
          })
        );
      }

      setIssues(results);
      setIssueErrors(errors);
      setIsFetchingIssues(false);
    };

    void run();
  }, [record?.jiraKeys]);

  const startNew = () => {
    setDraftScope('section');
    setDraftKey('');
    setIsEditing(true);
  };

  const startEdit = (mode: 'edit-existing' | 'override-page') => {
    if (mode === 'override-page') {
      setDraftScope('page');
      setDraftKey(record?.jiraKeys.join(', ') ?? '');
      setIsEditing(true);
      return;
    }

    const existingScope: JiraScope = record?.scope ?? 'section';
    setDraftScope(existingScope);
    setDraftKey(record?.jiraKeys.join(', ') ?? '');
    setIsEditing(true);
  };

  const save = () => {
    const normalizedKeys = normalizeJiraKeys(draftKey);
    if (normalizedKeys.length === 0) return;

    const next: JiraRecord = {
      jiraKeys: normalizedKeys,
      scope: draftScope,
      anchorRoute: draftScope === 'section' ? sectionRoute : route,
      updatedAt: new Date().toISOString(),
    };

    const store = getStore();
    const key = draftScope === 'section' ? getSectionKey(sectionRoute) : getPageKey(route);
    const nextStore = { ...store, [key]: next };
    setStore(nextStore);

    setResolved(loadForRoute(route));
    setIsEditing(false);

    if (isGitHubConfigured()) {
      (async () => {
        const text = JSON.stringify(nextStore, null, 2) + '\n';
        const message = `chore(jira): update ${key}`;
        const sha = remoteShaRef.current;

        const write = await githubAdapter.putRepoFile({ path: GH_JIRA_PATH, text, message, sha });
        if (write.success && write.data?.sha) {
          remoteShaRef.current = write.data.sha;
          setRemoteError(null);
          return;
        }

        const refreshed = await githubAdapter.getRepoFile(GH_JIRA_PATH);
        if (refreshed.success && refreshed.data?.sha) {
          remoteShaRef.current = refreshed.data.sha;
          const retry = await githubAdapter.putRepoFile({
            path: GH_JIRA_PATH,
            text,
            message,
            sha: refreshed.data.sha,
          });
          if (retry.success && retry.data?.sha) {
            remoteShaRef.current = retry.data.sha;
            setRemoteError(null);
            return;
          }
        }

        setRemoteError(write.error || 'Failed to save Jira store to GitHub');
      })();
    }
  };

  const remove = () => {
    const store = getStore();
    const keyToRemove =
      source === 'page' ? getPageKey(route) : source === 'section' ? getSectionKey(sectionRoute) : null;
    if (!keyToRemove) return;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [keyToRemove]: _removed, ...rest } = store;
    setStore(rest);
    setResolved(loadForRoute(route));
    setIsEditing(false);

    if (isGitHubConfigured()) {
      (async () => {
        const text = JSON.stringify(rest, null, 2) + '\n';
        const message = `chore(jira): remove ${keyToRemove}`;
        const sha = remoteShaRef.current;
        const write = await githubAdapter.putRepoFile({ path: GH_JIRA_PATH, text, message, sha });
        if (write.success && write.data?.sha) {
          remoteShaRef.current = write.data.sha;
          setRemoteError(null);
          return;
        }
        setRemoteError(write.error || 'Failed to update Jira store in GitHub');
      })();
    }
  };

  const remoteStatusLine = isGitHubConfigured()
    ? isLoadingRemote
      ? 'Loading Jira store from GitHub…'
      : remoteError
        ? `GitHub sync: ${remoteError}`
        : 'GitHub sync enabled'
    : null;

  const isInherited = source === 'section' && record?.anchorRoute !== route;

  if (!record && !isEditing) {
    return (
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <Title headingLevel="h3" size="lg">
              Jira
            </Title>
            <div style={{ fontSize: '0.875rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
              No Jira issue set for <b>{route}</b>.
            </div>
            {remoteStatusLine && (
              <div style={{ fontSize: '0.75rem', color: 'var(--pf-t--global--text--color--subtle)', marginTop: '0.25rem' }}>
                {remoteStatusLine}
              </div>
            )}
          </div>
          <Button variant="primary" onClick={startNew}>
            Add Jira issue
          </Button>
        </div>

        <EmptyState icon={InfoCircleIcon} titleText="No Jira issues linked" headingLevel="h3">
          <EmptyStateBody>Add Jira keys like <b>ABC-123</b> (or paste Jira URLs). You can add multiple issues separated by commas or new lines.</EmptyStateBody>
        </EmptyState>
      </div>
    );
  }

  if (isEditing) {
    const effectiveAnchor = draftScope === 'section' ? `${sectionRoute}/*` : route;
    return (
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <div>
            <Title headingLevel="h3" size="lg">
              Edit Jira
            </Title>
            <div style={{ fontSize: '0.875rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
              Applies to: <b>{effectiveAnchor}</b>
            </div>
            {remoteStatusLine && (
              <div style={{ fontSize: '0.75rem', color: 'var(--pf-t--global--text--color--subtle)', marginTop: '0.25rem' }}>
                {remoteStatusLine}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Button variant={draftScope === 'page' ? 'primary' : 'secondary'} onClick={() => setDraftScope('page')}>
              This page only
            </Button>
            <Button
              variant={draftScope === 'section' ? 'primary' : 'secondary'}
              onClick={() => setDraftScope('section')}
            >
              This section
            </Button>
          </div>
        </div>

        <Card>
          <CardBody>
            <Title headingLevel="h4" size="md" style={{ marginBottom: '1rem' }}>
              Jira issues
            </Title>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div>
                <div style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                  <b>Jira keys or URLs</b>
                  <div style={{ fontSize: '0.75rem', color: 'var(--pf-t--global--text--color--subtle)', marginTop: '0.25rem' }}>
                    Enter multiple keys separated by commas or new lines (e.g., ABC-123, DEF-456)
                  </div>
                </div>
                <TextArea
                  value={draftKey}
                  onChange={(_e, v) => setDraftKey(v)}
                  aria-label="Jira keys or URLs"
                  rows={3}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-start', marginTop: '0.5rem' }}>
                <Button variant="primary" onClick={save} isDisabled={normalizeJiraKeys(draftKey).length === 0}>
                  Save
                </Button>
                <Button variant="link" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  // View mode
  if (!record) {
    return null;
  }

  const scopeLabel =
    source === 'page' ? 'This page' : source === 'section' ? `Section (${sectionRoute}/*)` : null;
  const keys = record.jiraKeys || [];
  let jiraBaseUrl: string | undefined;
  try {
    jiraBaseUrl = typeof process !== 'undefined' && process.env ? process.env.VITE_JIRA_BASE_URL : undefined;
  } catch {
    jiraBaseUrl = undefined;
  }

  const removeKey = (keyToRemove: string) => {
    const store = getStore();
    const storeKey = source === 'page' ? getPageKey(route) : source === 'section' ? getSectionKey(sectionRoute) : null;
    if (!storeKey || !record) return;

    const updatedKeys = record.jiraKeys.filter(k => k !== keyToRemove);
    if (updatedKeys.length === 0) {
      const rest = { ...store };
      delete rest[storeKey];
      setStore(rest);
      setResolved(loadForRoute(route));
    } else {
      // Update with remaining keys
      const updated: JiraRecord = {
        ...record,
        jiraKeys: updatedKeys,
        updatedAt: new Date().toISOString(),
      };
      const nextStore = { ...store, [storeKey]: updated };
      setStore(nextStore);
      setResolved(loadForRoute(route));
    }

    if (isGitHubConfigured()) {
      (async () => {
        const finalStore = updatedKeys.length === 0
          ? Object.fromEntries(Object.entries(store).filter(([k]) => k !== storeKey))
          : { ...store, [storeKey]: { ...record, jiraKeys: updatedKeys, updatedAt: new Date().toISOString() } };
        const text = JSON.stringify(finalStore, null, 2) + '\n';
        const message = `chore(jira): remove ${keyToRemove} from ${storeKey}`;
        const sha = remoteShaRef.current;
        const write = await githubAdapter.putRepoFile({ path: GH_JIRA_PATH, text, message, sha });
        if (write.success && write.data?.sha) {
          remoteShaRef.current = write.data.sha;
          setRemoteError(null);
        } else {
          setRemoteError(write.error || 'Failed to update Jira store in GitHub');
        }
      })();
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <Title headingLevel="h3" size="lg">
            Jira
          </Title>
          {scopeLabel && (
            <div style={{ fontSize: '0.875rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
              Scope: <b>{scopeLabel}</b>
              {source === 'section' ? ` (applies to ${record.anchorRoute}/*)` : ''}
              {isInherited ? ` (inherited)` : ''}
            </div>
          )}
          {remoteStatusLine && (
            <div style={{ fontSize: '0.75rem', color: 'var(--pf-t--global--text--color--subtle)', marginTop: '0.25rem' }}>
              {remoteStatusLine}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {isInherited && (
            <Button variant="secondary" onClick={() => startEdit('override-page')}>
              Override for this page
            </Button>
          )}
          <Button variant="secondary" onClick={() => startEdit('edit-existing')}>
            Edit
          </Button>
        </div>
      </div>

      {/* Loading state */}
      {isFetchingIssues && keys.length > 0 && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
          <Spinner size="sm" /> <span>Fetching Jira details…</span>
        </div>
      )}

      {/* Display all issues */}
      <div style={{ display: 'grid', gap: '1rem' }}>
        {keys.map((key) => {
          const issue = issues[key];
          const error = issueErrors[key];
          const url = issue?.url || (jiraBaseUrl ? `${jiraBaseUrl}/browse/${key}` : '');

          const parsedSections = issue ? parseJiraTemplateSections(issue.description || '') : [];
          const byTitle = new Map(parsedSections.map((s) => [s.title, s.body]));

          const summary = issue?.summary || '';
          const status = issue?.status || '';
          const priority = issue?.priority || '';
          const assignee = issue?.assignee || '';
          const issueType = issue?.issueType || 'Issue';
          const created = issue?.created ? new Date(issue.created).toLocaleString() : '';
          const updated = issue?.updated ? new Date(issue.updated).toLocaleString() : '';

          return (
            <Card key={key}>
              <CardBody>
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {/* Ticket header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <Label color="blue" isCompact>
                        {issueType || 'Issue'}
                      </Label>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontWeight: 600 }}
                        >
                          {key} <ExternalLinkAltIcon style={{ fontSize: '0.75rem' }} />
                        </a>
                      ) : (
                        <span style={{ fontWeight: 600 }}>{key}</span>
                      )}
                    </div>
                    {keys.length > 1 && (
                      <Button variant="link" isDanger onClick={() => removeKey(key)}>
                        Remove
                      </Button>
                    )}
                  </div>

                  {/* Error state */}
                  {error && !isFetchingIssues && (
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                      <div style={{ fontSize: '0.875rem', color: 'var(--pf-t--global--danger--color--100)' }}>{error}</div>
                      {error.includes('Rate limit') && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
                          Tip: Jira data is cached for 15 minutes to reduce API calls. Refreshing the page will retry.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Issue details */}
                  {!error && issue && (
                    <>
                      {/* Title */}
                      <Title headingLevel="h3" size="lg" style={{ marginTop: '0.25rem' }}>
                        {summary || '—'}
                      </Title>

                      {/* Chips row */}
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                        <Label color="grey" isCompact>
                          Status: {status || '—'}
                        </Label>
                        <Label color="orange" isCompact>
                          Priority: {priority || '—'}
                        </Label>
                        <Label color="grey" isCompact>
                          Assignee: {assignee || '—'}
                        </Label>
                      </div>

                      {/* Dates */}
                      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.875rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
                        {created && (
                          <span>
                            <b>Created:</b> {created}
                          </span>
                        )}
                        {updated && (
                          <span>
                            <b>Updated:</b> {updated}
                          </span>
                        )}
                      </div>

                      <div style={{ height: 1, background: 'var(--pf-t--global--border--color--default)', marginTop: '0.25rem' }} />

                      {/* Template sections (preferred) */}
                      {parsedSections.length > 0 ? (
                        <div style={{ display: 'grid', gap: '1rem' }}>
                          <div>
                            <Title headingLevel="h4" size="md" style={{ marginBottom: '0.5rem' }}>
                              Problem statement
                            </Title>
                            {renderBulletsOrText(byTitle.get('Problem statement') || '')}
                          </div>
                          <div>
                            <Title headingLevel="h4" size="md" style={{ marginBottom: '0.5rem' }}>
                              Objective
                            </Title>
                            {renderBulletsOrText(byTitle.get('Objective') || '')}
                          </div>
                          <div>
                            <Title headingLevel="h4" size="md" style={{ marginBottom: '0.5rem' }}>
                              Definition of Done
                            </Title>
                            {renderBulletsOrText(byTitle.get('Definition of Done') || '')}
                          </div>
                        </div>
                      ) : (
                        // Fallback: show the raw description if it doesn't follow the template.
                        <div>
                          <Title headingLevel="h4" size="md" style={{ marginBottom: '0.5rem' }}>
                            Description
                          </Title>
                          <div style={{ fontSize: '0.875rem', whiteSpace: 'pre-wrap' }}>
                            {issue?.description ? stripHtmlTags(issue.description) : (
                              <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>No description</span>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <div style={{ marginTop: '0.25rem' }}>
        <Button variant="link" isDanger onClick={remove}>
          Remove all Jira links
        </Button>
      </div>
    </div>
  );
};


