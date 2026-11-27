import { LoadingState, Skeleton } from "@/components/ui/Skeleton";
import { RequestError } from "@/components/ui/RequestError";

type Shape = "metrics" | "table" | "list" | "detail" | "form";
export function AdminSkeleton({
  shape = "list",
  label,
}: {
  shape?: Shape;
  label: string;
}) {
  const heights = {
    metrics: "h-24",
    table: "h-12",
    list: "h-16",
    detail: "h-28",
    form: "h-11",
  };
  return (
    <LoadingState
      label={label}
      className={shape === "metrics" ? "grid grid-cols-3 gap-3" : "grid gap-3 py-2"}
    >
      {Array.from({ length: shape === "metrics" ? 3 : 4 }, (_, i) => (
        <Skeleton key={i} className={`rounded-md ${heights[shape]}`} />
      ))}
    </LoadingState>
  );
}
type ReadStatus = {
  data?: unknown;
  error?: string;
  denied?: boolean;
  pending: boolean;
  retry: () => void;
};
export function AdminReadStatus({
  read,
  label,
  shape,
}: {
  read: ReadStatus;
  label: string;
  shape?: Shape;
}) {
  if (read.error)
    return (
      <RequestError
        message={read.error}
        onRetry={read.retry}
        retrying={read.pending}
        signInHref={read.denied ? "/auth/login?next=%2Fadmin" : undefined}
      />
    );
  if (!read.pending) return null;
  return read.data === undefined ? (
    <AdminSkeleton label={label} shape={shape} />
  ) : (
    <p role="status">{label}…</p>
  );
}
