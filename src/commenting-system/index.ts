// Contexts
export { CommentProvider, useComments } from './contexts/CommentContext';
export { GitHubAuthProvider, useGitHubAuth } from './contexts/GitHubAuthContext';

// Components
export { CommentOverlay } from './components/CommentOverlay';
export { CommentPin } from './components/CommentPin';
export { CommentPanel } from './components/CommentPanel';
export { DetailsTab } from './components/DetailsTab';
export { GitHubIssuesTab } from './components/GitHubIssuesTab';
export { IssuesTicketsTab } from './components/IssuesTicketsTab';
export { JiraTab } from './components/JiraTab';
export { FloatingWidget } from './components/FloatingWidget';

// Services
export { githubAdapter, isGitHubConfigured } from './services/githubAdapter';
export {
  buildPromptForThread,
  buildPromptForThreads,
  buildThreadBlock,
  fetchSummary,
  getCachedSummary,
  getCachedSummaryForThread,
  setCachedSummary,
  setCachedSummaryForThread,
  threadSignature,
  threadsToSignature,
} from './services/summarizeService';

// Types
export type { Comment, Thread, SyncStatus, ThreadStatus, ComponentMetadata } from './types';

// Utils
export { getComponentMetadata, getComponentPath, findNearestComponentElement } from './utils/componentUtils';
