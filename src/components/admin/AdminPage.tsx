import Link from "next/link";
import { ArrowLeft } from "lucide-react";

type AdminPageProps = {
  children: React.ReactNode;
  className?: string;
  width?: "full" | "content" | "narrow";
};

type AdminPageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: string;
  actions?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  meta?: React.ReactNode;
};

const widths = {
  full: "max-w-none",
  content: "max-w-[82rem]",
  narrow: "max-w-5xl",
} as const;

export function AdminPage({ children, className = "", width = "full" }: AdminPageProps) {
  return (
    <div
      data-admin-page
      className={`mx-auto w-full ${widths[width]} space-y-7 sm:space-y-8 ${className}`}
    >
      {children}
    </div>
  );
}

export function AdminPageHeader({
  title,
  description,
  eyebrow = "Sole Sneakers operations",
  actions,
  backHref,
  backLabel = "Back",
  meta,
}: AdminPageHeaderProps) {
  return (
    <header data-admin-page-header className="border-b border-black/10 pb-6 sm:pb-7">
      {backHref && (
        <Link
          href={backHref}
          className="mb-5 inline-flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-zinc-500 hover:text-black"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </Link>
      )}
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <p className="mb-3 text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-zinc-500">
            {eyebrow}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1>{title}</h1>
            {meta}
          </div>
          {description && (
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500 sm:text-[0.95rem]">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div
            data-admin-page-actions
            className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end"
          >
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

export function AdminSectionHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      data-admin-section-header
      className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"
    >
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-sm leading-5 text-zinc-500">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
