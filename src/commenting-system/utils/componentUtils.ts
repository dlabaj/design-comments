/**
 * Utilities for React component detection and metadata extraction
 * Similar to Chrome DevTools component inspection
 */

import { ComponentMetadata } from '../types';

/**
 * Get React fiber node from a DOM element
 * Uses React DevTools internal API if available, otherwise traverses up the DOM tree
 */
export function getFiberFromElement(element: Element | null): any {
  if (!element) return null;

  // Try React DevTools internal API first (if DevTools is installed)
  const key = Object.keys(element).find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
  if (key) {
    return (element as any)[key];
  }

  // Fallback: traverse up the DOM tree to find a React fiber
  let current: Node | null = element;
  while (current) {
    const keys = Object.keys(current);
    const fiberKey = keys.find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (fiberKey) {
      return (current as any)[fiberKey];
    }
    current = current.parentNode;
  }

  return null;
}

/**
 * Get component name from a React fiber node
 */
export function getComponentName(fiber: any): string | undefined {
  if (!fiber) return undefined;

  // Try different fiber types
  const type = fiber.type;
  if (!type) return undefined;

  // Function component
  if (typeof type === 'function') {
    return type.displayName || type.name || 'Anonymous';
  }

  // Forward ref
  if (type.$$typeof === Symbol.for('react.forward_ref')) {
    return type.render?.displayName || type.render?.name || 'ForwardRef';
  }

  // Memo
  if (type.$$typeof === Symbol.for('react.memo')) {
    const innerType = type.type;
    if (typeof innerType === 'function') {
      return innerType.displayName || innerType.name || 'Memo';
    }
    return 'Memo';
  }

  // String (native element)
  if (typeof type === 'string') {
    return type;
  }

  return undefined;
}

/**
 * Get component type (function, class, etc.)
 */
function getComponentType(fiber: any): ComponentMetadata['componentType'] {
  if (!fiber) return 'unknown';

  const type = fiber.type;
  if (!type) return 'unknown';

  if (typeof type === 'function') {
    // Check if it's a class component
    if (type.prototype && type.prototype.isReactComponent) {
      return 'class';
    }
    return 'function';
  }

  if (type.$$typeof === Symbol.for('react.forward_ref')) {
    return 'forwardRef';
  }

  if (type.$$typeof === Symbol.for('react.memo')) {
    return 'memo';
  }

  if (type.$$typeof === Symbol.for('react.lazy')) {
    return 'lazy';
  }

  if (typeof type === 'string') {
    return 'native';
  }

  return 'unknown';
}

/**
 * Extract component metadata from a DOM element
 * Returns React component information if available
 */
export function getComponentMetadata(element: Element | null): ComponentMetadata | null {
  if (!element) return null;

  const fiber = getFiberFromElement(element);
  if (!fiber) return null;

  const componentName = getComponentName(fiber);
  const componentType = getComponentType(fiber);

  // Get props (may be null for native elements)
  const props = fiber.memoizedProps || fiber.pendingProps || undefined;

  // Get key
  const key = fiber.key !== null && fiber.key !== undefined ? fiber.key : undefined;

  // Get display name
  const type = fiber.type;
  const displayName =
    (typeof type === 'function' && (type.displayName || type.name)) ||
    (type?.$$typeof === Symbol.for('react.forward_ref') && (type.render?.displayName || type.render?.name)) ||
    undefined;

  return {
    componentName,
    componentType,
    props: props ? sanitizeProps(props) : undefined,
    displayName,
    key,
  };
}

/**
 * Sanitize props for display (remove functions, circular refs, etc.)
 */
function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const seen = new WeakSet();

  const sanitize = (value: unknown, depth = 0): unknown => {
    if (depth > 3) return '[Max Depth]'; // Prevent infinite recursion
    if (value === null || value === undefined) return value;
    if (typeof value === 'function') return '[Function]';
    if (typeof value === 'symbol') return '[Symbol]';
    if (typeof value === 'bigint') return `[BigInt: ${value}]`;

    if (typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      if (value instanceof Date) return value.toISOString();
      if (value instanceof RegExp) return value.toString();
      if (Array.isArray(value)) {
        seen.add(value);
        return value.map((item) => sanitize(item, depth + 1));
      }
      if (value instanceof Set) return `[Set(${value.size})]`;
      if (value instanceof Map) return `[Map(${value.size})]`;

      // React elements
      if ((value as any).$$typeof) {
        const type = (value as any).type;
        if (typeof type === 'string') return `<${type} />`;
        if (typeof type === 'function') return `<${type.displayName || type.name || 'Component'} />`;
        return '[React Element]';
      }

      seen.add(value);
      const obj: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        // Skip internal React props
        if (key.startsWith('__') || key === 'ref' || key === 'key') continue;
        obj[key] = sanitize(val, depth + 1);
      }
      return obj;
    }

    return value;
  };

  for (const [key, value] of Object.entries(props)) {
    // Skip internal React props
    if (key.startsWith('__') || key === 'ref' || key === 'key') continue;
    sanitized[key] = sanitize(value);
  }

  return sanitized;
}

/**
 * Get component hierarchy path (component tree path)
 */
export function getComponentPath(element: Element | null): string[] {
  if (!element) return [];

  const path: string[] = [];
  let current: Element | null = element;

  while (current) {
    const fiber = getFiberFromElement(current);
    if (fiber) {
      const name = getComponentName(fiber);
      if (name && name !== 'Anonymous') {
        path.unshift(name);
      }
    }
    current = current.parentElement;
  }

  return path;
}

/**
 * Find the nearest React component element (not a native DOM element)
 */
export function findNearestComponentElement(element: Element | null): Element | null {
  if (!element) return null;

  let current: Element | null = element;

  while (current) {
    const fiber = getFiberFromElement(current);
    if (fiber) {
      const type = fiber.type;
      // If it's a React component (not a native element), return it
      if (type && typeof type !== 'string') {
        return current;
      }
    }
    current = current.parentElement;
  }

  return element; // Fallback to original element
}
