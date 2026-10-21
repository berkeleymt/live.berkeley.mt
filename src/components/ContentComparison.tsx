import { contentDifferences } from '../data/publication';

export function ContentComparison({ draft, published }: { draft: unknown; published: unknown }) {
  const differences = contentDifferences(draft, published);
  return <div className="content-comparison">
    <p>{differences.length ? `${differences.length} fields differ. Review them before replacing published content.` : 'Your draft matches the published content.'}</p>
    {differences.slice(0, 50).map(item => <article key={item.field}>
      <h4>{item.field}</h4>
      <div><section><strong>Your draft</strong><p>{item.draft}</p></section><section><strong>Published</strong><p>{item.published}</p></section></div>
    </article>)}
    {differences.length > 50 && <p>Showing the first 50 differences. Download both versions to review the rest.</p>}
  </div>;
}
