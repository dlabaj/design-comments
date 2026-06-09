import * as React from 'react';
import { createPortal } from 'react-dom';
import { Button, Switch, Title } from '@patternfly/react-core';
import { GithubIcon, GripVerticalIcon, WindowMinimizeIcon } from '@patternfly/react-icons';
import { useComments } from '../contexts/CommentContext';
import { useGitHubAuth } from '../contexts/GitHubAuthContext';

/** Keeps switches + GitHub auth on one row without overlap when resizing narrow. */
const MIN_WIDGET_WIDTH = 440;
const MAX_WIDGET_WIDTH = 800;
const MIN_MINIMIZED_WIDTH = 280;

interface FloatingWidgetProps {
  children: React.ReactNode;
  title?: string;
}

export const FloatingWidget: React.FunctionComponent<FloatingWidgetProps> = ({ children, title = 'Commenting System' }) => {
  const [position, setPosition] = React.useState({
    x: Math.max(8, window.innerWidth - (MIN_WIDGET_WIDTH + 80)),
    y: 20,
  });
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragOffset, setDragOffset] = React.useState({ x: 0, y: 0 });
  const [isMinimized, setIsMinimized] = React.useState(false);
  const [viewportHeight, setViewportHeight] = React.useState(window.innerHeight);
  const [widgetSize, setWidgetSize] = React.useState({ width: Math.max(MIN_WIDGET_WIDTH, 500), height: window.innerHeight * 0.8 });
  const [isResizing, setIsResizing] = React.useState(false);
  const [resizeStart, setResizeStart] = React.useState({ x: 0, y: 0, width: 0, height: 0 });
  const widgetRef = React.useRef<HTMLDivElement>(null);
  const resizeHandleRef = React.useRef<HTMLDivElement>(null);

  const { commentsEnabled, setCommentsEnabled, showPinsEnabled, setShowPinsEnabled } = useComments();
  const { isAuthenticated, user, login, logout } = useGitHubAuth();

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!widgetRef.current) return;
    const rect = widgetRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setIsDragging(true);
  };

  React.useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // Update viewport height on resize to recalculate constraints
  React.useEffect(() => {
    const handleResize = () => {
      setViewportHeight(window.innerHeight);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle resize
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!widgetRef.current) return;
    const rect = widgetRef.current.getBoundingClientRect();
    setIsResizing(true);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: rect.width,
      height: rect.height,
    });
  };

  React.useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;
      
      setWidgetSize({
        width: Math.max(MIN_WIDGET_WIDTH, Math.min(MAX_WIDGET_WIDTH, resizeStart.width + deltaX)),
        height: Math.max(200, Math.min(viewportHeight - 100, resizeStart.height + deltaY)),
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeStart, viewportHeight]);

  // Constrain to viewport but allow moving into topbar area (just keep drag handle accessible)
  const constrainedPosition = React.useMemo(() => {
    const widgetWidth = widgetSize.width;
    // Calculate actual widget height
    const widgetHeight = isMinimized ? 120 : widgetSize.height;
    const maxX = window.innerWidth - 50; // Allow 50px of widget to be visible for dragging
    const maxY = viewportHeight - 50;
    // Allow widget to move into topbar, but keep at least 60px of drag handle visible
    const minY = -widgetHeight + 60;
    return {
      x: Math.max(-widgetWidth + 50, Math.min(position.x, maxX)),
      y: Math.max(minY, Math.min(position.y, maxY)),
    };
  }, [position, isMinimized, viewportHeight, widgetSize]);

  const widgetContent = (
    <div
      ref={widgetRef}
      data-floating-widget
      style={{
        position: 'fixed',
        left: `${constrainedPosition.x}px`,
        top: `${constrainedPosition.y}px`,
        width: isMinimized ? `${MIN_MINIMIZED_WIDTH}px` : `${widgetSize.width}px`,
        height: isMinimized ? 'fit-content' : `${widgetSize.height}px`,
        maxHeight: `${viewportHeight - 100}px`,
        zIndex: 99999,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
        borderRadius: 'var(--pf-t--global--border--radius--medium)',
        backgroundColor: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        cursor: isDragging ? 'grabbing' : 'default',
      }}
    >
      <div
        style={{
          borderBottom: isMinimized ? 'none' : '1px solid var(--pf-t--global--border--color--default)',
          backgroundColor: '#ffffff',
          borderRadius: isMinimized ? 'var(--pf-t--global--border--radius--medium)' : 'var(--pf-t--global--border--radius--medium) var(--pf-t--global--border--radius--medium) 0 0',
        }}
      >
        {/* Title bar with drag handle */}
        <div
          onMouseDown={handleMouseDown}
          style={{
            padding: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'grab',
            userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
            <GripVerticalIcon style={{ color: 'var(--pf-t--global--text--color--subtle)' }} />
            <Title headingLevel="h2" size="lg">
              {title}
            </Title>
          </div>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <Button
              variant="plain"
              icon={<WindowMinimizeIcon />}
              onClick={(e) => {
                e.stopPropagation();
                setIsMinimized(!isMinimized);
              }}
              aria-label={isMinimized ? 'Maximize widget' : 'Minimize widget'}
            />
          </div>
        </div>

        {/* Controls row */}
        {!isMinimized && (
          <div
            style={{
              padding: '0 1rem 0.75rem 1rem',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '0.75rem 1rem',
              borderBottom: '1px solid var(--pf-t--global--border--color--default)',
            }}
          >
            <Switch
              id="floating-comments-enabled-switch"
              label="Enable Comments"
              isChecked={commentsEnabled}
              onChange={(_event, checked) => setCommentsEnabled(checked)}
              aria-label="Enable or disable comments"
            />
            <Switch
              id="floating-show-pins-switch"
              label="Show pins"
              isChecked={showPinsEnabled}
              onChange={(_event, checked) => setShowPinsEnabled(checked)}
              aria-label="Show or hide comment pins"
            />
            <div style={{ flex: '1 1 0', minWidth: 0 }} />
            {isAuthenticated ? (
              <div style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.25rem 0.75rem', marginLeft: 'auto' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--pf-t--global--font--size--sm)' }}>
                  <GithubIcon />
                  {user?.login ? `@${user.login}` : 'Signed in'}
                </span>
                <Button variant="link" isInline onClick={logout} style={{ fontSize: 'var(--pf-t--global--font--size--sm)' }}>
                  Sign out
                </Button>
              </div>
            ) : (
              <div style={{ marginLeft: 'auto' }}>
                <Button variant="link" isInline icon={<GithubIcon />} onClick={login} style={{ fontSize: 'var(--pf-t--global--font--size--sm)' }}>
                  Sign in with GitHub
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      {!isMinimized && (
        <div
          style={{
            overflowY: 'auto',
            overflowX: 'hidden',
            flex: '1 1 0',
            minHeight: 0,
            backgroundColor: '#ffffff',
            borderRadius: '0 0 var(--pf-t--global--border--radius--medium) var(--pf-t--global--border--radius--medium)',
          }}
        >
          {children}
        </div>
      )}
      {/* Resize handle */}
      {!isMinimized && (
        <div
          ref={resizeHandleRef}
          onMouseDown={handleResizeStart}
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: '20px',
            height: '20px',
            cursor: 'nwse-resize',
            background: 'linear-gradient(135deg, transparent 0%, transparent 40%, var(--pf-t--global--border--color--default) 40%, var(--pf-t--global--border--color--default) 45%, transparent 45%, transparent 55%, var(--pf-t--global--border--color--default) 55%, var(--pf-t--global--border--color--default) 60%, transparent 60%)',
            borderRadius: '0 0 var(--pf-t--global--border--radius--medium) 0',
          }}
          aria-label="Resize widget"
        />
      )}
    </div>
  );

  // Render widget in a portal to document.body so it floats above ALL page elements
  return typeof document !== 'undefined' ? createPortal(widgetContent, document.body) : null;
};
