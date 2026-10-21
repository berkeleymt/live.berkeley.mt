export interface Publication<T> { revision: string; content: T }

export function sameContent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(key => Object.hasOwn(b, key) && sameContent(a[key], b[key]));
}

/** A bundle revision may change without changing this document. Never rebase a changed document. */
export function publicationBase<T>(baseline: Publication<T>, latest: Publication<T>): string | null {
  return sameContent(baseline.content, latest.content) ? latest.revision : null;
}

export function contentDifferences(draft: unknown, published: unknown, path = ''): { field: string; draft: string; published: string }[] {
  if (sameContent(draft, published)) return [];
  if (draft && published && typeof draft === 'object' && typeof published === 'object') {
    const a = draft as Record<string, unknown>, b = published as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => contentDifferences(a[key], b[key], path ? `${path} › ${key}` : key));
  }
  const display = (value: unknown) => value === undefined ? '(not included)' : typeof value === 'string' ? value || '(empty)' : JSON.stringify(value);
  return [{ field: path.replace(/([a-z])([A-Z])/g, '$1 $2'), draft: display(draft), published: display(published) }];
}
