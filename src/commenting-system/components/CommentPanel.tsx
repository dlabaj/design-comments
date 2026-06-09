import * as React from 'react';
import { findElementBySelector } from '../utils/selectorUtils';
import { useLocation } from 'react-router-dom';
import {
  ActionList,
  ActionListItem,
  Button,
  Card,
  CardBody,
  EmptyState,
  EmptyStateBody,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  Tab,
  TabTitleText,
  Tabs,
  TextArea,
  Title,
} from '@patternfly/react-core';
import { ExternalLinkAltIcon, GithubIcon, InfoCircleIcon, TrashIcon } from '@patternfly/react-icons';
import { useComments } from '../contexts/CommentContext';
import { DetailsTab } from './DetailsTab';
import { IssuesTicketsTab } from './IssuesTicketsTab';
import { FloatingWidget } from './FloatingWidget';
import { CommentOverlay } from './CommentOverlay';
import { getVersionFromPathOrQuery } from '../utils/version';
import type { Thread } from '../types';
import {
  buildPromptForThread,
  buildPromptForThreads,
  fetchSummary,
  getCachedSummary,
  getCachedSummaryForThread,
  setCachedSummary,
  setCachedSummaryForThread,
  threadSignature,
  threadsToSignature,
} from '../services/summarizeService';

function threadsEligibleForSummary(source: Thread[]): Thread[] {
  return source
    .filter((t) => !t.isTemporary || t.comments.length > 0)
    .sort((a, b) => {
      const aLatest = a.comments[a.comments.length - 1]?.createdAt || '';
      const bLatest = b.comments[b.comments.length - 1]?.createdAt || '';
      return bLatest.localeCompare(aLatest);
    });
}

interface CommentPanelProps {
  children: React.ReactNode;
}

export const CommentPanel: React.FunctionComponent<CommentPanelProps> = ({ children }) => {
  const {
    threads,
    getThreadsForRoute,
    selectedThreadId,
    addReply,
    updateComment,
    deleteComment,
    closeThread,
    reopenThread,
    removePin,
  } = useComments();
  const location = useLocation();
  const detectedVersion = getVersionFromPathOrQuery(location.pathname, location.search);
  const [newCommentText, setNewCommentText] = React.useState('');
  const [replyingToCommentId, setReplyingToCommentId] = React.useState<string | null>(null);
  const [replyTextByCommentId, setReplyTextByCommentId] = React.useState<Record<string, string>>({});
  const [editingCommentId, setEditingCommentId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState('');
  const [activeTabKey, setActiveTabKey] = React.useState<string | number>('comments');
  const [summaryModalOpen, setSummaryModalOpen] = React.useState(false);
  const [summaryTitle, setSummaryTitle] = React.useState('');
  const [summaryBody, setSummaryBody] = React.useState('');
  const [summaryLoading, setSummaryLoading] = React.useState(false);

  const currentThreads = getThreadsForRoute(location.pathname, detectedVersion);
  const selectedThread = currentThreads.find((t) => t.id === selectedThreadId);

  const sortedAllThreads = React.useMemo(() => threadsEligibleForSummary([...threads]), [threads]);
  const sortedThisPageThreads = React.useMemo(
    () => threadsEligibleForSummary(getThreadsForRoute(location.pathname, detectedVersion)),
    [getThreadsForRoute, location.pathname, detectedVersion],
  );

  const closeSummaryModal = React.useCallback(() => {
    setSummaryModalOpen(false);
    setSummaryBody('');
    setSummaryTitle('');
    setSummaryLoading(false);
  }, []);

  const handleSummarizeList = React.useCallback(
    async (scope: 'all' | 'thisPage') => {
      const list = scope === 'all' ? sortedAllThreads : sortedThisPageThreads;
      const title =
        scope === 'all' ? 'Summary of all discussions' : 'Summary of discussions on this page';
      const signature = threadsToSignature(list, scope);
      const cached = getCachedSummary(scope, signature);
      setSummaryModalOpen(true);
      setSummaryTitle(title);
      if (cached) {
        setSummaryBody(cached.content);
        setSummaryLoading(false);
        return;
      }
      setSummaryBody('');
      setSummaryLoading(true);
      try {
        const prompt = buildPromptForThreads(list, scope);
        const summary = await fetchSummary(prompt);
        setSummaryBody(summary);
        setCachedSummary(scope, signature, title, summary);
      } finally {
        setSummaryLoading(false);
      }
    },
    [sortedAllThreads, sortedThisPageThreads],
  );

  const handleSummarizeSelectedThread = React.useCallback(async () => {
    if (!selectedThread) return;
    const title = 'Summary of this thread';
    const signature = threadSignature(selectedThread);
    const cached = getCachedSummaryForThread(selectedThread.id, signature);
    setSummaryModalOpen(true);
    setSummaryTitle(title);
    if (cached) {
      setSummaryBody(cached.content);
      setSummaryLoading(false);
      return;
    }
    setSummaryBody('');
    setSummaryLoading(true);
    try {
      const prompt = buildPromptForThread(selectedThread);
      const summary = await fetchSummary(prompt);
      setSummaryBody(summary);
      setCachedSummaryForThread(selectedThread.id, signature, title, summary);
    } finally {
      setSummaryLoading(false);
    }
  }, [selectedThread]);

  React.useEffect(() => {
    if (selectedThreadId) {
      setActiveTabKey('comments');
    } else {
      setActiveTabKey('details');
    }
  }, [selectedThreadId]);

  const handleAddComment = () => {
    if (newCommentText.trim() && selectedThread) {
      addReply(selectedThread.id, newCommentText.trim());
      setNewCommentText('');
    }
  };

  const handleStartReply = (commentId: string) => {
    setReplyingToCommentId(commentId);
    setReplyTextByCommentId((prev) => ({ ...prev, [commentId]: prev[commentId] ?? '' }));
  };

  const handleCancelReply = () => {
    setReplyingToCommentId(null);
  };

  const handleSubmitReply = (parentCommentId: string) => {
    if (!selectedThread) return;
    const text = (replyTextByCommentId[parentCommentId] || '').trim();
    if (!text) return;
    addReply(selectedThread.id, text, parentCommentId);
    setReplyTextByCommentId((prev) => ({ ...prev, [parentCommentId]: '' }));
    setReplyingToCommentId(null);
  };

  const handleStartEdit = (commentId: string, currentText: string) => {
    setEditingCommentId(commentId);
    setEditText(currentText);
  };

  const handleSaveEdit = (commentId: string) => {
    if (editText.trim() && selectedThread) {
      updateComment(selectedThread.id, commentId, editText.trim());
      setEditingCommentId(null);
      setEditText('');
    }
  };

  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditText('');
  };

  const handleDeleteComment = (commentId: string) => {
    if (selectedThread) {
      deleteComment(selectedThread.id, commentId);
    }
  };

  const handleCloseThread = () => {
    if (selectedThread) {
      closeThread(selectedThread.id);
    }
  };

  const handleReopenThread = () => {
    if (selectedThread) {
      reopenThread(selectedThread.id);
    }
  };

  const handleRemovePin = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!selectedThread) return;
    removePin(selectedThread.id);
  };

  const formatCommentDate = (isoDate: string): string => {
    const date = new Date(isoDate);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const stripMarkersForDisplay = (text: string): string => {
    return text
      .replace(/<!--\s*hale-reply-to:\d+\s*-->\s*\n?/g, '')
      .replace(/<!--\s*hale-reply-to-local\s*-->\s*\n?/g, '')
      .trimEnd();
  };

  const deriveStatus = () => {
    if (!selectedThread) return 'local' as const;
    if (selectedThread.syncStatus === 'error') return 'error' as const;
    // If we have an issue and any comment hasn't synced yet, treat as pending.
    if (selectedThread.issueNumber && selectedThread.comments.some((c) => !c.githubCommentId)) return 'pending' as const;
    if (selectedThread.issueNumber) return 'synced' as const;
    return selectedThread.syncStatus || 'local';
  };

  const renderSyncLabel = (status?: 'synced' | 'local' | 'pending' | 'syncing' | 'error') => {
    switch (status) {
      case 'synced':
        return (
          <Label color="green" icon={<GithubIcon />}>
            Synced
          </Label>
        );
      case 'local':
        return <Label color="grey">Local</Label>;
      case 'pending':
        return <Label color="blue">Pending…</Label>;
      case 'syncing':
        return (
          <Label color="blue" icon={<Spinner size="sm" />}>
            Syncing…
          </Label>
        );
      case 'error':
        return <Label color="red">Sync error</Label>;
      default:
        return null;
    }
  };

  const panelContent = (
    <>
        <Tabs
          activeKey={activeTabKey}
          onSelect={(_event, tabKey) => setActiveTabKey(tabKey)}
          aria-label="Commenting System drawer tabs"
        >
          <Tab eventKey="details" title={<TabTitleText>Details</TabTitleText>}>
            <div style={{ padding: '1rem' }}>
              <DetailsTab />
            </div>
          </Tab>
          <Tab eventKey="issues" title={<TabTitleText>Issues/Tickets</TabTitleText>}>
            <div style={{ padding: '1rem' }}>
              <IssuesTicketsTab />
            </div>
          </Tab>
          <Tab eventKey="comments" title={<TabTitleText>Comments</TabTitleText>}>
            <div style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  id="hale-summarize-all-btn"
                  onClick={() => handleSummarizeList('all')}
                  isDisabled={sortedAllThreads.length === 0}
                >
                  Summarize all threads
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  id="hale-summarize-page-btn"
                  onClick={() => handleSummarizeList('thisPage')}
                  isDisabled={sortedThisPageThreads.length === 0}
                >
                  Summarize this page
                </Button>
              </div>
              {!selectedThread ? (
                <EmptyState icon={InfoCircleIcon} titleText="No pin selected" headingLevel="h3">
                  <EmptyStateBody>Select or create a comment pin to start a thread.</EmptyStateBody>
                </EmptyState>
              ) : (
                <>
                  {/* Thread summary header with component information */}
                  <Card style={{ marginBottom: '1rem' }}>
                    <CardBody>
                      <div style={{ display: 'grid', gap: '0.75rem' }}>
                        {/* Component Information (Component-Based) */}
                        {selectedThread.componentMetadata ? (
                          <div style={{ display: 'grid', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'var(--pf-t--global--background--color--secondary--default)', borderRadius: 'var(--pf-t--global--border--radius--small)' }}>
                            <div style={{ fontSize: '0.875rem', fontWeight: 'bold' }}>
                              React Component
                            </div>
                            <div style={{ fontSize: '0.875rem' }}>
                              <strong>Name:</strong> {selectedThread.componentMetadata.componentName || selectedThread.componentMetadata.displayName || 'Unknown'}
                              {selectedThread.componentMetadata.componentType && selectedThread.componentMetadata.componentType !== 'native' && (
                                <span style={{ color: 'var(--pf-t--global--text--color--subtle)', marginLeft: '0.5rem' }}>
                                  ({selectedThread.componentMetadata.componentType})
                                </span>
                              )}
                            </div>
                            {selectedThread.componentMetadata.componentPath && selectedThread.componentMetadata.componentPath.length > 0 && (
                              <div style={{ fontSize: '0.875rem' }}>
                                <strong>Path:</strong>{' '}
                                <span style={{ fontFamily: 'monospace', color: 'var(--pf-t--global--text--color--subtle)' }}>
                                  {selectedThread.componentMetadata.componentPath.join(' > ')}
                                </span>
                              </div>
                            )}
                            {selectedThread.componentMetadata.props && Object.keys(selectedThread.componentMetadata.props).length > 0 && (
                              <details style={{ fontSize: '0.875rem' }}>
                                <summary style={{ cursor: 'pointer', marginBottom: '0.25rem' }}>
                                  <strong>Props</strong> ({Object.keys(selectedThread.componentMetadata.props).length})
                                </summary>
                                <pre
                                  style={{
                                    marginTop: '0.5rem',
                                    padding: '0.5rem',
                                    backgroundColor: 'var(--pf-t--global--background--color--default)',
                                    borderRadius: 'var(--pf-t--global--border--radius--small)',
                                    fontSize: '0.75rem',
                                    overflow: 'auto',
                                    maxHeight: '200px',
                                  }}
                                >
                                  {JSON.stringify(selectedThread.componentMetadata.props, null, 2)}
                                </pre>
                              </details>
                            )}
                            {selectedThread.cssSelector && !findElementBySelector(selectedThread.cssSelector) && (
                              <div style={{ fontSize: '0.875rem', color: 'var(--pf-t--global--color--status--danger--default)' }}>
                                ⚠️ Component element not found in DOM
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.875rem' }}>
                            <strong>Element:</strong> {selectedThread.elementDescription || 'unknown'}
                            {selectedThread.cssSelector && !findElementBySelector(selectedThread.cssSelector) && (
                              <span style={{ color: 'var(--pf-t--global--color--status--danger--default)' }}> [deleted]</span>
                            )}
                          </div>
                        )}

                        <div style={{ fontSize: '0.875rem' }}>
                          <strong>Comments:</strong> {selectedThread.comments.length}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <strong>Status:</strong>
                          {renderSyncLabel(deriveStatus()) ?? <Label color="grey">Local</Label>}
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                          <Button
                            variant="secondary"
                            size="sm"
                            id="hale-summarize-thread-btn"
                            onClick={() => handleSummarizeSelectedThread()}
                          >
                            Summarize this thread
                          </Button>
                        </div>

                        <div style={{ fontSize: '0.875rem' }}>
                          {selectedThread.issueNumber && selectedThread.issueUrl ? (
                            <a
                              href={selectedThread.issueUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                            >
                              <GithubIcon />
                              Issue #{selectedThread.issueNumber}
                              <ExternalLinkAltIcon style={{ fontSize: '0.75rem' }} />
                            </a>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
                              <GithubIcon />
                              Issue pending…
                            </span>
                          )}
                        </div>
                      </div>
                    </CardBody>
                  </Card>

                  {/* Comments List */}
                  {selectedThread.comments.length > 0 && (
                    <div style={{ marginBottom: '1.5rem' }}>
                      {(() => {
                        const comments = selectedThread.comments;

                        const byId = new Map(comments.map((c) => [c.id, c]));
                        const byGitHubId = new Map<number, string>();
                        for (const c of comments) {
                          if (c.githubCommentId) byGitHubId.set(c.githubCommentId, c.id);
                        }

                        const childrenByParent = new Map<string, string[]>();
                        const topLevel: string[] = [];

                        for (const c of comments) {
                          const parentLocal =
                            c.parentCommentId ||
                            (c.parentGitHubCommentId ? byGitHubId.get(c.parentGitHubCommentId) : undefined);

                          if (parentLocal && byId.has(parentLocal)) {
                            const list = childrenByParent.get(parentLocal) || [];
                            list.push(c.id);
                            childrenByParent.set(parentLocal, list);
                          } else {
                            topLevel.push(c.id);
                          }
                        }

                        const sortByCreatedAt = (aId: string, bId: string) => {
                          const a = byId.get(aId);
                          const b = byId.get(bId);
                          const at = a ? Date.parse(a.createdAt) : 0;
                          const bt = b ? Date.parse(b.createdAt) : 0;
                          return at - bt;
                        };

                        topLevel.sort(sortByCreatedAt);
                        childrenByParent.forEach((list, parentId) => {
                          list.sort(sortByCreatedAt);
                          childrenByParent.set(parentId, list);
                        });

                        const renderNode = (id: string, depth: number, topIndex?: number) => {
                          const comment = byId.get(id);
                          if (!comment) return null;

                          const isReply = depth > 0;
                          const title = isReply ? 'Reply' : `Comment #${(topIndex ?? 0) + 1}`;

                          const children = childrenByParent.get(id) || [];

                          return (
                            <div
                              key={id}
                              style={{
                                marginLeft: depth * 16,
                                marginTop: depth > 0 ? '8px' : undefined,
                                marginBottom: depth > 0 ? '8px' : '1rem',
                              }}
                            >
                              <Card>
                                <CardBody style={{ position: 'relative' }}>
                                  <Button
                                    variant="plain"
                                    icon={<TrashIcon />}
                                    isDanger
                                    aria-label="Delete comment"
                                    title="Delete comment"
                                    onClick={() => handleDeleteComment(comment.id)}
                                    style={{ position: 'absolute', top: '12px', right: '12px' }}
                                  />
                                  <Title headingLevel="h3" size={isReply ? 'lg' : 'xl'} style={{ paddingRight: '2.5rem' }}>
                                    {title}
                                  </Title>
                                  <div
                                    style={{
                                      marginTop: '0.25rem',
                                      fontSize: '0.875rem',
                                      color: 'var(--pf-t--global--text--color--subtle)',
                                      paddingRight: '2.5rem',
                                    }}
                                  >
                                    @{comment.author ?? '—'} &nbsp; {formatCommentDate(comment.createdAt)}
                                  </div>

                                  {editingCommentId === comment.id ? (
                                    <div style={{ marginTop: '0.5rem' }}>
                                      <TextArea
                                        value={editText}
                                        onChange={(_event, value) => setEditText(value)}
                                        aria-label="Edit comment"
                                        rows={3}
                                      />
                                      <ActionList style={{ marginTop: '0.5rem' }}>
                                        <ActionListItem>
                                          <Button variant="primary" onClick={() => handleSaveEdit(comment.id)}>
                                            Save
                                          </Button>
                                        </ActionListItem>
                                        <ActionListItem>
                                          <Button variant="link" onClick={handleCancelEdit}>
                                            Cancel
                                          </Button>
                                        </ActionListItem>
                                      </ActionList>
                                    </div>
                                  ) : (
                                    <div>
                                      <div style={{ marginTop: '0.75rem', whiteSpace: 'pre-wrap' }}>
                                        {stripMarkersForDisplay(comment.text)}
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '0.5rem' }}>
                                        <Button variant="primary" onClick={() => handleStartReply(comment.id)}>
                                          Reply
                                        </Button>
                                        <Button variant="link" onClick={() => handleStartEdit(comment.id, stripMarkersForDisplay(comment.text))}>
                                          Edit
                                        </Button>
                                      </div>
                                    </div>
                                  )}

                                  {replyingToCommentId === comment.id && (
                                    <div style={{ marginTop: '0.75rem' }}>
                                      <Title headingLevel="h4" size="md" style={{ marginBottom: '0.5rem' }}>
                                        Reply to this comment
                                      </Title>
                                      <TextArea
                                        value={replyTextByCommentId[comment.id] || ''}
                                        onChange={(_event, value) =>
                                          setReplyTextByCommentId((prev) => ({ ...prev, [comment.id]: value }))
                                        }
                                        placeholder="Type your reply..."
                                        aria-label="Reply to comment"
                                        rows={3}
                                      />
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '0.5rem' }}>
                                        <Button
                                          variant="primary"
                                          onClick={() => handleSubmitReply(comment.id)}
                                          isDisabled={!(replyTextByCommentId[comment.id] || '').trim()}
                                        >
                                          Post reply
                                        </Button>
                                        <Button variant="link" onClick={handleCancelReply}>
                                          Cancel
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </CardBody>
                              </Card>

                              {children.map((childId) => renderNode(childId, depth + 1))}
                            </div>
                          );
                        };

                        return <>{topLevel.map((id, idx) => renderNode(id, 0, idx))}</>;
                      })()}
                    </div>
                  )}

                  {/* Add New Comment */}
                  <div>
                    {selectedThread.status === 'closed' ? (
                      <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: 'var(--pf-t--global--background--color--secondary--default)', borderRadius: 'var(--pf-t--global--border--radius--medium)' }}>
                        <Title headingLevel="h3" size="md" style={{ marginBottom: '0.5rem' }}>
                          🔒 Thread Closed
                        </Title>
                        <p style={{ color: 'var(--pf-t--global--text--color--subtle)', marginBottom: '1rem' }}>
                          This thread has been closed and locked. Reopen it to add new comments.
                        </p>
                         <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                           <Button variant="primary" onClick={handleReopenThread}>
                             Reopen Thread
                           </Button>
                           <Button variant="link" isDanger onClick={handleRemovePin} aria-label="Remove pin">
                             Remove pin
                           </Button>
                         </div>
                      </div>
                    ) : (
                      <>
                        <Title headingLevel="h3" size="md" style={{ marginBottom: '0.5rem' }}>
                          Add comment
                        </Title>
                        <TextArea
                          value={newCommentText}
                          onChange={(_event, value) => setNewCommentText(value)}
                          placeholder="Type your comment..."
                          aria-label="New comment"
                          rows={4}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '1rem' }}>
                          <Button variant="primary" onClick={handleAddComment} isDisabled={!newCommentText.trim()}>
                            Add Comment
                          </Button>
                          <Button variant="secondary" onClick={handleCloseThread}>
                            Close Thread
                          </Button>
                           <Button variant="link" isDanger onClick={handleRemovePin} aria-label="Remove pin">
                             Remove pin
                           </Button>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </Tab>
        </Tabs>
    </>
  );

  return (
    <>
      <FloatingWidget title="Commenting System">
        {panelContent}
      </FloatingWidget>
      <div data-comment-root style={{ position: 'relative', width: '100%', minHeight: '100%' }}>
        {children}
        <CommentOverlay />
      </div>
      <Modal
        variant="medium"
        isOpen={summaryModalOpen}
        onClose={closeSummaryModal}
        ouiaId="hale-commenting-summary-modal"
        aria-labelledby="hale-summary-modal-title"
      >
        <ModalHeader title={summaryTitle || 'Summary'} labelId="hale-summary-modal-title" />
        <ModalBody id="hale-summary-modal-body">
          {summaryLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
              <Spinner size="lg" aria-label="Loading summary" />
            </div>
          ) : (
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}>{summaryBody || '—'}</div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={closeSummaryModal}>
            Close
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
};
