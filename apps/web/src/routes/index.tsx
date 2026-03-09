import { useQuery } from "@tanstack/solid-query";
import { Link, createFileRoute, redirect } from "@tanstack/solid-router";
import {
  authLoginUrl,
  meQueryOptions,
  workspacesQueryOptions,
} from "../lib/api";
import { Layout } from "~/components/layout";
import { RailwayIcon } from "~/components/logo";
import { ErrorBoundary, Show, Suspense } from "solid-js";
import { Header } from "~/components/header";
import { Skeleton } from "~/components/ui/skeleton";

export const Route = createFileRoute("/")({
  async beforeLoad({ context }) {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    if (!me) {
      return;
    }

    const workspaceResult = await context.queryClient.ensureQueryData(
      workspacesQueryOptions(),
    );
    const firstWorkspaceId = workspaceResult?.workspaces.at(0)?.id;
    if (!firstWorkspaceId) {
      return;
    }

    throw redirect({
      to: "/$workspaceId",
      params: { workspaceId: firstWorkspaceId },
    });
  },
  component: Home,
});

function Home() {
  return (
    <Layout>
      <Header />
      <div class="p-4 md:p-6">
        <section class="border-border bg-secondary-background mx-auto w-full max-w-xl rounded-2xl border p-8 sm:p-10">
          <ErrorBoundary fallback={(error) => <HomeCardError error={error} />}>
            <Suspense fallback={<HomeCardSkeleton />}>
              <HomeCardContent />
            </Suspense>
          </ErrorBoundary>
        </section>
      </div>
    </Layout>
  );
}

function HomeCardContent() {
  const meQuery = useQuery(() => meQueryOptions());
  const loginUrl = authLoginUrl(`${window.location.origin}/`);

  return (
    <Show when={!meQuery.data}>
      <h1 class="text-foreground mt-3 text-3xl font-semibold tracking-tight">
        Railway Performance Visualizer
      </h1>

      <div class="mt-6 space-y-4">
        <Link
          to={loginUrl}
          class="border-active-border bg-primary text-primary-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          aria-label="Sign in with Railway"
        >
          <span class="inline-flex h-6 w-6 items-center justify-center rounded-full">
            <RailwayIcon />
          </span>
          Sign in with Railway
        </Link>
      </div>
    </Show>
  );
}

function HomeCardSkeleton() {
  return (
    <div class="space-y-6">
      <div class="space-y-3">
        <Skeleton height={16} width={96} class="rounded-md" />
        <Skeleton height={36} class="w-full max-w-[24rem] rounded-lg" />
      </div>

      <div class="space-y-4">
        <Skeleton height={16} class="w-full max-w-[18rem] rounded-md" />
        <div class="inline-flex items-center gap-2 rounded-lg border border-transparent px-4 py-2">
          <Skeleton height={24} width={24} class="rounded-full" />
          <Skeleton height={16} width={160} class="rounded-md" />
        </div>
      </div>
    </div>
  );
}

function HomeCardError(props: { error: unknown }) {
  const message =
    props.error instanceof Error ? props.error.message : "Please try again.";

  return (
    <div class="rounded-xl border border-rose-300/40 bg-rose-900/40 px-4 py-3 text-sm text-rose-50">
      <p class="font-medium">Failed to check your Railway session.</p>
      <p class="mt-1 text-rose-100/80">{message}</p>
    </div>
  );
}
