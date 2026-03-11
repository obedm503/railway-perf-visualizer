import { QueryClient } from "@tanstack/solid-query";
import {
  Outlet,
  createRootRouteWithContext,
  redirect,
} from "@tanstack/solid-router";
import { meQueryOptions } from "~/lib/api";

export interface RouterContext {
  queryClient: QueryClient;
}

function RootComponent() {
  return <Outlet />;
}

function RootErrorFallback(props: { error: unknown }) {
  const message =
    props.error instanceof Error
      ? props.error.message
      : "An unexpected error interrupted the app.";

  return (
    <main class="bg-background text-foreground flex min-h-screen items-center justify-center px-6">
      <section class="border-border bg-secondary-background w-full max-w-lg rounded-2xl border p-8">
        <p class="text-muted-foreground text-xs font-medium tracking-[0.18em] uppercase">
          Application error
        </p>
        <h1 class="mt-3 text-2xl font-semibold tracking-tight">
          Something went wrong.
        </h1>
        <p class="text-muted-foreground mt-3 text-sm">{message}</p>
        <button
          type="button"
          class="border-border bg-background text-foreground mt-6 inline-flex rounded-lg border px-4 py-2 text-sm font-medium transition hover:brightness-110"
          onClick={() => window.location.reload()}
        >
          Reload app
        </button>
      </section>
    </main>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  async beforeLoad({ context, location }) {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());

    if (!me && location.pathname !== "/login") {
      throw redirect({
        to: "/login",
        search: {
          redirect: location.pathname === "/" ? undefined : location.pathname,
        },
      });
    }

    if (me && location.pathname === "/login") {
      throw redirect({ to: "/" });
    }
  },
  component: RootComponent,
  onError(err) {
    console.error(err);
  },
  errorComponent(props) {
    console.error(props.error, props.info);
    return <RootErrorFallback error={props.error} />;
  },
});
