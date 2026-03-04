import { QueryClient } from "@tanstack/solid-query";
import { Outlet, createRootRouteWithContext } from "@tanstack/solid-router";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <main class="min-h-screen bg-[radial-gradient(120%_120%_at_50%_0%,#f5fffa_0%,#edf8f2_45%,#e7f1eb_100%)] text-slate-900">
      <div class="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-6 py-16">
        <Outlet />
      </div>
    </main>
  ),
});
