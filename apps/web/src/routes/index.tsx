import { createFileRoute, redirect } from "@tanstack/solid-router";
import { workspacesQueryOptions } from "~/lib/api";
import { Layout } from "~/components/layout";
import { Header } from "~/components/header";

export const Route = createFileRoute("/")({
  async beforeLoad({ context }) {
    const workspaceResult = await context.queryClient.ensureQueryData(
      workspacesQueryOptions(),
    );
    const firstWorkspaceId = workspaceResult?.workspaces.at(0)?.id;

    if (firstWorkspaceId) {
      throw redirect({
        to: "/$workspaceId",
        params: { workspaceId: firstWorkspaceId },
      });
    }
  },
  component: Home,
});

function Home() {
  return (
    <Layout>
      <Header />
      <div class="p-4 md:p-6">
        <section class="border-border bg-secondary-background mx-auto w-full max-w-xl rounded-2xl border p-8 sm:p-10">
          <p class="text-muted-foreground text-sm">
            No workspaces available. Create a workspace in Railway to get
            started.
          </p>
        </section>
      </div>
    </Layout>
  );
}
