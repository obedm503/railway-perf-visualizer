import { useQuery } from "@tanstack/solid-query";
import { Link, createFileRoute, redirect } from "@tanstack/solid-router";
import {
  authLoginUrl,
  meQueryOptions,
  workspacesQueryOptions,
} from "../lib/api";
import { Layout } from "~/components/layout";
import { RailwayIcon } from "~/components/logo";
import { Show } from "solid-js";
import { Header } from "~/components/header";

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
  const meQuery = useQuery(() => meQueryOptions());

  const loginUrl = authLoginUrl(`${window.location.origin}/`);

  return (
    <Layout>
      <Header />
      <Show when={!meQuery.data}>
        <div class="p-4 md:p-6">
          <section class="border-border bg-secondary-background mx-auto w-full max-w-xl rounded-2xl border p-8 sm:p-10">
            <h1 class="text-foreground mt-3 text-3xl font-semibold tracking-tight">
              Railway Performance Visualizer
            </h1>

            {meQuery.isLoading ? (
              <p class="text-muted-foreground mt-6 text-sm">
                Checking session...
              </p>
            ) : (
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
            )}
          </section>
        </div>
      </Show>
    </Layout>
  );
}
