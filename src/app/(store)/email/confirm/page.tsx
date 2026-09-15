import Link from "next/link";

const STATUS_CONTENT: Record<string, { title: string; message: string }> = {
  success: {
    title: "Subscription confirmed",
    message:
      "You’re all set to receive newsletter & product posting alerts from Realdealkickzsc.",
  },
  already: {
    title: "Already subscribed",
    message: "This email is already subscribed to updates.",
  },
  expired: {
    title: "Link expired",
    message: "This confirmation link expired. Please sign up again to get a fresh link.",
  },
  invalid: {
    title: "Invalid link",
    message: "That confirmation link isn’t valid. Please try again.",
  },
  error: {
    title: "Something went wrong",
    message: "We couldn’t confirm your subscription. Please try again.",
  },
};

type SearchParams = { status?: string | string[] };

export default async function EmailConfirmPage({
  searchParams,
}: {
  // Next's generated types in your build are expecting Promise-ish here
  searchParams?: Promise<SearchParams>;
}) {
  const resolved = searchParams ? await searchParams : undefined;

  const raw = resolved?.status;
  const status = Array.isArray(raw) ? raw[0] : (raw ?? "success");
  const content = STATUS_CONTENT[status] ?? STATUS_CONTENT.success;

  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center">
      <h1 className="mb-4 text-4xl font-bold text-white">{content.title}</h1>
      <p className="mb-8 text-zinc-400">{content.message}</p>
      <Link
        href="/"
        className="inline-flex cursor-pointer items-center justify-center gap-2 bg-red-600 px-6 py-3 font-bold text-white transition-colors hover:bg-red-700"
      >
        Back to home
      </Link>
    </div>
  );
}
