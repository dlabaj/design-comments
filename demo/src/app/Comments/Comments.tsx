import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  CardBody,
  InputGroup,
  InputGroupItem,
  InputGroupText,
  PageSection,
  TextInput,
  Title,
} from '@patternfly/react-core';
import { AngleDownIcon, AngleRightIcon, SearchIcon } from '@patternfly/react-icons';
import { useComments } from '@design-comments';

const Comments: React.FunctionComponent = () => {
  const navigate = useNavigate();
  const { threads, setSelectedThreadId, setCommentsEnabled, setDrawerPinnedOpen } = useComments();
  const [filter, setFilter] = React.useState('');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  // Dummy data so designers can see the intended table layout before any real comments exist.
  const dummyThreads = React.useMemo(() => {
    const now = Date.now();
    return [
      {
        id: 'demo-thread-support-1',
        route: '/support',
        xPercent: 43.0,
        yPercent: 68.3,
        comments: [
          { id: 'demo-c-1', text: 'The empty state is clear, but I’d prefer the primary CTA to be more prominent.', createdAt: new Date(now - 1000 * 60 * 55).toISOString() },
          { id: 'demo-c-2', text: 'Can we add a short “How it works” blurb above the actions?', createdAt: new Date(now - 1000 * 60 * 48).toISOString() },
          { id: 'demo-c-3', text: 'Spacing feels a little tight on smaller screens.', createdAt: new Date(now - 1000 * 60 * 35).toISOString() },
          { id: 'demo-c-4', text: 'Love the hierarchy. Maybe add an icon to the primary action.', createdAt: new Date(now - 1000 * 60 * 22).toISOString() },
          { id: 'demo-c-5', text: 'Could the secondary actions be collapsed into a kebab menu?', createdAt: new Date(now - 1000 * 60 * 12).toISOString() },
        ],
      },
      {
        id: 'demo-thread-projects-1',
        route: '/projects',
        xPercent: 27.5,
        yPercent: 15.3,
        comments: [
          { id: 'demo-c-6', text: 'Filter dropdown should default to “All projects”.', createdAt: new Date(now - 1000 * 60 * 9).toISOString() },
        ],
      },
      {
        id: 'demo-thread-settings-1',
        route: '/settings/general',
        xPercent: 61.2,
        yPercent: 42.7,
        comments: [],
      },
    ];
  }, []);

  const isUsingDummyData = threads.length === 0;
  const visibleThreads = isUsingDummyData ? dummyThreads : threads;

  const normalizedFilter = filter.trim().toLowerCase();
  const filteredThreads = visibleThreads
    .filter((t) => {
      if (!normalizedFilter) return true;
      const haystack = `${t.route} ${t.xPercent} ${t.yPercent} ${(t.comments || []).map((c) => c.text).join(' ')}`.toLowerCase();
      return haystack.includes(normalizedFilter);
    })
    .sort((a, b) => {
      const aLast = a.comments?.[a.comments.length - 1]?.createdAt ?? '';
      const bLast = b.comments?.[b.comments.length - 1]?.createdAt ?? '';
      return bLast.localeCompare(aLast);
    });

  const toggleExpanded = (threadId: string) => {
    setExpanded((prev) => ({ ...prev, [threadId]: !prev[threadId] }));
  };

  const goToPin = (threadId: string, route: string) => {
    // Ensure visibility + open drawer on destination route
    setCommentsEnabled(true);
    setDrawerPinnedOpen(true);
    setSelectedThreadId(threadId);
    navigate(route);
  };

  const formatDate = (isoDate: string): string => {
    if (!isoDate) return '—';
    const date = new Date(isoDate);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    // Mark this page as "comment controls" so clicking around doesn't create pins
    <PageSection data-comment-controls>
      <Title headingLevel="h1" size="lg" style={{ marginBottom: 'var(--pf-t--global--spacer--sm)' }}>
        View comments
      </Title>
      <p style={{ marginBottom: 'var(--pf-t--global--spacer--md)', color: 'var(--pf-t--global--text--color--subtle)' }}>
        A <b>thread</b> is created when someone drops a pin on a screen. Expand a row to read comments, or use{' '}
        <b>Go to pin</b> to jump to the exact spot.
      </p>
      <Card>
        <CardBody>
          {isUsingDummyData && (
            <p
              style={{
                marginBottom: 'var(--pf-t--global--spacer--md)',
                fontSize: 'var(--pf-t--global--font--size--sm)',
                color: 'var(--pf-t--global--text--color--subtle)',
              }}
            >
              Showing <b>sample data</b> (no real comment threads yet). Once pins/comments exist, this table will show
              live data.
            </p>
          )}
          <div style={{ display: 'flex', gap: 'var(--pf-t--global--spacer--sm)', marginBottom: 'var(--pf-t--global--spacer--md)' }}>
            <InputGroup style={{ flex: 1 }}>
              <InputGroupItem>
                <InputGroupText>
                  <SearchIcon />
                </InputGroupText>
              </InputGroupItem>
              <InputGroupItem isFill>
                <TextInput
                  aria-label="Filter comments"
                  value={filter}
                  onChange={(_e, v) => setFilter(v)}
                  placeholder="Search by page, text, or coordinates…"
                />
              </InputGroupItem>
            </InputGroup>
            <InputGroupItem>
              <Button variant="secondary" onClick={() => setFilter('')} isDisabled={!filter.trim()}>
                Clear
              </Button>
            </InputGroupItem>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="pf-v6-c-table pf-m-grid-md" role="grid" aria-label="All comment threads table">
              <thead className="pf-v6-c-table__thead">
                <tr className="pf-v6-c-table__tr">
                  <th className="pf-v6-c-table__th" scope="col" style={{ width: '3rem' }} />
                  <th className="pf-v6-c-table__th" scope="col">
                    Screen
                  </th>
                  <th className="pf-v6-c-table__th" scope="col">
                    Pin location
                  </th>
                  <th className="pf-v6-c-table__th" scope="col">
                    Comments
                  </th>
                  <th className="pf-v6-c-table__th" scope="col">
                    Last activity
                  </th>
                  <th className="pf-v6-c-table__th" scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="pf-v6-c-table__tbody">
                {filteredThreads.length === 0 ? (
                  <tr className="pf-v6-c-table__tr">
                    <td className="pf-v6-c-table__td" colSpan={6}>
                      No threads found.
                    </td>
                  </tr>
                ) : (
                  filteredThreads.map((thread) => {
                    const isOpen = !!expanded[thread.id];
                    const last = thread.comments?.[thread.comments.length - 1]?.createdAt ?? '';
                    return (
                      <React.Fragment key={thread.id}>
                        <tr className="pf-v6-c-table__tr">
                          <td className="pf-v6-c-table__td">
                            <Button variant="plain" onClick={() => toggleExpanded(thread.id)} aria-label="Toggle thread">
                              {isOpen ? <AngleDownIcon /> : <AngleRightIcon />}
                            </Button>
                          </td>
                          <td className="pf-v6-c-table__td">
                            <Button
                              variant="link"
                              isInline
                              onClick={() => {
                                if (!isUsingDummyData) goToPin(thread.id, thread.route);
                              }}
                              isDisabled={isUsingDummyData}
                            >
                              {thread.route}
                            </Button>
                          </td>
                          <td className="pf-v6-c-table__td">
                            ({thread.xPercent.toFixed(1)}%, {thread.yPercent.toFixed(1)}%)
                          </td>
                          <td className="pf-v6-c-table__td">{thread.comments.length}</td>
                          <td className="pf-v6-c-table__td">{formatDate(last)}</td>
                          <td className="pf-v6-c-table__td">
                            <Button
                              variant="secondary"
                              onClick={() => {
                                if (!isUsingDummyData) goToPin(thread.id, thread.route);
                              }}
                              isDisabled={isUsingDummyData}
                            >
                              Go to pin
                            </Button>
                          </td>
                        </tr>

                        {isOpen && (
                          <tr className="pf-v6-c-table__tr">
                            <td className="pf-v6-c-table__td" colSpan={6}>
                              <div
                                style={{
                                  display: 'grid',
                                  gap: 'var(--pf-t--global--spacer--sm)',
                                  padding: 'var(--pf-t--global--spacer--md)',
                                }}
                              >
                                {thread.comments.length === 0 ? (
                                  <p style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>No comments yet.</p>
                                ) : (
                                  thread.comments.map((c, idx) => (
                                    <Card key={c.id} isCompact>
                                      <CardBody>
                                        <div style={{ fontWeight: 'var(--pf-t--global--font--weight--bold)' }}>
                                          Comment #{idx + 1}
                                        </div>
                                        <div
                                          style={{
                                            fontSize: 'var(--pf-t--global--font--size--sm)',
                                            color: 'var(--pf-t--global--text--color--subtle)',
                                            marginTop: 'var(--pf-t--global--spacer--xs)',
                                          }}
                                        >
                                          @— &nbsp; {formatDate(c.createdAt)}
                                        </div>
                                        <div
                                          style={{
                                            marginTop: 'var(--pf-t--global--spacer--sm)',
                                            whiteSpace: 'pre-wrap',
                                          }}
                                        >
                                          {c.text}
                                        </div>
                                      </CardBody>
                                    </Card>
                                  ))
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </PageSection>
  );
};

export { Comments };
