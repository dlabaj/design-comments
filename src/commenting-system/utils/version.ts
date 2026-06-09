export const getVersionFromPathOrQuery = (pathname: string, search: string): string | undefined => {
  try {
    const params = new URLSearchParams(search || '');
    const fromQuery = params.get('version') || params.get('v');
    if (fromQuery && String(fromQuery).trim()) return String(fromQuery).trim();

    // Common pattern: /v3/... or /version/3/...
    const m1 = pathname.match(/^\/v(\d+)(?:\/|$)/i);
    if (m1?.[1]) return m1[1];

    const m2 = pathname.match(/\/version\/(\d+)(?:\/|$)/i);
    if (m2?.[1]) return m2[1];
  } catch {
    // ignore
  }
  return undefined;
};


