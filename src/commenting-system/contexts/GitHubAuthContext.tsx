import * as React from 'react';
import { GitHubUser, clearGitHubAuth, getStoredUser, storeGitHubAuth } from '../services/githubAdapter';

interface GitHubAuthContextType {
  user: GitHubUser | null;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
}

const GitHubAuthContext = React.createContext<GitHubAuthContextType | undefined>(undefined);

export const GitHubAuthProvider: React.FunctionComponent<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = React.useState<GitHubUser | null>(null);

  React.useEffect(() => {
    const stored = getStoredUser();
    if (stored) setUser(stored);
  }, []);

  // Handle local dev OAuth callback via hash: /#/auth-callback?token=...&login=...&avatar=...
  React.useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes('#/auth-callback')) return;

    const query = hash.split('?')[1] || '';
    const params = new URLSearchParams(query);
    const token = params.get('token');
    const login = params.get('login');
    const avatar = params.get('avatar');

    if (token && login && avatar) {
      const decodedUser = { login, avatar: decodeURIComponent(avatar) };
      storeGitHubAuth(token, decodedUser);
      setUser(decodedUser);
    }

    // remove hash and return to home
    window.location.hash = '/';
  }, []);

  const login = () => {
    let clientId: string | undefined;
    try {
      clientId = typeof process !== 'undefined' && process.env ? process.env.VITE_GITHUB_CLIENT_ID : undefined;
    } catch {
      clientId = undefined;
    }
    if (!clientId) {
      // eslint-disable-next-line no-alert
      alert('GitHub login is not configured (missing VITE_GITHUB_CLIENT_ID).');
      return;
    }

    const redirectUri = `${window.location.origin}/api/github-oauth-callback`;
    // Use 'repo' scope for full access (works with both public and private repos)
    // Use 'public_repo' only if you only need public repo access
    const scope = 'repo';

    const url =
      `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scope)}`;

    console.log('🔑 GitHub OAuth URL:', url);
    console.log('📋 Scope requested:', scope);

    window.location.href = url;
  };

  const logout = () => {
    clearGitHubAuth();
    setUser(null);
  };

  return (
    <GitHubAuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
      {children}
    </GitHubAuthContext.Provider>
  );
};

export const useGitHubAuth = (): GitHubAuthContextType => {
  const ctx = React.useContext(GitHubAuthContext);
  if (!ctx) throw new Error('useGitHubAuth must be used within a GitHubAuthProvider');
  return ctx;
};


