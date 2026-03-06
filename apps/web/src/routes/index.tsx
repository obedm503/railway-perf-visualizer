import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { Link, createFileRoute } from "@tanstack/solid-router";
import { authLoginUrl, logout, meQueryOptions } from "../lib/api";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const meQuery = useQuery(() => meQueryOptions());
  const queryClient = useQueryClient();

  function onLogin() {
    const callbackURL = `${window.location.origin}/`;
    window.location.href = authLoginUrl(callbackURL);
  }

  async function onLogout() {
    await logout();
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  return (
    <section class="w-full rounded-2xl border border-emerald-900/10 bg-white/80 p-8 shadow-[0_12px_40px_-24px_rgba(16,24,40,0.5)] backdrop-blur-sm sm:p-10">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
        Railway Perf Visualizer
      </p>
      <h1 class="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
        Sign in to continue
      </h1>

      {meQuery.isLoading ? (
        <p class="mt-6 text-sm text-slate-600">Checking session...</p>
      ) : meQuery.data ? (
        <div class="mt-6 space-y-4">
          <div class="rounded-xl border border-emerald-300/50 bg-emerald-50 px-4 py-3">
            <p class="text-sm font-medium text-emerald-900">
              {meQuery.data.name ?? "Unnamed user"}
            </p>
            <p class="text-sm text-emerald-900/80">
              {meQuery.data.email ?? "No email"}
            </p>
            <p class="text-xs text-emerald-900/70">sub: {meQuery.data.sub}</p>
          </div>
          <div class="flex gap-3">
            <Link
              to="/dash"
              class="inline-flex items-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800"
            >
              Go to /dash
            </Link>
            <button
              type="button"
              onClick={onLogout}
              class="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Logout
            </button>
          </div>
        </div>
      ) : (
        <div class="mt-6 space-y-4">
          {/* <p class="text-sm text-slate-600">
            Sign in with Railway to view your account and access protected
            routes.
          </p> */}
          <button
            type="button"
            onClick={onLogin}
            class="inline-flex items-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800"
          >
            Sign in with Railway
          </button>
        </div>
      )}
    </section>
  );
}
