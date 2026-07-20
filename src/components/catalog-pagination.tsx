import Link from "next/link";

type CatalogPaginationProps = {
  basePath: string;
  currentPage: number;
  pageSize: number;
  query: Record<string, string>;
  total: number;
  totalPages: number;
};

export function CatalogPagination({
  basePath,
  currentPage,
  pageSize,
  query,
  total,
  totalPages,
}: CatalogPaginationProps) {
  if (!total) {
    return null;
  }

  const first = (currentPage - 1) * pageSize + 1;
  const last = Math.min(currentPage * pageSize, total);

  return (
    <div className="pagination catalog-pagination">
      <span className="catalog-pagination-range">
        {first}-{last} of {total}
      </span>
      <span>
        Page {currentPage} of {totalPages}
      </span>
      <Link
        aria-disabled={currentPage <= 1}
        className={currentPage <= 1 ? "disabled" : ""}
        href={makePageHref(basePath, query, currentPage - 1)}
      >
        Previous
      </Link>
      <Link
        aria-disabled={currentPage >= totalPages}
        className={currentPage >= totalPages ? "disabled" : ""}
        href={makePageHref(basePath, query, currentPage + 1)}
      >
        Next
      </Link>
    </div>
  );
}

function makePageHref(basePath: string, query: Record<string, string>, page: number) {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });

  if (page > 1) {
    params.set("page", String(page));
  }

  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}
