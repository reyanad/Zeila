import Link from "next/link";
import { buttonVariants } from "@marketplace/ui";

/** Previous/next links that keep every other query parameter. */
export function Pagination({ basePath, params, page, pageSize, total }: {
  basePath: string;
  params: Record<string, string>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (target: number) => {
    const query = new URLSearchParams({ ...params, page: String(target) });
    return `${basePath}?${query.toString()}`;
  };
  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Previous
        </Link>
      ) : null}
      <span className="text-sm text-muted-foreground">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} rel="next" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Next
        </Link>
      ) : null}
    </nav>
  );
}
