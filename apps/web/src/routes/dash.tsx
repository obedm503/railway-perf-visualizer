import { useQuery } from "@tanstack/solid-query";
import { Link, createFileRoute, redirect } from "@tanstack/solid-router";
import { meQueryOptions } from "../lib/api";

export const Route = createFileRoute("/dash")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    if (!me) {
      throw redirect({ to: "/" });
    }
  },
  component: Dash,
});

function Dash() {
  const meQuery = useQuery(() => meQueryOptions());

  return (
    <section class="w-full rounded-2xl border border-slate-900/10 bg-white/80 p-8 shadow-[0_12px_40px_-24px_rgba(16,24,40,0.5)] backdrop-blur-sm sm:p-10">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
        Protected Route
      </p>
      <h1 class="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
        /dash
      </h1>
      <p class="mt-4 text-sm text-slate-600">
        You can see this only when authenticated.
      </p>
      {meQuery.data ? (
        <div class="mt-6 rounded-xl border border-slate-300/50 bg-slate-50 px-4 py-3 text-sm text-slate-800">
          Signed in as{" "}
          {meQuery.data.name ?? meQuery.data.email ?? meQuery.data.sub}
        </div>
      ) : null}
      <div class="mt-6">
        <Link
          to="/"
          class="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Back to Home
        </Link>
      </div>
    </section>
  );
}
