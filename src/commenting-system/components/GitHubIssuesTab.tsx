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
import { type GitHubIssueSummary, githubAdapter, isGitHubConfigured } from '../services/githubAdapter';
import { getEnv } from '../utils/env';
import {
  type IssueLinkScope,
  getPageKey,
  getSectionKey,
  getSectionRoute,
  normalizePathname,
} from '../utils/issueLinkRouteUtils';

interface GitHubIssueLinkRecord {
  issueNumbers: number[];
  scope: IssueLinkScope;
  anchorRoute: string;
  updatedAt: string;
}

type GitHubIssueLinkStore = Record<string, GitHubIssueLinkRecord>;

type CachedGitHubIssue = {
  issue: GitHubIssueSummary;
  fetchedAt: number;
};
type GitHubIssueCache = Record<string, CachedGitHubIssue>;

const STORAGE_KEY = 'hale_commenting_github_issues_v1';
const CACHE_STORAGE_KEY = 'hale_commenting_github_issues_cache_v1';
const GH_ISSUES_PATH = '.hale/github-issues.json';
const CACHE_TTL_MS = 15 * 60 * 1000;

function safeParseStore(raw: string | null): GitHubIssueLinkStore {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: GitHubIssueLinkStore = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const rec = v as Partial<GitHubIssueLinkRecord>;
      const nums = Array.isArray(rec.issueNumbers)
        ? rec.issueNumbers.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
        : [];
      if (rec.scope !== 'page' && rec.scope !== 'section') continue;
      if (typeof rec.anchorRoute !== 'string' || typeof rec.updatedAt !== 'string') continue;
      out[k] = {
        issueNumbers: Array.from(new Set(nums)),
        scope: rec.scope,
        anchorRoute: rec.anchorRoute,
        updatedAt: rec.updatedAt,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function getStore(): GitHubIssueLinkStore {
  if (typeof window === 'undefined') return {};
  return safeParseStore(window.localStorage.getItem(STORAGE_KEY));
}

function setStore(next: GitHubIssueLinkStore) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function getIssueCache(): GitHubIssueCache {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as GitHubIssueCache;
  } catch {
    return {};
  }
}

function setIssueCache(cache: GitHubIssueCache) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache));
}

function getCachedIssue(num: number): GitHubIssueSummary | null {
  const key = String(num);
  const cache = getIssueCache();
  const cached = cache[key];
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.issue;
  delete cache[key];
  setIssueCache(cache);
  return null;
}

function setCachedIssue(num: number, issue: GitHubIssueSummary) {
  const cache = getIssueCache();
  cache[String(num)] = { issue, fetchedAt: Date.now() };
  setIssueCache(cache);
}

function loadForRoute(pathname: string): { record: GitHubIssueLinkRecord | null; source: 'page' | 'section' | null } {
  const store = getStore();
  const pageKey = getPageKey(pathname);
  if (store[pageKey]?.issueNumbers?.length) {
    return { record: store[pageKey], source: 'page' };
  }
  const sectionRoute = getSectionRoute(pathname);
  const sectionKey = getSectionKey(sectionRoute);
  if (store[sectionKey]?.issueNumbers?.length) {
    return { record: store[sectionKey], source: 'section' };
  }
  return { record: null, source: null };
}

function parseIssueNumbers(input: string, owner: string, repo: string): number[] {
  const o = owner.trim().toLowerCase();
  const r = repo.trim().toLowerCase();
  const urlRe = new RegExp(
    `github\\.com\\/${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/issues\\/(\\d+)`,
    'i',
  );
  const raw = input.trim();
  if (!raw) return [];
  const parts = raw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  const nums: number[] = [];
  for (const p of parts) {
    const plainRef = p.match(/^#?(\d+)$/);
    if (plainRef) {
      nums.push(Number(plainRef[1]));
      continue;
    }
    const m = p.match(urlRe);
    if (m?.[1]) {
      nums.push(Number(m[1]));
      continue;
    }
  }
  return Array.from(new Set(nums.filter((n) => Number.isFinite(n) && n > 0)));
}

function labelNames(labels: unknown[]): string[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l) => (typeof l === 'string' ? l : (l as { name?: string })?.name))
    .filter((n): n is string => typeof n === 'string');
}

export const GitHubIssuesTab: React.FunctionComponent = () => {
  const location = useLocation();
  const route = normalizePathname(location.pathname);
  const sectionRoute = getSectionRoute(route);
  const owner = getEnv('VITE_GITHUB_OWNER') || '';
  const repo = getEnv('VITE_GITHUB_REPO') || '';

  const [{ record, source }, setResolved] = React.useState(() => loadForRoute(route));
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftScope, setDraftScope] = React.useState<IssueLinkScope>('section');
  const [draftInput, setDraftInput] = React.useState('');

  const [isLoadingRemote, setIsLoadingRemote] = React.useState(false);
  const [remoteError, setRemoteError] = React.useState<string | null>(null);
  const remoteShaRef = React.useRef<string | undefined>(undefined);

  const [isFetchingIssues, setIsFetchingIssues] = React.useState(false);
  const [issues, setIssues] = React.useState<Record<number, GitHubIssueSummary>>({});
  const [issueErrors, setIssueErrors] = React.useState<Record<number, string>>({});

  React.useEffect(() => {
    setResolved(loadForRoute(route));
    setIsEditing(false);
  }, [route]);

  React.useEffect(() => {
    const load = async () => {
      if (!isGitHubConfigured()) return;
      setIsLoadingRemote(true);
      setRemoteError(null);
      try {
        const local = getStore();
        const res = await githubAdapter.getRepoFile(GH_ISSUES_PATH);
        if (!res.success) {
          setRemoteError(res.error || 'Failed to load GitHub issue links from repo');
          return;
        }
        if (!res.data) {
          if (Object.keys(local).length > 0) {
            const created = await githubAdapter.putRepoFile({
              path: GH_ISSUES_PATH,
              text: JSON.stringify(local, null, 2) + '\n',
              message: 'chore(issues): initialize github issue links store',
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

  React.useEffect(() => {
    const nums = record?.issueNumbers || [];
    if (nums.length === 0) {
      setIssues({});
      setIssueErrors({});
      return;
    }

    const run = async () => {
      if (!isGitHubConfigured()) {
        setIssues({});
        setIssueErrors({});
        return;
      }
      setIsFetchingIssues(true);
      setIssueErrors({});
      const results: Record<number, GitHubIssueSummary> = {};
      const errors: Record<number, string> = {};
      const toFetch: number[] = [];

      for (const n of nums) {
        const cached = getCachedIssue(n);
        if (cached) results[n] = cached;
        else toFetch.push(n);
      }

      await Promise.all(
        toFetch.map(async (n) => {
          const res = await githubAdapter.getIssue(n);
          if (res.success && res.data) {
            results[n] = res.data;
            setCachedIssue(n, res.data);
          } else {
            errors[n] = res.error || 'Failed to fetch issue';
          }
        }),
      );

      setIssues(results);
      setIssueErrors(errors);
      setIsFetchingIssues(false);
    };

    void run();
  }, [record?.issueNumbers]);

  const persistToGitHub = React.useCallback(async (nextStore: GitHubIssueLinkStore, message: string) => {
    if (!isGitHubConfigured()) return;
    const text = JSON.stringify(nextStore, null, 2) + '\n';
    const sha = remoteShaRef.current;
    const write = await githubAdapter.putRepoFile({ path: GH_ISSUES_PATH, text, message, sha });
    if (write.success && write.data?.sha) {
      remoteShaRef.current = write.data.sha;
      setRemoteError(null);
      return;
    }
    const refreshed = await githubAdapter.getRepoFile(GH_ISSUES_PATH);
    if (refreshed.success && refreshed.data?.sha) {
      remoteShaRef.current = refreshed.data.sha;
      const retry = await githubAdapter.putRepoFile({
        path: GH_ISSUES_PATH,
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
    setRemoteError(write.error || 'Failed to save GitHub issue links to repo');
  }, []);

  const startNew = () => {
    setDraftScope('section');
    setDraftInput('');
    setIsEditing(true);
  };

  const startEdit = (mode: 'edit-existing' | 'override-page') => {
    if (mode === 'override-page') {
      setDraftScope('page');
      setDraftInput(record?.issueNumbers.join(', ') ?? '');
      setIsEditing(true);
      return;
    }
    setDraftScope(record?.scope ?? 'section');
    setDraftInput(record?.issueNumbers.join(', ') ?? '');
    setIsEditing(true);
  };

  const save = () => {
    const numbers = parseIssueNumbers(draftInput, owner, repo);
    if (numbers.length === 0) return;

    const next: GitHubIssueLinkRecord = {
      issueNumbers: numbers,
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

    void persistToGitHub(nextStore, `chore(issues): update GitHub issue links ${key}`);
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
    void persistToGitHub(rest, `chore(issues): remove GitHub issue links ${keyToRemove}`);
  };

  const removeNumber = (num: number) => {
    const store = getStore();
    const storeKey = source === 'page' ? getPageKey(route) : source === 'section' ? getSectionKey(sectionRoute) : null;
    if (!storeKey || !record) return;

    const updatedNums = record.issueNumbers.filter((n) => n !== num);
    if (updatedNums.length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [storeKey]: _r, ...rest } = store;
      setStore(rest);
      setResolved(loadForRoute(route));
      void persistToGitHub(rest, `chore(issues): remove all GitHub issue links for ${storeKey}`);
    } else {
      const updated: GitHubIssueLinkRecord = {
        ...record,
        issueNumbers: updatedNums,
        updatedAt: new Date().toISOString(),
      };
      const nextStore = { ...store, [storeKey]: updated };
      setStore(nextStore);
      setResolved(loadForRoute(route));
      void persistToGitHub(nextStore, `chore(issues): remove #${num} from ${storeKey}`);
    }
  };

  const remoteStatusLine = isGitHubConfigured()
    ? isLoadingRemote
      ? 'Loading issue links from GitHub…'
      : remoteError
        ? `GitHub sync: ${remoteError}`
        : 'GitHub sync enabled'
    : 'Sign in and set owner/repo to sync issue links to the repository.';

  const isInherited = source === 'section' && record?.anchorRoute !== route;

  if (!isGitHubConfigured()) {
    return (
      <EmptyState icon={InfoCircleIcon} titleText="GitHub not configured" headingLevel="h3">
        <EmptyStateBody>
          Sign in with GitHub and set <b>VITE_GITHUB_OWNER</b> and <b>VITE_GITHUB_REPO</b> to link issues for this app
          repo.
        </EmptyStateBody>
      </EmptyState>
    );
  }

  if (!record && !isEditing) {
    return (
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <Title headingLevel="h3" size="lg">
              GitHub issues
            </Title>
            <div style={{ fontSize: '0.875rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
              No issues linked for <b>{route}</b> in <b>{owner}/{repo}</b>.
            </div>
            {remoteStatusLine && (
              <div style={{ fontSize: '0.75rem', color: 'var(--pf-t--global--text--color--subtle)', marginTop: '0.25rem' }}>
                {remoteStatusLine}
              </div>
            )}
          </div>
          <Button variant="primary" onClick={startNew}>
            Add GitHub issue
          </Button>
        </div>

        <EmptyState icon={InfoCircleIcon} titleText="No GitHub issues linked" headingLevel="h3">
          <EmptyStateBody>
            Use <b>Add GitHub issue</b> above, or add numbers like <b>#42</b> and issue URLs for <b>{owner}/{repo}</b>.
            Multiple values: commas or new lines.
          </EmptyStateBody>
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
              {record ? 'Edit GitHub issue links' : 'Add GitHub issue'}
            </Title>
            <div style={{ fontSize: '0.875rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
              Applies to: <b>{effectiveAnchor}</b> · Repo: <b>{owner}/{repo}</b>
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
              Issues
            </Title>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div>
                <div style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                  <b>Issue numbers or URLs</b>
                  <div style={{ fontSize: '0.75rem', color: 'var(--pf-t--global--text--color--subtle)', marginTop: '0.25rem' }}>
                    Only {owner}/{repo} URLs are accepted (e.g. https://github.com/{owner}/{repo}/issues/1)
                  </div>
                </div>
                <TextArea
                  value={draftInput}
                  onChange={(_e, v) => setDraftInput(v)}
                  aria-label="GitHub issue numbers or URLs"
                  rows={3}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-start', marginTop: '0.5rem' }}>
                <Button
                  variant="primary"
                  onClick={save}
                  isDisabled={parseIssueNumbers(draftInput, owner, repo).length === 0}
                >
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

  if (!record) {
    return null;
  }

  const scopeLabel =
    source === 'page' ? 'This page' : source === 'section' ? `Section (${sectionRoute}/*)` : null;
  const nums = record.issueNumbers || [];

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <Title headingLevel="h3" size="lg">
            GitHub issues
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

      {isFetchingIssues && nums.length > 0 && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
          <Spinner size="sm" /> <span>Fetching issue details…</span>
        </div>
      )}

      <div style={{ display: 'grid', gap: '1rem' }}>
        {nums.map((num) => {
          const issue = issues[num];
          const error = issueErrors[num];
          const url = issue?.html_url || `https://github.com/${owner}/${repo}/issues/${num}`;
          const labs = issue ? labelNames(issue.labels) : [];

          return (
            <Card key={num}>
              <CardBody>
                <div style={{ display: 'grid', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <Label color="blue" isCompact>
                        #{num}
                      </Label>
                      {issue?.state && (
                        <Label color={issue.state === 'open' ? 'green' : 'grey'} isCompact>
                          {issue.state}
                        </Label>
                      )}
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontWeight: 600 }}
                      >
                        Open in GitHub <ExternalLinkAltIcon style={{ fontSize: '0.75rem' }} />
                      </a>
                    </div>
                    {nums.length > 1 && (
                      <Button variant="link" isDanger onClick={() => removeNumber(num)}>
                        Remove
                      </Button>
                    )}
                  </div>

                  {error && !isFetchingIssues && (
                    <div style={{ fontSize: '0.875rem', color: 'var(--pf-t--global--danger--color--100)' }}>{error}</div>
                  )}

                  {!error && issue && (
                    <>
                      <Title headingLevel="h3" size="lg" style={{ marginTop: '0.25rem' }}>
                        {issue.title || '—'}
                      </Title>
                      {labs.length > 0 && (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {labs.map((name) => (
                            <Label key={name} isCompact>
                              {name}
                            </Label>
                          ))}
                        </div>
                      )}
                      {issue.body && (
                        <div>
                          <Title headingLevel="h4" size="md" style={{ marginBottom: '0.5rem' }}>
                            Description
                          </Title>
                          <div style={{ fontSize: '0.875rem', whiteSpace: 'pre-wrap', maxHeight: '12rem', overflow: 'auto' }}>
                            {issue.body}
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
          Remove all GitHub issue links
        </Button>
      </div>
    </div>
  );
};
