/**
 * Utilities for generating and working with CSS selectors for element-based commenting
 * Now includes React component detection for component-based commenting
 */

import { getComponentMetadata, getComponentPath, findNearestComponentElement } from './componentUtils';
import { ComponentMetadata } from '../types';

/**
 * Generate a stable, unique CSS selector for a DOM element.
 * Priority order:
 * 1. data-testid or data-id attributes (most stable)
 * 2. id attribute
 * 3. Combination of tag + class + aria attributes
 * 4. Fall back to nth-child path from body
 */
export function generateSelectorForElement(element: Element): string {
  // Strategy 1: Use data-testid or data-id (testing attributes are most stable)
  const testId = element.getAttribute('data-testid') || element.getAttribute('data-id');
  if (testId) {
    return `[data-testid="${testId}"]`;
  }

  // Strategy 2: Use id attribute
  const id = element.getAttribute('id');
  if (id) {
    return `#${CSS.escape(id)}`;
  }

  // Strategy 3: Build selector from tag + class + aria attributes
  const tagName = element.tagName.toLowerCase();
  const classList = Array.from(element.classList);
  const ariaLabel = element.getAttribute('aria-label');
  const role = element.getAttribute('role');
  const type = element.getAttribute('type');

  // Build a selector with tag and primary class
  let selector = tagName;

  // Add first class if available (usually the main component class)
  if (classList.length > 0) {
    selector += `.${CSS.escape(classList[0])}`;
  }

  // Add aria-label for uniqueness if available
  if (ariaLabel) {
    selector += `[aria-label="${CSS.escape(ariaLabel)}"]`;
  } else if (role) {
    // Fall back to role
    selector += `[role="${CSS.escape(role)}"]`;
  } else if (type) {
    // For inputs, include type
    selector += `[type="${CSS.escape(type)}"]`;
  }

  // Test if this selector is unique enough
  const matches = document.querySelectorAll(selector);
  if (matches.length === 1 && matches[0] === element) {
    return selector;
  }

  // Strategy 4: Fall back to nth-child path (less stable but guaranteed unique)
  return getNthChildPath(element);
}

/**
 * Generate nth-child based path from body to element
 * This is a fallback when other strategies don't provide uniqueness
 */
function getNthChildPath(element: Element): string {
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body && current.parentElement) {
    const parent = current.parentElement;
    const siblings = Array.from(parent.children);
    const index = siblings.indexOf(current) + 1;

    const tagName = current.tagName.toLowerCase();
    const classList = Array.from(current.classList);

    if (classList.length > 0) {
      path.unshift(`${tagName}.${CSS.escape(classList[0])}:nth-child(${index})`);
    } else {
      path.unshift(`${tagName}:nth-child(${index})`);
    }

    current = parent;
  }

  return path.join(' > ');
}

/**
 * Get a simplified, human-readable description of an element for display.
 * Prioritizes React component name if available, otherwise falls back to DOM element description.
 * Format: "ComponentName" (React) or "tagName.primaryClass" (DOM)
 * Examples: "Button", "Card", "button.pf-c-button", "div.pf-c-card", "input"
 */
export function getElementDescription(element: Element): string {
  // Try to get React component name first
  const componentMeta = getComponentMetadata(element);
  if (componentMeta?.componentName && componentMeta.componentType !== 'native') {
    return componentMeta.componentName;
  }

  // Fall back to DOM element description
  const tagName = element.tagName.toLowerCase();
  const classList = Array.from(element.classList);

  // If element has classes, use the first one (usually the main component class)
  if (classList.length > 0) {
    return `${tagName}.${classList[0]}`;
  }

  // Fall back to just tag name
  return tagName;
}

/**
 * Get component metadata for an element (React component information)
 */
export function getElementComponentMetadata(element: Element): ComponentMetadata | null {
  // Try to find the nearest React component element
  const componentElement = findNearestComponentElement(element);
  if (!componentElement) return null;

  const metadata = getComponentMetadata(componentElement);
  if (!metadata) return null;

  // Add component path
  const path = getComponentPath(componentElement);
  return {
    ...metadata,
    componentPath: path.length > 0 ? path : undefined,
  };
}

/**
 * Query the DOM for an element matching the given CSS selector.
 * Returns the element if found, null otherwise.
 */
export function findElementBySelector(selector: string | undefined): Element | null {
  if (!selector) {
    return null;
  }

  try {
    return document.querySelector(selector);
  } catch (error) {
    // Invalid selector
    console.warn('Invalid CSS selector:', selector, error);
    return null;
  }
}
