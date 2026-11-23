import { APP_NAME, COMPANY_NAME } from "@marketplace/shared-types";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground">
        <p>
          © {new Date().getFullYear()} {APP_NAME}
        </p>
        <p>
          Powered by <span className="font-semibold text-foreground">{COMPANY_NAME}</span>
        </p>
      </div>
    </footer>
  );
}
