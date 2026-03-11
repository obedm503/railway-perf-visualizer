import { useQuery } from "@tanstack/solid-query";
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/solid-router";
import { createMemo, ErrorBoundary, For, Show, Suspense } from "solid-js";
import { Content } from "~/components/content";
import { Header } from "~/components/header";
import { Layout } from "~/components/layout";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectHiddenSelect,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { workspacesQueryOptions } from "~/lib/api";

export const Route = createFileRoute("/$workspaceId/")({
  async beforeLoad({ context, params }) {
    const workspaceResult = await context.queryClient.ensureQueryData(
      workspacesQueryOptions(),
    );
    const workspaces = workspaceResult?.workspaces ?? [];
    const firstWorkspaceId = workspaces.at(0)?.id;

    if (!firstWorkspaceId) {
      return;
    }

    const hasWorkspace = workspaces.some(
      (workspace) => workspace.id === params.workspaceId,
    );

    if (!hasWorkspace) {
      throw redirect({
        to: "/$workspaceId",
        params: { workspaceId: firstWorkspaceId },
      });
    }
  },
  component: Dashboard,
});

type ServiceNode = {
  serviceId: string;
  serviceName: string;
  projectId: string;
  envId: string;
  envName: string;
};

type WorkspaceOption = {
  id: string;
  name: string;
  projectCount: number;
};

function collectProjectServiceNodes(project: {
  id: string;
  environments: Array<{
    id: string;
    name: string;
    serviceInstances: Array<{
      serviceId: string;
      serviceName: string;
    }>;
  }>;
}): ServiceNode[] {
  const nodes: ServiceNode[] = [];
  for (const env of project.environments) {
    for (const service of env.serviceInstances) {
      nodes.push({
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        projectId: project.id,
        envId: env.id,
        envName: env.name,
      });
    }
  }

  return nodes;
}

function Dashboard() {
  return (
    <Layout>
      <Header>
        <ErrorBoundary fallback={() => <WorkspaceHeaderError />}>
          <Suspense fallback={<WorkspaceHeaderSkeleton />}>
            <WorkspaceHeaderControls />
          </Suspense>
        </ErrorBoundary>
      </Header>
      <Content>
        <section class="mx-auto w-full max-w-[1160px] space-y-6 p-4 md:p-6">
          <ErrorBoundary
            fallback={(error) => <WorkspaceContentError error={error} />}
          >
            <Suspense fallback={<WorkspaceDashboardSkeleton />}>
              <WorkspaceProjectsSection />
            </Suspense>
          </ErrorBoundary>
        </section>
      </Content>
    </Layout>
  );
}

function WorkspaceHeaderControls() {
  const params = Route.useParams();
  const navigate = useNavigate();
  const workspacesQuery = useQuery(() => workspacesQueryOptions());

  const workspaceOptions = createMemo<WorkspaceOption[]>(() => {
    const workspaces = workspacesQuery.data?.workspaces ?? [];
    return workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      projectCount: workspace.projects.length,
    }));
  });

  function onWorkspaceChange(nextWorkspaceId: string | null): void {
    if (!nextWorkspaceId || nextWorkspaceId === params().workspaceId) {
      return;
    }

    void navigate({
      to: "/$workspaceId",
      params: { workspaceId: nextWorkspaceId },
    });
  }

  return (
    <Select<WorkspaceOption>
      options={workspaceOptions()}
      optionValue="id"
      optionTextValue="name"
      value={workspaceOptions().find(
        (option) => option.id === params().workspaceId,
      )}
      onChange={(nextOption) => onWorkspaceChange(nextOption?.id ?? null)}
      itemComponent={(props) => (
        <SelectItem item={props.item}>
          <div class="flex items-center justify-between gap-3">
            <span>{props.item.rawValue.name}</span>
            <span class="text-muted-foreground text-xs">
              {props.item.rawValue.projectCount} project
              {props.item.rawValue.projectCount === 1 ? "" : "s"}
            </span>
          </div>
        </SelectItem>
      )}
    >
      <SelectTrigger>
        <SelectValue<WorkspaceOption>>
          {(state) => state.selectedOption()?.name ?? "Workspace"}
        </SelectValue>
      </SelectTrigger>
      <SelectHiddenSelect />
      <SelectContent />
    </Select>
  );
}

function WorkspaceProjectsSection() {
  const params = Route.useParams();
  const workspacesQuery = useQuery(() => workspacesQueryOptions());

  const selectedWorkspace = createMemo(() => {
    const workspaceId = params().workspaceId;
    return workspacesQuery.data?.workspaces.find(
      (workspace) => workspace.id === workspaceId,
    );
  });

  return (
    <Show
      when={selectedWorkspace()}
      fallback={
        <div class="border-border text-muted-foreground rounded-xl border p-5 text-sm">
          No workspaces available.
        </div>
      }
    >
      {(workspace) => (
        <div class="space-y-4">
          <div class="flex flex-wrap items-center justify-end gap-4">
            <p class="text-muted-foreground text-xs">
              {workspace().projects.length} project
              {workspace().projects.length === 1 ? "" : "s"}
            </p>
          </div>

          <Show
            when={workspace().projects.length > 0}
            fallback={
              <div class="border-border text-muted-foreground rounded-xl border p-5 text-sm">
                No projects in this workspace.
              </div>
            }
          >
            <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <For each={workspace().projects}>
                {(project) => (
                  <ProjectCard
                    workspaceId={params().workspaceId}
                    project={project}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

function ProjectCard(props: {
  workspaceId: string;
  project: {
    id: string;
    name: string;
    environments: Array<{
      id: string;
      name: string;
      serviceInstances: Array<{
        serviceId: string;
        serviceName: string;
      }>;
    }>;
  };
}) {
  const nodes = createMemo(() => collectProjectServiceNodes(props.project));

  return (
    <article class="border-border bg-secondary-background overflow-hidden rounded-xl border">
      <div class="border-border border-b px-4 py-3">
        <h2 class="text-foreground text-base font-semibold">
          {props.project.name}
        </h2>
      </div>

      <div class="h-full bg-[radial-gradient(circle_at_center,var(--grid-dot)_1.05px,transparent_0)] bg-size-[22px_22px] px-4 py-5">
        <Show
          when={nodes().length > 0}
          fallback={<p class="text-muted-foreground text-sm">No services</p>}
        >
          <div class="flex flex-wrap gap-2">
            <For each={nodes()}>
              {(node) => (
                <Link
                  to="/$workspaceId/$projectId/$environmentId/$serviceId"
                  params={{
                    workspaceId: props.workspaceId,
                    projectId: node.projectId,
                    serviceId: node.serviceId,
                    environmentId: node.envId,
                  }}
                  class="border-border bg-background text-card-foreground hover:border-active-border hover:text-foreground inline-flex h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-xs font-medium transition"
                  title={`${node.serviceName} (${node.envName})`}
                >
                  {node.serviceName}
                </Link>
              )}
            </For>
          </div>
        </Show>
      </div>
    </article>
  );
}

function WorkspaceHeaderSkeleton() {
  return <Skeleton height={40} width={192} class="rounded-lg" />;
}

function WorkspaceDashboardSkeleton() {
  return (
    <div class="space-y-4">
      <div class="flex justify-end">
        <Skeleton height={12} width={80} class="rounded-md" />
      </div>

      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <For each={[0, 1, 2, 3, 4, 5]}>{() => <ProjectCardSkeleton />}</For>
      </div>
    </div>
  );
}

function ProjectCardSkeleton() {
  return (
    <article class="border-border bg-secondary-background overflow-hidden rounded-xl border">
      <div class="border-border border-b px-4 py-3">
        <Skeleton height={20} width={128} class="rounded-md" />
      </div>

      <div class="space-y-3 bg-[radial-gradient(circle_at_center,var(--grid-dot)_1.05px,transparent_0)] bg-size-[22px_22px] px-4 py-5">
        <div class="flex flex-wrap gap-2">
          <Skeleton height={44} width={96} class="rounded-lg" />
          <Skeleton height={44} width={80} class="rounded-lg" />
          <Skeleton height={44} width={112} class="rounded-lg" />
        </div>
        <div class="flex flex-wrap gap-2">
          <Skeleton height={44} width={72} class="rounded-lg" />
          <Skeleton height={44} width={96} class="rounded-lg" />
        </div>
      </div>
    </article>
  );
}

function WorkspaceHeaderError() {
  return (
    <span class="text-muted-foreground text-xs">Workspace unavailable</span>
  );
}

function WorkspaceContentError(props: { error: unknown }) {
  const message =
    props.error instanceof Error ? props.error.message : "Please try again.";

  return (
    <div class="rounded-xl border border-rose-300/40 bg-rose-900/40 px-4 py-3 text-sm text-rose-50">
      <p class="font-medium">Failed to load workspaces.</p>
      <p class="mt-1 text-rose-100/80">{message}</p>
    </div>
  );
}
