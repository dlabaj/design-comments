import * as React from 'react';
import { useLocation } from 'react-router-dom';
import {
  ActionList,
  ActionListItem,
  Button,
  Card,
  CardBody,
  TextArea,
  Title,
} from '@patternfly/react-core';
import { githubAdapter, isGitHubConfigured } from '../services/githubAdapter';

type DetailsScope = 'page' | 'section';

interface DetailsRecord {
  designGoal: string;
  primaryGoals: string;
  keyFeaturesBeingValidated: string;
  targetedUsers: string;
  scope: DetailsScope;
  // the route this record is anchored to; for section scope it will be the section root (e.g. "/support")
  anchorRoute: string;
  updatedAt: string;
}

type DetailsStore = Record<string, DetailsRecord>;

const STORAGE_KEY = 'hale_commenting_details_v1';
const GH_DETAILS_PATH = '.hale/details.json';

function safeParseStore(raw: string | null): DetailsStore {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as DetailsStore;
  } catch {
    return {};
  }
}

function getStore(): DetailsStore {
  if (typeof window === 'undefined') return {};
  return safeParseStore(window.localStorage.getItem(STORAGE_KEY));
}

function setStore(next: DetailsStore) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function normalizePathname(pathname: string): string {
  if (!pathname) return '/';
  const cleaned = pathname.split('?')[0].split('#')[0];
  return cleaned === '' ? '/' : cleaned;
}

function getSectionRoute(pathname: string): string {
  const normalized = normalizePathname(pathname);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return '/';
  return `/${parts[0]}`;
}

function getPageKey(pathname: string): string {
  return `page:${normalizePathname(pathname)}`;
}

function getSectionKey(sectionRoute: string): string {
  return `section:${normalizePathname(sectionRoute)}/*`;
}

function loadForRoute(pathname: string): { record: DetailsRecord | null; source: 'page' | 'section' | null } {
  const store = getStore();
  const pageKey = getPageKey(pathname);
  if (store[pageKey]) return { record: coerceRecord(store[pageKey]), source: 'page' };

  const sectionRoute = getSectionRoute(pathname);
  const sectionKey = getSectionKey(sectionRoute);
  if (store[sectionKey]) return { record: coerceRecord(store[sectionKey]), source: 'section' };

  return { record: null, source: null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON store payloads are loosely typed
function isStructuredRecord(r: any): r is DetailsRecord {
  return (
    r &&
    typeof r === 'object' &&
    typeof r.designGoal === 'string' &&
    typeof r.primaryGoals === 'string' &&
    typeof r.keyFeaturesBeingValidated === 'string' &&
    typeof r.targetedUsers === 'string' &&
    (r.scope === 'page' || r.scope === 'section') &&
    typeof r.anchorRoute === 'string' &&
    typeof r.updatedAt === 'string'
  );
}

/**
 * Backward compatibility: older drafts may have { title, body }.
 * We keep them by mapping `body` into Design Goal (best-effort) and leaving the rest blank.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON store payloads are loosely typed
function coerceRecord(raw: any): DetailsRecord {
  if (isStructuredRecord(raw)) return raw;

  const legacyBody = typeof raw?.body === 'string' ? raw.body : '';
  const legacyScope: DetailsScope = raw?.scope === 'page' || raw?.scope === 'section' ? raw.scope : 'section';
  const legacyAnchor = typeof raw?.anchorRoute === 'string' ? raw.anchorRoute : '/';
  const legacyUpdatedAt = typeof raw?.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString();

  return {
    designGoal: legacyBody,
    primaryGoals: '',
    keyFeaturesBeingValidated: '',
    targetedUsers: '',
    scope: legacyScope,
    anchorRoute: legacyAnchor,
    updatedAt: legacyUpdatedAt,
  };
}

export const DetailsTab: React.FunctionComponent = () => {
  const location = useLocation();
  const route = normalizePathname(location.pathname);
  const sectionRoute = getSectionRoute(route);

  const [{ record, source }, setResolved] = React.useState(() => loadForRoute(route));
  const [isEditing, setIsEditing] = React.useState(false);
  const [isLoadingRemote, setIsLoadingRemote] = React.useState(false);
  const [remoteError, setRemoteError] = React.useState<string | null>(null);
  const remoteShaRef = React.useRef<string | undefined>(undefined);

  // editable draft state
  const [draftScope, setDraftScope] = React.useState<DetailsScope>('section');
  const [draftDesignGoal, setDraftDesignGoal] = React.useState('');
  const [draftPrimaryGoals, setDraftPrimaryGoals] = React.useState('');
  const [draftKeyFeaturesBeingValidated, setDraftKeyFeaturesBeingValidated] = React.useState('');
  const [draftTargetedUsers, setDraftTargetedUsers] = React.useState('');

  React.useEffect(() => {
    // when navigating, refresh resolved record and exit edit mode
    setResolved(loadForRoute(route));
    setIsEditing(false);
  }, [route]);

  // Load Details from GitHub (source of truth) when authenticated; keep localStorage as cache/fallback.
  React.useEffect(() => {
    const load = async () => {
      if (!isGitHubConfigured()) return;
      setIsLoadingRemote(true);
      setRemoteError(null);
      try {
        const local = getStore();
        const res = await githubAdapter.getRepoFile(GH_DETAILS_PATH);
        if (!res.success) {
          setRemoteError(res.error || 'Failed to load details from GitHub');
          return;
        }

        if (!res.data) {
          // No remote file yet. If we already have local details, publish them as the initial remote.
          if (Object.keys(local).length > 0) {
            const created = await githubAdapter.putRepoFile({
              path: GH_DETAILS_PATH,
              text: JSON.stringify(local, null, 2) + '\n',
              message: 'chore(details): initialize details store',
            });
            if (created.success) {
              remoteShaRef.current = created.data?.sha;
            }
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

  const startNew = () => {
    setDraftScope('section');
    setDraftDesignGoal('');
    setDraftPrimaryGoals('');
    setDraftKeyFeaturesBeingValidated('');
    setDraftTargetedUsers('');
    setIsEditing(true);
  };

  const startEdit = (mode: 'edit-existing' | 'override-page') => {
    if (mode === 'override-page') {
      // copy inherited section record into a page-scoped override draft
      setDraftScope('page');
      setDraftDesignGoal(record?.designGoal ?? '');
      setDraftPrimaryGoals(record?.primaryGoals ?? '');
      setDraftKeyFeaturesBeingValidated(record?.keyFeaturesBeingValidated ?? '');
      setDraftTargetedUsers(record?.targetedUsers ?? '');
      setIsEditing(true);
      return;
    }

    // edit existing record as-is
    const existingScope: DetailsScope = record?.scope ?? 'section';
    setDraftScope(existingScope);
    setDraftDesignGoal(record?.designGoal ?? '');
    setDraftPrimaryGoals(record?.primaryGoals ?? '');
    setDraftKeyFeaturesBeingValidated(record?.keyFeaturesBeingValidated ?? '');
    setDraftTargetedUsers(record?.targetedUsers ?? '');
    setIsEditing(true);
  };

  const save = () => {
    const next: DetailsRecord = {
      designGoal: draftDesignGoal,
      primaryGoals: draftPrimaryGoals,
      keyFeaturesBeingValidated: draftKeyFeaturesBeingValidated,
      targetedUsers: draftTargetedUsers,
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

    // Best-effort: persist to GitHub as a repo file so designers/admins can edit outside the codebase.
    if (isGitHubConfigured()) {
      (async () => {
        const text = JSON.stringify(nextStore, null, 2) + '\n';
        const message = `chore(details): update ${key}`;
        const sha = remoteShaRef.current;

        const write = await githubAdapter.putRepoFile({ path: GH_DETAILS_PATH, text, message, sha });
        if (write.success && write.data?.sha) {
          remoteShaRef.current = write.data.sha;
          setRemoteError(null);
          return;
        }

        // If sha mismatch (someone else updated), refetch and retry once.
        const refreshed = await githubAdapter.getRepoFile(GH_DETAILS_PATH);
        if (refreshed.success && refreshed.data?.sha) {
          remoteShaRef.current = refreshed.data.sha;
          const retry = await githubAdapter.putRepoFile({ path: GH_DETAILS_PATH, text, message, sha: refreshed.data.sha });
          if (retry.success && retry.data?.sha) {
            remoteShaRef.current = retry.data.sha;
            setRemoteError(null);
            return;
          }
        }

        setRemoteError(write.error || 'Failed to save details to GitHub');
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
        const message = `chore(details): remove ${keyToRemove}`;
        const sha = remoteShaRef.current;
        const write = await githubAdapter.putRepoFile({ path: GH_DETAILS_PATH, text, message, sha });
        if (write.success && write.data?.sha) {
          remoteShaRef.current = write.data.sha;
          setRemoteError(null);
          return;
        }
        setRemoteError(write.error || 'Failed to update details in GitHub');
      })();
    }
  };

  const scopeLabel =
    source === 'page'
      ? 'This page'
      : source === 'section'
        ? `Section (${sectionRoute}/*)`
        : null;

  const remoteStatusLine = isGitHubConfigured()
    ? isLoadingRemote
      ? 'Loading details from GitHub…'
      : remoteError
        ? `GitHub sync: ${remoteError}`
        : 'GitHub sync enabled'
    : null;

  if (!record && !isEditing) {
    return (
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <Title headingLevel="h3" size="lg">
              Details
            </Title>
            <div style={{ fontSize: '0.875rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
              No details set for <b>{route}</b>.
            </div>
            {remoteStatusLine && (
              <div style={{ fontSize: '0.75rem', color: 'var(--pf-t--global--text--color--subtle)', marginTop: '0.25rem' }}>
                {remoteStatusLine}
              </div>
            )}
          </div>
          <Button variant="primary" onClick={startNew}>
            Add details
          </Button>
        </div>

        <Card>
          <CardBody>
            <div style={{ fontSize: '0.875rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
              Add designer notes, design goals, links, and context for reviewers.
            </div>
          </CardBody>
        </Card>
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
              Edit details
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
            <Button
              variant={draftScope === 'page' ? 'primary' : 'secondary'}
              onClick={() => setDraftScope('page')}
            >
              This page only
            </Button>
            <Button
              variant={draftScope === 'section' ? 'primary' : 'secondary'}
              onClick={() => setDraftScope('section')}
              isDisabled={sectionRoute === '/' && route === '/'}
            >
              This section ({sectionRoute}
              {'/*'})
            </Button>
          </div>
        </div>

        <Card>
          <CardBody>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div>
                <div style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                  <b>Design Goal</b>
                </div>
                <TextArea
                  aria-label="Design goal"
                  value={draftDesignGoal}
                  onChange={(_e, v) => setDraftDesignGoal(v)}
                  rows={3}
                />
              </div>

              <div>
                <div style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                  <b>Primary Goal(s)</b>
                </div>
                <TextArea
                  aria-label="Primary goals"
                  value={draftPrimaryGoals}
                  onChange={(_e, v) => setDraftPrimaryGoals(v)}
                  rows={4}
                />
              </div>

              <div>
                <div style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                  <b>Key Feature(s) Being Validated</b>
                </div>
                <TextArea
                  aria-label="Key features being validated"
                  value={draftKeyFeaturesBeingValidated}
                  onChange={(_e, v) => setDraftKeyFeaturesBeingValidated(v)}
                  rows={4}
                />
              </div>

              <div>
                <div style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                  <b>Targeted User(s)</b>
                </div>
                <TextArea
                  aria-label="Targeted users"
                  value={draftTargetedUsers}
                  onChange={(_e, v) => setDraftTargetedUsers(v)}
                  rows={4}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Button variant="primary" onClick={save}>
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

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <Title headingLevel="h3" size="lg">
            Details
          </Title>
          {scopeLabel && (
            <div style={{ fontSize: '0.875rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
              Source: <b>{scopeLabel}</b>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {source === 'section' && (
            <Button variant="secondary" onClick={() => startEdit('override-page')}>
              Override for this page
            </Button>
          )}
          <Button variant="secondary" onClick={() => startEdit('edit-existing')}>
            Edit
          </Button>
        </div>
      </div>

      <Card>
        <CardBody>
          <Title headingLevel="h4" size="md">
            Design Goal
          </Title>
          <div style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>{record.designGoal || '—'}</div>

          <Title headingLevel="h4" size="md" style={{ marginTop: '1rem' }}>
            Primary Goal(s)
          </Title>
          <div style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>{record.primaryGoals || '—'}</div>

          <Title headingLevel="h4" size="md" style={{ marginTop: '1rem' }}>
            Key Feature(s) Being Validated
          </Title>
          <div style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>{record.keyFeaturesBeingValidated || '—'}</div>

          <Title headingLevel="h4" size="md" style={{ marginTop: '1rem' }}>
            Targeted User(s)
          </Title>
          <div style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>{record.targetedUsers || '—'}</div>

          <div style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
            Updated: {new Date(record.updatedAt).toLocaleString()}
          </div>

          <ActionList style={{ marginTop: '0.75rem' }}>
            <ActionListItem>
              <Button variant="link" isDanger onClick={remove}>
                Remove
              </Button>
            </ActionListItem>
          </ActionList>
        </CardBody>
      </Card>
    </div>
  );
};


