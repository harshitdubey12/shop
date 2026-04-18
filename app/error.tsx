"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center text-sm text-neutral-400">
      <p>Something went wrong. Please try again.</p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-6 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.16em] text-white"
      >
        Retry
      </button>
    </div>
  );
}
