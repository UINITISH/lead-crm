/**
 * Page-number strip with Previous/Next — used under the Leads table now that
 * lead counts can run into the hundreds. Always shows first, last, and a
 * window around the current page, collapsing the rest behind "…" so it stays
 * usable at 20+ pages instead of listing every single one.
 */
export default function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const pages = [];
  const add = (n) => { if (!pages.includes(n)) pages.push(n); };
  add(1);
  add(totalPages);
  for (let n = page - 1; n <= page + 1; n++) if (n >= 1 && n <= totalPages) add(n);
  pages.sort((a, b) => a - b);

  const items = [];
  let prev = 0;
  for (const n of pages) {
    if (n - prev > 1) items.push({ gap: true, key: 'gap-' + n });
    items.push({ n, key: n });
    prev = n;
  }

  return (
    <div className="pagination">
      <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
      {items.map((it) => it.gap
        ? <span key={it.key} className="pagination-gap">…</span>
        : (
          <button key={it.key}
                  className={it.n === page ? 'primary' : ''}
                  onClick={() => onPageChange(it.n)}>
            {it.n}
          </button>
        ))}
      <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next</button>
    </div>
  );
}
