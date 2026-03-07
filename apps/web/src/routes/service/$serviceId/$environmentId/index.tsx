import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/solid-router";
import { createMemo, For, Show } from "solid-js";
import { Content } from "~/components/content";
import { Header } from "~/components/header";
import { Layout } from "~/components/layout";
import {
  Select,
  SelectContent,
  SelectHiddenSelect,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  fetchWorkspaces,
  meQueryOptions,
  serviceQueryOptions,
  workspacesQueryOptions,
} from "~/lib/api";

export const Route = createFileRoute("/service/$serviceId/$environmentId/")({
  async beforeLoad({ context }) {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    if (!me) {
      throw redirect({ to: "/" });
    }
  },
  component: ServiceDetail,
});

type ProjectOption = {
  id: string;
  name: string;
};

type EnvironmentOption = {
  id: string;
  name: string;
  firstServiceId: string;
};

function findRouteContext(
  workspaces: NonNullable<
    Awaited<ReturnType<typeof fetchWorkspaces>>
  >["workspaces"],
  serviceId: string,
  environmentId: string,
) {
  for (const workspace of workspaces) {
    for (const project of workspace.projects) {
      for (const environment of project.environments) {
        if (environment.id !== environmentId) {
          continue;
        }

        for (const service of environment.serviceInstances) {
          console.warn({ service }, service.serviceId);
          if (service.serviceId === serviceId) {
            return {
              workspace,
              project,
              environment,
            };
          }
        }
      }
    }
  }

  return null;
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(0)}us`;
  }
  if (ms < 1000) {
    return `${ms.toFixed(1)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function statusColor(status: number): string {
  if (status >= 500) return "text-red-400";
  if (status >= 400) return "text-amber-300";
  if (status >= 300) return "text-blue-300";
  if (status >= 200) return "text-green-400";
  return "text-muted-foreground";
}

function deploymentStatusColor(status: string): string {
  switch (status) {
    case "SUCCESS":
      return "text-green-700 bg-green-200";
    case "FAILED":
    case "CRASHED":
      return "text-red-700 bg-red-200";
    case "BUILDING":
    case "DEPLOYING":
      return "text-blue-700 bg-blue-200";
    case "SLEEPING":
      return "text-gray-700 bg-gray-200";
    case "REMOVED":
      return "text-orange-700 bg-orange-200";
    default:
      return "text-gray-700 bg-gray-200";
  }
}

function ServiceDetail() {
  const params = Route.useParams();
  const navigate = useNavigate();
  const serviceQuery = useQuery(() => {
    console.warn(params());
    return serviceQueryOptions(params().serviceId, params().environmentId);
  });
  const workspacesQuery = useQuery(() => workspacesQueryOptions());

  const routeContext = createMemo(() => {
    const p = params();
    console.log("routeContext", { params: p });
    const workspaces = workspacesQuery.data?.workspaces;
    if (!workspaces || !p) {
      return null;
    }

    return findRouteContext(workspaces, p.serviceId, p.environmentId);
  });

  const projectOptions = createMemo<ProjectOption[]>(() => {
    const currentContext = routeContext();
    if (!currentContext) {
      return [];
    }

    return currentContext.workspace.projects.map((project) => ({
      id: project.id,
      name: project.name,
    }));
  });

  const environmentOptions = createMemo<EnvironmentOption[]>(() => {
    const currentContext = routeContext();
    if (!currentContext) {
      return [];
    }

    return currentContext.project.environments
      .map((environment) => {
        console.warn("environment", environment);
        const firstServiceId = environment.serviceInstances[0]?.serviceId;
        if (!firstServiceId) {
          return null;
        }

        return {
          id: environment.id,
          name: environment.name,
          firstServiceId,
        };
      })
      .filter((option): option is EnvironmentOption => option !== null);
  });

  function onProjectChange(nextProjectId: string | null): void {
    if (!nextProjectId) {
      return;
    }

    const currentContext = routeContext();
    if (!currentContext || nextProjectId === currentContext.project.id) {
      return;
    }

    const nextProject = currentContext.workspace.projects.find(
      (project) => project.id === nextProjectId,
    );
    if (!nextProject) {
      return;
    }

    const nextEnvironment = nextProject.environments[0];
    const nextServiceId = nextEnvironment?.serviceInstances[0]?.serviceId;
    if (!nextEnvironment || !nextServiceId) {
      return;
    }

    void navigate({
      to: "/service/$serviceId/$environmentId",
      params: {
        serviceId: nextServiceId,
        environmentId: nextEnvironment.id,
      },
    });
  }

  function onEnvironmentChange(nextEnvironmentId: string | null): void {
    if (!nextEnvironmentId) {
      return;
    }

    const currentContext = routeContext();
    if (
      !currentContext ||
      nextEnvironmentId === currentContext.environment.id
    ) {
      return;
    }

    const nextEnvironment = currentContext.project.environments.find(
      (environment) => environment.id === nextEnvironmentId,
    );
    const nextServiceId = nextEnvironment?.serviceInstances[0]?.serviceId;
    if (!nextEnvironment || !nextServiceId) {
      return;
    }

    void navigate({
      to: "/service/$serviceId/$environmentId",
      params: {
        serviceId: nextServiceId,
        environmentId: nextEnvironment.id,
      },
    });
  }

  return (
    <Layout>
      <Header>
        <div class="flex items-center gap-1">
          <Select<ProjectOption>
            options={projectOptions()}
            optionValue="id"
            optionTextValue="name"
            value={projectOptions().find(
              (option) => option.id === routeContext()?.project.id,
            )}
            onChange={(nextOption) => onProjectChange(nextOption?.id ?? null)}
            itemComponent={(props) => (
              <SelectItem item={props.item}>
                {props.item.rawValue.name}
              </SelectItem>
            )}
          >
            <SelectTrigger>
              <SelectValue<ProjectOption>>
                {(state) => state.selectedOption()?.name ?? "Project"}
              </SelectValue>
            </SelectTrigger>
            <SelectHiddenSelect />
            <SelectContent />
          </Select>

          <span class="text-border">/</span>

          <Select<EnvironmentOption>
            options={environmentOptions()}
            optionValue="id"
            optionTextValue="name"
            value={environmentOptions().find(
              (option) => option.id === routeContext()?.environment.id,
            )}
            onChange={(nextOption) =>
              onEnvironmentChange(nextOption?.id ?? null)
            }
            itemComponent={(props) => (
              <SelectItem item={props.item}>
                {props.item.rawValue.name}
              </SelectItem>
            )}
          >
            <SelectTrigger>
              <SelectValue<EnvironmentOption>>
                {(state) => state.selectedOption()?.name ?? "Environment"}
              </SelectValue>
            </SelectTrigger>
            <SelectHiddenSelect />
            <SelectContent />
          </Select>
        </div>
      </Header>

      <Content class="bg-[radial-gradient(circle_at_center,var(--grid-dot)_1.05px,transparent_0)] bg-size-[22px_22px] p-4 md:p-6">
        <section class="mx-auto w-full max-w-[1200px]">
          <div class="border-border bg-secondary-background overflow-hidden rounded-2xl border">
            <Show when={serviceQuery.isLoading}>
              <p class="text-muted-foreground px-6 py-8 text-sm">
                Loading service...
              </p>
            </Show>

            <Show when={serviceQuery.error}>
              <p class="text-destructive-foreground mx-6 my-6 rounded-lg border border-rose-300/40 bg-rose-900/40 px-4 py-3 text-sm">
                Failed to load service.
              </p>
            </Show>

            <Show when={serviceQuery.data}>
              {(data) => (
                <>
                  <div class="border-border border-b px-12 pt-12 pb-8">
                    <h1 class="text-foreground text-3xl font-semibold tracking-tight">
                      {data().serviceInstance.serviceName}
                    </h1>

                    <Show
                      when={data().serviceInstance.latestDeployment}
                      fallback={
                        <p class="text-muted-foreground mt-2 text-sm">
                          No active deployment
                        </p>
                      }
                    >
                      {(dep) => (
                        <div class="mt-4 flex flex-wrap items-center gap-3 text-sm">
                          <span
                            class={`inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-medium uppercase ${deploymentStatusColor(dep().status)}`}
                          >
                            {dep().status}
                          </span>
                          <span class="text-muted-foreground">
                            {formatTimestamp(dep().createdAt)}
                          </span>
                        </div>
                      )}
                    </Show>

                    <div class="border-border bg-muted mt-5 grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <span class="text-muted-foreground text-[11px] tracking-[0.14em] uppercase">
                          Region
                        </span>
                        <p class="text-card-foreground mt-1">
                          {data().serviceInstance.region ?? "-"}
                        </p>
                      </div>
                      <div>
                        <span class="text-muted-foreground text-[11px] tracking-[0.14em] uppercase">
                          Replicas
                        </span>
                        <p class="text-card-foreground mt-1">
                          {data().serviceInstance.numReplicas ?? 1}
                        </p>
                      </div>
                      <div>
                        <span class="text-muted-foreground text-[11px] tracking-[0.14em] uppercase">
                          Restart Policy
                        </span>
                        <p class="text-card-foreground mt-1">
                          {data().serviceInstance.restartPolicyType}
                          <Show
                            when={
                              data().serviceInstance.restartPolicyMaxRetries > 0
                            }
                          >
                            {` (max ${data().serviceInstance.restartPolicyMaxRetries})`}
                          </Show>
                        </p>
                      </div>
                      <Show when={data().serviceInstance.healthcheckPath}>
                        {(path) => (
                          <div>
                            <span class="text-muted-foreground text-[11px] tracking-[0.14em] uppercase">
                              Health Check
                            </span>
                            <p class="text-card-foreground mt-1 font-mono">
                              {path()}
                            </p>
                          </div>
                        )}
                      </Show>
                      <Show when={data().serviceInstance.startCommand}>
                        {(cmd) => (
                          <div>
                            <span class="text-muted-foreground text-[11px] tracking-[0.14em] uppercase">
                              Start Command
                            </span>
                            <p class="text-card-foreground mt-1 font-mono">
                              {cmd()}
                            </p>
                          </div>
                        )}
                      </Show>
                      <Show when={data().serviceInstance.buildCommand}>
                        {(cmd) => (
                          <div>
                            <span class="text-muted-foreground text-[11px] tracking-[0.14em] uppercase">
                              Build Command
                            </span>
                            <p class="text-card-foreground mt-1 font-mono">
                              {cmd()}
                            </p>
                          </div>
                        )}
                      </Show>
                      <Show when={data().serviceInstance.rootDirectory}>
                        {(dir) => (
                          <div>
                            <span class="text-muted-foreground text-[11px] tracking-[0.14em] uppercase">
                              Root Directory
                            </span>
                            <p class="text-card-foreground mt-1 font-mono">
                              {dir()}
                            </p>
                          </div>
                        )}
                      </Show>
                    </div>
                  </div>

                  <div class="px-12 py-8">
                    <h2 class="text-foreground text-lg font-semibold">
                      HTTP Logs
                    </h2>
                    <p class="text-muted-foreground mt-1 text-xs">
                      Last {data().httpLogs.length.toLocaleString()} requests
                      for the latest deployment
                    </p>

                    <Show
                      when={data().httpLogs.length > 0}
                      fallback={
                        <p class="border-border text-muted-foreground mt-4 rounded-lg border px-4 py-3 text-sm">
                          No HTTP logs available.
                        </p>
                      }
                    >
                      <div class="border-border mt-4 overflow-x-auto rounded-xl border">
                        <table class="w-full text-left text-xs">
                          <thead class="border-border text-muted-foreground border-b">
                            <tr>
                              <th class="px-3 py-2 font-semibold whitespace-nowrap">
                                Timestamp
                              </th>
                              <th class="px-3 py-2 font-semibold whitespace-nowrap">
                                Method
                              </th>
                              <th class="px-3 py-2 font-semibold whitespace-nowrap">
                                Path
                              </th>
                              <th class="px-3 py-2 font-semibold whitespace-nowrap">
                                Host
                              </th>
                              <th class="px-3 py-2 font-semibold whitespace-nowrap">
                                Status
                              </th>
                              <th class="px-3 py-2 font-semibold whitespace-nowrap">
                                Total
                              </th>
                              <th class="px-3 py-2 font-semibold whitespace-nowrap">
                                Upstream
                              </th>
                              <th class="px-3 py-2 font-semibold whitespace-nowrap">
                                Edge Region
                              </th>
                              <th class="px-3 py-2 font-semibold whitespace-nowrap">
                                Request ID
                              </th>
                            </tr>
                          </thead>
                          <tbody class="divide-border divide-y">
                            <For each={data().httpLogs}>
                              {(log) => (
                                <tr class="transition">
                                  <td class="text-muted-foreground px-3 py-1.5 whitespace-nowrap">
                                    {formatTimestamp(log.timestamp)}
                                  </td>
                                  <td class="text-card-foreground px-3 py-1.5 font-medium whitespace-nowrap">
                                    {log.method}
                                  </td>
                                  <td
                                    class="text-card-foreground max-w-[260px] truncate px-3 py-1.5 font-mono"
                                    title={log.path}
                                  >
                                    {log.path}
                                  </td>
                                  <td
                                    class="text-muted-foreground max-w-[180px] truncate px-3 py-1.5"
                                    title={log.host}
                                  >
                                    {log.host}
                                  </td>
                                  <td
                                    class={`px-3 py-1.5 font-semibold whitespace-nowrap ${statusColor(log.httpStatus)}`}
                                  >
                                    {log.httpStatus}
                                  </td>
                                  <td class="text-card-foreground px-3 py-1.5 whitespace-nowrap">
                                    {formatDuration(log.totalDuration)}
                                  </td>
                                  <td class="text-card-foreground px-3 py-1.5 whitespace-nowrap">
                                    {formatDuration(log.upstreamRqDuration)}
                                  </td>
                                  <td class="text-muted-foreground px-3 py-1.5 whitespace-nowrap">
                                    {log.edgeRegion}
                                  </td>
                                  <td class="text-muted-foreground px-3 py-1.5 font-mono whitespace-nowrap">
                                    {log.requestId}
                                  </td>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                    </Show>
                  </div>
                </>
              )}
            </Show>
          </div>
        </section>
      </Content>
    </Layout>
  );
}
