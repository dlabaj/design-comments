import { getEnv } from '../utils/env';

export interface GitHubUser {
  login: string;
  avatar: string;
}

export const GITHUB_TOKEN_STORAGE_KEY = 'github_access_token';
export const GITHUB_USER_STORAGE_KEY = 'github_user';

export const storeGitHubAuth = (token: string, user: GitHubUser) => {
  localStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, token);
  localStorage.setItem(GITHUB_USER_STORAGE_KEY, JSON.stringify(user));
};

export const clearGitHubAuth = () => {
  localStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
  localStorage.removeItem(GITHUB_USER_STORAGE_KEY);
};

export const getStoredToken = (): string | null => {
  return localStorage.getItem(GITHUB_TOKEN_STORAGE_KEY);
};

export const getStoredUser = (): GitHubUser | null => {
  const raw = localStorage.getItem(GITHUB_USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GitHubUser;
  } catch {
    return null;
  }
};

export const isGitHubConfigured = (): boolean => {
  const owner = getEnv('VITE_GITHUB_OWNER');
  const repo = getEnv('VITE_GITHUB_REPO');
  return Boolean(getStoredToken() && owner && repo);
};

export const diagnoseGitHubSetup = () => {
  const token = getStoredToken();
  const user = getStoredUser();
  const owner = getEnv('VITE_GITHUB_OWNER');
  const repo = getEnv('VITE_GITHUB_REPO');

  console.log('🔍 GitHub Configuration Diagnostic:');
  console.log('  Token:', token ? `Present (${token.substring(0, 10)}...)` : 'Missing ❌');
  console.log('  User:', user ? `${user.login}` : 'Not logged in ❌');
  console.log('  Owner:', owner || 'Missing ❌');
  console.log('  Repo:', repo || 'Missing ❌');
  console.log('  Full repo path:', owner && repo ? `${owner}/${repo}` : 'Incomplete ❌');
  console.log('\n💡 To fix 403 Forbidden error:');
  console.log('  1. Make sure you have write access to the repository');
  console.log('  2. Check that issues are enabled on the repository');
  console.log('  3. Re-authenticate to get a fresh token with correct scopes');
  console.log('  4. Token needs "repo" scope for private repos or "public_repo" for public repos');

  return {
    hasToken: !!token,
    hasUser: !!user,
    hasOwner: !!owner,
    hasRepo: !!repo,
    isComplete: !!(token && user && owner && repo)
  };
};

export interface GitHubResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Subset of GitHub issue JSON for the Issues/Tickets linking UI. */
export interface GitHubIssueSummary {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body?: string;
  labels: unknown[];
}

async function githubProxyRequest(method: string, endpoint: string, data?: any): Promise<any> {
  const token = getStoredToken();
  if (!token) {
    throw new Error('Not authenticated with GitHub');
  }

  console.log(`🔵 GitHub API Request:`, { method, endpoint, hasData: !!data });

  const resp = await fetch('/api/github-api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, method, endpoint, data }),
  });

  const payload = await resp.json();

  console.log(`🔵 GitHub API Response:`, {
    status: resp.status,
    ok: resp.ok,
    payload
  });

  if (!resp.ok) {
    const message = (payload && (payload.message || payload.error)) || `GitHub API error (${resp.status})`;

    if (resp.status === 403) {
      console.error(`❌ 403 Forbidden - Possible causes:
        1. Token doesn't have 'repo' or 'public_repo' scope
        2. You don't have write access to the repository
        3. Issues are disabled on the repository
        4. Token has expired or been revoked

        Current config:
        - Owner: ${getEnv('VITE_GITHUB_OWNER')}
        - Repo: ${getEnv('VITE_GITHUB_REPO')}
        - Endpoint: ${endpoint}
      `);
    }

    throw new Error(message);
  }
  return payload;
}

const encodePath = (path: string): string => {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
};

const base64EncodeUtf8 = (input: string): string => {
  // btoa expects latin1; convert safely for utf-8
  return btoa(unescape(encodeURIComponent(input)));
};

const base64DecodeUtf8 = (input: string): string => {
  return decodeURIComponent(escape(atob(input)));
};

const getLabelNames = (issue: any): string[] => {
  const labels = issue?.labels;
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l: any) => (typeof l === 'string' ? l : l?.name))
    .filter((n: any) => typeof n === 'string');
};

const issueHasAnyVersion = (issue: any): boolean => {
  const labelNames = getLabelNames(issue);
  if (labelNames.some((n) => n.startsWith('version:'))) return true;
  const body: string = issue?.body || '';
  return body.includes('Version:');
};

export const githubAdapter = {
  async createIssue(params: {
    title: string;
    body: string;
    route: string;
    cssSelector?: string;
    elementDescription?: string;
    xPercent: number;
    yPercent: number;
    version?: string;
  }): Promise<GitHubResult<{ number: number; html_url: string }>> {
    if (!isGitHubConfigured()) return { success: false, error: 'Please sign in with GitHub' };

    const owner = getEnv('VITE_GITHUB_OWNER');
    const repo = getEnv('VITE_GITHUB_REPO');

    try {
      const metadata = [
        `- Route: \`${params.route}\``,
        params.version ? `- Version: \`${params.version}\`` : null,
        params.cssSelector ? `- Target Component: \`${params.elementDescription || 'unknown'}\`` : null,
        params.cssSelector ? `- CSS Selector: \`${params.cssSelector}\`` : null,
        `- Fallback Position: \`(${params.xPercent.toFixed(1)}%, ${params.yPercent.toFixed(1)}%)\``,
      ]
        .filter(Boolean)
        .join('\n');

      const issueBody = {
        title: params.title,
        body: `${params.body}\n\n---\n**Metadata:**\n${metadata}`,
      };

      const data = await githubProxyRequest('POST', `/repos/${owner}/${repo}/issues`, issueBody);

      // Add helpful labels (non-fatal if it fails)
      try {
        const labels: string[] = [
          'hale-comment',
          `route:${params.route}`,
        ];
        if (params.cssSelector && params.elementDescription) {
          labels.push(`component:${params.elementDescription}`);
        }
        labels.push(`coords:${Math.round(params.xPercent)},${Math.round(params.yPercent)}`);
        if (params.version) labels.push(`version:${params.version}`);
        await githubProxyRequest('POST', `/repos/${owner}/${repo}/issues/${data.number}/labels`, { labels });
      } catch {
        // ignore label failures
      }

      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to create issue' };
    }
  },

  async createComment(issueNumber: number, body: string): Promise<GitHubResult> {
    if (!isGitHubConfigured()) return { success: false, error: 'Please sign in with GitHub' };
    const owner = getEnv('VITE_GITHUB_OWNER');
    const repo = getEnv('VITE_GITHUB_REPO');

    try {
      const data = await githubProxyRequest('POST', `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { body });
      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to create comment' };
    }
  },

  async fetchIssuesForRoute(route: string): Promise<GitHubResult<any[]>> {
    return githubAdapter.fetchIssuesForRouteAndVersion(route);
  },

  async getIssue(issueNumber: number): Promise<GitHubResult<GitHubIssueSummary>> {
    if (!isGitHubConfigured()) return { success: false, error: 'Please sign in with GitHub' };
    const owner = getEnv('VITE_GITHUB_OWNER');
    const repo = getEnv('VITE_GITHUB_REPO');
    try {
      const data = await githubProxyRequest('GET', `/repos/${owner}/${repo}/issues/${issueNumber}`);
      return {
        success: true,
        data: {
          number: data.number as number,
          title: String(data.title ?? ''),
          state: String(data.state ?? ''),
          html_url: String(data.html_url ?? ''),
          body: typeof data.body === 'string' ? data.body : undefined,
          labels: Array.isArray(data.labels) ? data.labels : [],
        },
      };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to fetch issue' };
    }
  },

  async fetchIssuesForRouteAndVersion(route: string, version?: string): Promise<GitHubResult<any[]>> {
    if (!isGitHubConfigured()) return { success: false, error: 'Please sign in with GitHub' };
    const owner = getEnv('VITE_GITHUB_OWNER');
    const repo = getEnv('VITE_GITHUB_REPO');
    try {
      const data = await githubProxyRequest(
        'GET',
        `/repos/${owner}/${repo}/issues?state=all&per_page=100`,
      );
      // Filter by metadata OR labels (route:${route}), and optionally by version
      const filtered = (Array.isArray(data) ? data : [])
        .filter((issue: any) => {
          const body: string = issue?.body || '';
          const labels = getLabelNames(issue);
          const bodyMatch = body.includes(`Route: \`${route}\``);
          const labelMatch = labels.includes(`route:${route}`);
          return bodyMatch || labelMatch;
        })
        .filter((issue: any) => {
          if (!version) return true;

          const labels = getLabelNames(issue);
          const body: string = issue?.body || '';
          const versionLabelMatch = labels.includes(`version:${version}`);
          const bodyVersionMatch = body.includes(`Version: \`${version}\``);

          // Back-compat: if an issue has no version metadata at all, treat it as default "1"
          if (!issueHasAnyVersion(issue) && version === '1') return true;

          return versionLabelMatch || bodyVersionMatch;
        });
      return { success: true, data: filtered };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to fetch issues' };
    }
  },

  async fetchIssueComments(issueNumber: number): Promise<GitHubResult<any[]>> {
    if (!isGitHubConfigured()) return { success: false, error: 'Please sign in with GitHub' };
    const owner = getEnv('VITE_GITHUB_OWNER');
    const repo = getEnv('VITE_GITHUB_REPO');
    try {
      const data = await githubProxyRequest(
        'GET',
        `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`,
      );
      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to fetch issue comments' };
    }
  },

  async updateComment(commentId: number, body: string): Promise<GitHubResult> {
    if (!isGitHubConfigured()) return { success: false, error: 'Please sign in with GitHub' };
    const owner = getEnv('VITE_GITHUB_OWNER');
    const repo = getEnv('VITE_GITHUB_REPO');
    try {
      const data = await githubProxyRequest('PATCH', `/repos/${owner}/${repo}/issues/comments/${commentId}`, { body });
      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to update comment' };
    }
  },

  async deleteComment(commentId: number): Promise<GitHubResult> {
    if (!isGitHubConfigured()) return { success: false, error: 'Please sign in with GitHub' };
    const owner = getEnv('VITE_GITHUB_OWNER');
    const repo = getEnv('VITE_GITHUB_REPO');
    try {
      await githubProxyRequest('DELETE', `/repos/${owner}/${repo}/issues/comments/${commentId}`);
      return { success: true, data: {} };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to delete comment' };
    }
  },

  async closeIssue(issueNumber: number): Promise<GitHubResult> {
    if (!isGitHubConfigured()) return { success: false, error: 'Please sign in with GitHub' };
    const owner = getEnv('VITE_GITHUB_OWNER');
    const repo = getEnv('VITE_GITHUB_REPO');
    try {
      const data = await githubProxyRequest('PATCH', `/repos/${owner}/${repo}/issues/${issueNumber}`, { state: 'closed' });
      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to close issue' };
    }
  },

  async reopenIssue(issueNumber: number): Promise<GitHubResult> {
    if (!isGitHubConfigured()) return { success: false, error: 'Please sign in with GitHub' };
    const owner = getEnv('VITE_GITHUB_OWNER');
    const repo = getEnv('VITE_GITHUB_REPO');
    try {
      const data = await githubProxyRequest('PATCH', `/repos/${owner}/${repo}/issues/${issueNumber}`, { state: 'open' });
      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to reopen issue' };
    }
  },

  async getRepoFile(path: string): Promise<GitHubResult<{ text: string; sha: string } | null>> {
    if (!isGitHubConfigured()) return { success: false, error: 'Please sign in with GitHub' };
    const owner = getEnv('VITE_GITHUB_OWNER');
    const repo = getEnv('VITE_GITHUB_REPO');
    try {
      const data = await githubProxyRequest('GET', `/repos/${owner}/${repo}/contents/${encodePath(path)}`);
      const content = typeof data?.content === 'string' ? data.content.replace(/\n/g, '') : '';
      const sha = data?.sha as string | undefined;
      if (!content || !sha) return { success: true, data: null };
      const text = base64DecodeUtf8(content);
      return { success: true, data: { text, sha } };
    } catch (e: any) {
      // If file doesn't exist yet, treat as empty
      if (String(e?.message || '').toLowerCase().includes('not found')) {
        return { success: true, data: null };
      }
      return { success: false, error: e?.message || 'Failed to read repo file' };
    }
  },

  async putRepoFile(params: {
    path: string;
    text: string;
    message: string;
    sha?: string;
  }): Promise<GitHubResult<{ sha: string }>> {
    if (!isGitHubConfigured()) return { success: false, error: 'Please sign in with GitHub' };
    const owner = getEnv('VITE_GITHUB_OWNER');
    const repo = getEnv('VITE_GITHUB_REPO');
    try {
      const payload: any = {
        message: params.message,
        content: base64EncodeUtf8(params.text),
      };
      if (params.sha) payload.sha = params.sha;
      const data = await githubProxyRequest(
        'PUT',
        `/repos/${owner}/${repo}/contents/${encodePath(params.path)}`,
        payload,
      );
      const newSha = data?.content?.sha as string | undefined;
      return { success: true, data: { sha: newSha || params.sha || '' } };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to write repo file' };
    }
  },
};


