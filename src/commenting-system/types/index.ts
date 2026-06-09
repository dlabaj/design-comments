export interface Comment {
  id: string;
  author?: string;
  text: string;
  createdAt: string;
  githubCommentId?: number;
  parentCommentId?: string; // local id of parent comment
  parentGitHubCommentId?: number; // GitHub comment id of parent (if known)
}

export type SyncStatus = 'synced' | 'local' | 'pending' | 'syncing' | 'error';
export type ThreadStatus = 'open' | 'closed';

export interface ComponentMetadata {
  componentName?: string;
  componentType?: string; // 'function' | 'class' | 'forwardRef' | 'memo' | 'lazy' | 'native' | 'unknown'
  props?: Record<string, unknown>;
  displayName?: string;
  key?: string | number | null;
  componentPath?: string[]; // Component tree path (e.g., ["App", "Dashboard", "Button"])
}

export interface Thread {
  id: string;
  cssSelector?: string; // CSS selector for target element
  elementDescription?: string; // Simplified element name for display (e.g., "button.pf-c-button")
  componentMetadata?: ComponentMetadata; // React component information (component-based)
  xPercent: number; // Percentage from left (0-100) - used as fallback when element is deleted
  yPercent: number; // Percentage from top (0-100) - used as fallback when element is deleted
  route: string;
  version?: string;
  comments: Comment[];
  issueNumber?: number;
  issueUrl?: string;
  provider?: 'github';
  syncStatus?: SyncStatus;
  syncError?: string;
  status?: ThreadStatus; // open or closed (mirrors GitHub issue state)
  isTemporary?: boolean; // If true, thread is not persisted until first comment is added
}
