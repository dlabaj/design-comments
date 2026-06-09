import * as React from 'react';
import { useLocation } from 'react-router-dom';
import { useComments } from '../contexts/CommentContext';
import { CommentPin } from './CommentPin';
import { getVersionFromPathOrQuery } from '../utils/version';
import { findElementBySelector, generateSelectorForElement, getElementComponentMetadata, getElementDescription } from '../utils/selectorUtils';
import { getComponentName, getFiberFromElement } from '../utils/componentUtils';

export const CommentOverlay: React.FunctionComponent = () => {
  const location = useLocation();
  const { commentsEnabled, showPinsEnabled, addThread, selectedThreadId, setSelectedThreadId, syncFromGitHub, getThreadsForRoute } = useComments();
  const detectedVersion = getVersionFromPathOrQuery(location.pathname, location.search);
  const overlayRef = React.useRef<HTMLDivElement>(null);

  // Show both open and closed threads as pins (GitHub-style: closed issues still exist)
  const currentThreads = getThreadsForRoute(location.pathname, detectedVersion);
  const selectedThread = currentThreads.find((t) => t.id === selectedThreadId);
  const highlightRef = React.useRef<HTMLDivElement | null>(null);
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  const previewLabelRef = React.useRef<HTMLDivElement | null>(null);
  const hoveredElementRef = React.useRef<Element | null>(null);

  // Component highlighting effect (similar to Chrome DevTools)
  React.useEffect(() => {
    // Hide highlight when comments are disabled
    if (!commentsEnabled || !selectedThread || !selectedThread.cssSelector) {
      // Remove highlight
      if (highlightRef.current) {
        highlightRef.current.remove();
        highlightRef.current = null;
      }
      return;
    }

    const element = findElementBySelector(selectedThread.cssSelector);
    if (!element) {
      // Element not found, remove highlight
      if (highlightRef.current) {
        highlightRef.current.remove();
        highlightRef.current = null;
      }
      return;
    }

    // Create or update highlight overlay
    let highlight = highlightRef.current;
    if (!highlight) {
      highlight = document.createElement('div');
      highlight.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 998;
        border: 2px solid #0066CC;
        background-color: rgba(0, 102, 204, 0.1);
        box-shadow: 0 0 0 1px rgba(0, 102, 204, 0.3);
        transition: all 0.15s ease;
      `;
      document.body.appendChild(highlight);
      highlightRef.current = highlight;
    }

    // Update highlight position and size
    const updateHighlight = () => {
      if (!highlight || !element) return;
      const rect = element.getBoundingClientRect();
      highlight.style.left = `${rect.left}px`;
      highlight.style.top = `${rect.top}px`;
      highlight.style.width = `${rect.width}px`;
      highlight.style.height = `${rect.height}px`;
    };

    updateHighlight();

    // Update on scroll/resize
    const handleUpdate = () => updateHighlight();
    window.addEventListener('scroll', handleUpdate, true);
    window.addEventListener('resize', handleUpdate);

      return () => {
        window.removeEventListener('scroll', handleUpdate, true);
        window.removeEventListener('resize', handleUpdate);
      };
    }, [commentsEnabled, selectedThreadId, selectedThread]);

  // Cleanup highlight on unmount
  React.useEffect(() => {
    return () => {
      if (highlightRef.current) {
        highlightRef.current.remove();
        highlightRef.current = null;
      }
      if (previewRef.current) {
        previewRef.current.remove();
        previewRef.current = null;
      }
      if (previewLabelRef.current) {
        previewLabelRef.current.remove();
        previewLabelRef.current = null;
      }
    };
  }, []);

  // Hover preview effect - shows what will be selected before clicking
  const handleMouseMove = React.useCallback((e: MouseEvent) => {
    if (!commentsEnabled) {
      // Remove preview if comments are disabled
      if (previewRef.current) {
        previewRef.current.remove();
        previewRef.current = null;
      }
      if (previewLabelRef.current) {
        previewLabelRef.current.remove();
        previewLabelRef.current = null;
      }
      hoveredElementRef.current = null;
      return;
    }

    const target = e.target as HTMLElement;
    
    // Don't show preview on comment system UI elements (but allow buttons/links to be selected)
    if (
      target.closest('[data-comment-controls]') ||
      target.closest('[data-comment-pin]') ||
      target.closest('[data-floating-widget]') ||
      target.closest('[data-comment-preview]')
    ) {
      if (previewRef.current) {
        previewRef.current.style.display = 'none';
      }
      if (previewLabelRef.current) {
        previewLabelRef.current.style.display = 'none';
      }
      hoveredElementRef.current = null;
      return;
    }

    // Use the actual element being hovered (don't traverse up for preview)
    const element = target as Element;
    
    // Only update if hovering over a different element
    if (hoveredElementRef.current === element) {
      return;
    }
    
    hoveredElementRef.current = element;

    // Get element info for preview - use the actual element, not parent component
    const elementDescription = getElementDescription(element);
    
    // Only get component metadata if this element itself is a React component
    // Don't traverse up to parent components for preview
    const fiber = getFiberFromElement(element);
    let previewName = elementDescription;
    
    if (fiber) {
      const type = fiber.type;
      // Only use component name if this element IS a React component (not native)
      if (type && typeof type !== 'string') {
        const componentName = getComponentName(fiber);
        const displayName = (typeof type === 'function' && (type.displayName || type.name)) ||
          (type?.$$typeof === Symbol.for('react.forward_ref') && (type.render?.displayName || type.render?.name)) ||
          undefined;
        previewName = componentName || displayName || elementDescription;
      }
    }

    // Create or update preview highlight
    let preview = previewRef.current;
    if (!preview) {
      preview = document.createElement('div');
      preview.setAttribute('data-comment-preview', 'true');
      preview.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 997;
        border: 2px dashed #0066CC;
        background-color: rgba(0, 102, 204, 0.05);
        box-shadow: 0 0 0 1px rgba(0, 102, 204, 0.2);
        transition: all 0.1s ease;
      `;
      document.body.appendChild(preview);
      previewRef.current = preview;
    }

    // Create or update preview label
    let previewLabel = previewLabelRef.current;
    if (!previewLabel) {
      previewLabel = document.createElement('div');
      previewLabel.setAttribute('data-comment-preview', 'true');
      previewLabel.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 998;
        background-color: #0066CC;
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        transition: all 0.1s ease;
      `;
      document.body.appendChild(previewLabel);
      previewLabelRef.current = previewLabel;
    }

    // Update preview position and size
    const rect = element.getBoundingClientRect();
    preview.style.display = 'block';
    preview.style.left = `${rect.left}px`;
    preview.style.top = `${rect.top}px`;
    preview.style.width = `${rect.width}px`;
    preview.style.height = `${rect.height}px`;

    // Update label position (above the element, top-left, but ensure it stays on screen)
    previewLabel.style.display = 'block';
    previewLabel.textContent = previewName;
    
    const labelLeft = rect.left;
    const labelTop = rect.top - 28;

    // Ensure label doesn't go off the left edge
    const adjustedLeft = Math.max(8, labelLeft);

    // If element is near top of viewport, show label below instead
    const adjustedTop = labelTop < 40 ? rect.bottom + 4 : labelTop;
    
    previewLabel.style.left = `${adjustedLeft}px`;
    previewLabel.style.top = `${adjustedTop}px`;
  }, [commentsEnabled]);

  // Mouse leave handler to hide preview
  const handleMouseLeave = React.useCallback(() => {
    if (previewRef.current) {
      previewRef.current.style.display = 'none';
    }
    if (previewLabelRef.current) {
      previewLabelRef.current.style.display = 'none';
    }
    hoveredElementRef.current = null;
  }, []);

  // Set up hover preview listeners
  React.useEffect(() => {
    if (commentsEnabled) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseleave', handleMouseLeave, true);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseleave', handleMouseLeave, true);
      };
    } else {
      // Clean up preview when disabled
      if (previewRef.current) {
        previewRef.current.remove();
        previewRef.current = null;
      }
      if (previewLabelRef.current) {
        previewLabelRef.current.remove();
        previewLabelRef.current = null;
      }
      return undefined;
    }
  }, [commentsEnabled, handleMouseMove, handleMouseLeave]);

  const handlePageClick = (e: MouseEvent) => {
    if (!commentsEnabled) return;

    // Check if clicking on comment system UI elements (but allow buttons/links to be selected)
    const target = e.target as HTMLElement;
    if (
      target.closest('[data-comment-controls]') ||
      target.closest('[data-comment-pin]') ||
      target.closest('[data-floating-widget]') ||
      target.closest('[data-comment-preview]') ||
      target.closest('button[aria-label*="Remove"]') ||
      target.closest('button[aria-label*="Delete"]')
    ) {
      return; // Don't create pin if clicking comment system UI or remove/delete buttons
    }
    
    // Also check if the click originated from within the floating widget
    // This prevents clicks on "Remove pin" button from creating new pins
    if (e.target && (e.target as Element).closest('[data-floating-widget]')) {
      return;
    }

    // Get the overlay container dimensions (accounts for drawer being open)
    if (!overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();

    // Calculate percentage based on the content area, not the full window (used as fallback)
    const xPercent = ((e.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((e.clientY - rect.top) / rect.height) * 100;

    // Generate CSS selector for the clicked element
    const clickedElement = target as Element;
    const cssSelector = generateSelectorForElement(clickedElement);
    const elementDescription = getElementDescription(clickedElement);
    
    // Extract React component metadata (component-based commenting)
    const componentMetadata = getElementComponentMetadata(clickedElement);

    const threadId = addThread(cssSelector, elementDescription, componentMetadata, xPercent, yPercent, location.pathname, detectedVersion);
    setSelectedThreadId(threadId);
  };

  React.useEffect(() => {
    if (commentsEnabled) {
      document.addEventListener('click', handlePageClick);
      // Pull latest changes from GitHub when entering comment mode or switching routes
      syncFromGitHub(location.pathname, detectedVersion).catch(() => undefined);
    }

    return () => {
      document.removeEventListener('click', handlePageClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsEnabled, location.pathname, detectedVersion]);

  // Show pins when comments are enabled OR when showPinsEnabled is true
  if (!commentsEnabled && !showPinsEnabled) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      data-comment-overlay
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 999,
        overflow: 'visible', // Ensure pins can be visible even if slightly outside
      }}
    >
      {currentThreads.map((thread) => (
        <CommentPin
          key={thread.id}
          cssSelector={thread.cssSelector}
          xPercent={thread.xPercent}
          yPercent={thread.yPercent}
          commentCount={thread.comments.length}
          isClosed={thread.status === 'closed'}
          isSelected={selectedThreadId === thread.id}
          onClick={() => setSelectedThreadId(thread.id)}
        />
      ))}
    </div>
  );
};
