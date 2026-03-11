import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import * as echarts from "echarts/core";
import { HeatmapChart, LineChart } from "echarts/charts";
import {
  TooltipComponent,
  GridComponent,
  LegendComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import {
  createEffect,
  createMemo,
  ErrorBoundary,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from "solid-js";
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
import {
  fetchService,
  fetchServiceLogs,
  serviceQueryOptions,
  serviceLogsQueryOptions,
  workspacesQueryOptions,
} from "~/lib/api";
import { cn } from "~/lib/utils";

echarts.use([
  LineChart,
  HeatmapChart,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export const Route = createFileRoute(
  "/$workspaceId/$projectId/$environmentId/$serviceId/",
)({
  component: ServiceDetail,
});

type WorkspaceOption = {
  id: string;
  name: string;
};

type ProjectOption = {
  id: string;
  name: string;
};

type EnvironmentOption = {
  id: string;
  name: string;
};

type ServiceOption = {
  serviceId: string;
  name: string;
};

type HistogramBucket = {
  le: number;
  count: number;
};

type LatencyHistogram = {
  id: number;
  deploymentId: string;
  windowStart: string;
  windowEnd: string;
  totalCount: number;
  buckets: HistogramBucket[];
  p50: number;
  p90: number;
  p99: number;
  p999: number;
};

type ServiceData = NonNullable<Awaited<ReturnType<typeof fetchService>>>;
type ServiceLogsData = NonNullable<
  Awaited<ReturnType<typeof fetchServiceLogs>>
>;

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

function formatBucketLabel(bucket: HistogramBucket): string {
  return formatDuration(bucket.le);
}

function formatBucketRange(
  bucket: HistogramBucket,
  previousLe: number,
): string {
  if (previousLe <= 0) {
    return `0-${formatDuration(bucket.le)}`;
  }

  return `${formatDuration(previousLe)}-${formatDuration(bucket.le)}`;
}

function approximatePercentile(
  buckets: HistogramBucket[],
  totalCount: number,
  percentile: number,
): number {
  if (totalCount === 0 || buckets.length === 0) {
    return 0;
  }

  const targetCount = percentile * totalCount;
  let index = 0;

  while (index < buckets.length && buckets[index]!.count < targetCount) {
    index++;
  }

  if (index >= buckets.length) {
    return buckets[buckets.length - 1]!.le;
  }

  const bucketLe = buckets[index]!.le;
  const bucketCount = buckets[index]!.count;
  const previousLe = index > 0 ? buckets[index - 1]!.le : 0;
  const previousCount = index > 0 ? buckets[index - 1]!.count : 0;

  if (bucketCount === previousCount) {
    return previousLe;
  }

  const fraction =
    (targetCount - previousCount) / (bucketCount - previousCount);
  return previousLe + fraction * (bucketLe - previousLe);
}

function aggregateHistogramsByWindow(histograms: LatencyHistogram[]) {
  const grouped = new Map<
    string,
    {
      windowStart: string;
      windowEnd: string;
      totalCount: number;
      buckets: HistogramBucket[];
    }
  >();

  for (const histogram of histograms) {
    const existing = grouped.get(histogram.windowStart);
    if (!existing) {
      grouped.set(histogram.windowStart, {
        windowStart: histogram.windowStart,
        windowEnd: histogram.windowEnd,
        totalCount: histogram.totalCount,
        buckets: histogram.buckets.map((bucket) => ({ ...bucket })),
      });
      continue;
    }

    existing.totalCount += histogram.totalCount;
    existing.windowEnd =
      new Date(existing.windowEnd).getTime() >
      new Date(histogram.windowEnd).getTime()
        ? existing.windowEnd
        : histogram.windowEnd;

    for (const [index, bucket] of histogram.buckets.entries()) {
      if (!existing.buckets[index]) {
        existing.buckets[index] = { ...bucket };
        continue;
      }

      existing.buckets[index]!.count += bucket.count;
    }
  }

  return [...grouped.values()]
    .sort(
      (a, b) =>
        new Date(a.windowStart).getTime() - new Date(b.windowStart).getTime(),
    )
    .map((histogram) => ({
      ...histogram,
      p50: approximatePercentile(histogram.buckets, histogram.totalCount, 0.5),
      p90: approximatePercentile(histogram.buckets, histogram.totalCount, 0.9),
      p99: approximatePercentile(histogram.buckets, histogram.totalCount, 0.99),
      p999: approximatePercentile(
        histogram.buckets,
        histogram.totalCount,
        0.999,
      ),
    }));
}

function buildLineSeries(
  histograms: Array<{
    p50: number;
    p90: number;
    p99: number;
    p999: number;
  }>,
) {
  return [
    {
      name: "p50",
      type: "line",
      data: histograms.map(
        (histogram) => Math.round(histogram.p50 * 100) / 100,
      ),
      smooth: false,
      symbol: "none",
      lineStyle: { width: 1.5 },
      color: "hsl(220, 80%, 55%)",
    },
    {
      name: "p90",
      type: "line",
      data: histograms.map(
        (histogram) => Math.round(histogram.p90 * 100) / 100,
      ),
      smooth: false,
      symbol: "none",
      lineStyle: { width: 1.5 },
      color: "hsl(152, 38%, 42%)",
    },
    {
      name: "p99",
      type: "line",
      data: histograms.map(
        (histogram) => Math.round(histogram.p99 * 100) / 100,
      ),
      smooth: false,
      symbol: "none",
      lineStyle: { width: 1.5 },
      color: "hsl(44, 74%, 52%)",
    },
    {
      name: "p99.9",
      type: "line",
      data: histograms.map(
        (histogram) => Math.round(histogram.p999 * 100) / 100,
      ),
      smooth: false,
      symbol: "none",
      lineStyle: { width: 1.5 },
      color: "hsl(1, 62%, 44%)",
    },
  ];
}

function buildHeatmapCells(
  histograms: Array<{
    buckets: HistogramBucket[];
  }>,
) {
  const buckets = histograms[0]?.buckets ?? [];
  const labels = buckets.map((bucket) => formatBucketLabel(bucket));
  const ranges = buckets.map((bucket, index) => {
    const previousLe = index > 0 ? buckets[index - 1]!.le : 0;
    return formatBucketRange(bucket, previousLe);
  });
  const cells: Array<[number, number, number, number]> = [];
  let maxCount = 0;
  let maxIntensity = 0;

  for (const [timeIndex, histogram] of histograms.entries()) {
    for (const [bucketIndex, bucket] of histogram.buckets.entries()) {
      const previousCount =
        bucketIndex > 0 ? histogram.buckets[bucketIndex - 1]!.count : 0;
      const bucketCount = Math.max(0, bucket.count - previousCount);
      maxCount = Math.max(maxCount, bucketCount);
      const intensity = Math.sqrt(bucketCount);
      maxIntensity = Math.max(maxIntensity, intensity);
      cells.push([timeIndex, bucketIndex, intensity, bucketCount]);
    }
  }

  return {
    labels,
    ranges,
    cells,
    maxCount,
    maxIntensity,
  };
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

function LatencyChart(props: { histograms: LatencyHistogram[] }) {
  let chartContainer!: HTMLDivElement;
  let chart: ReturnType<typeof echarts.init> | null = null;
  const [chartMode, setChartMode] = createSignal<"line" | "heatmap">("line");

  const hasData = createMemo(() => (props.histograms.length ?? 0) > 0);

  const aggregatedHistograms = createMemo(() => {
    if (!props.histograms.length) {
      return [];
    }

    return aggregateHistogramsByWindow(props.histograms);
  });

  const timestamps = createMemo(() =>
    aggregatedHistograms().map((histogram) => histogram.windowStart),
  );

  const heatmapData = createMemo(() =>
    buildHeatmapCells(aggregatedHistograms()),
  );
  const heatmapLabelStep = createMemo(() =>
    Math.max(1, Math.ceil(heatmapData().labels.length / 7)),
  );
  const chartDescription = createMemo(() =>
    chartMode() === "line"
      ? "Percentile response times over 10-second windows"
      : "Request density by latency bucket over 10-second windows",
  );

  onMount(() => {
    chart = echarts.init(chartContainer);

    const observer = new ResizeObserver(() => chart?.resize());
    observer.observe(chartContainer);

    onCleanup(() => {
      observer.disconnect();
      chart?.dispose();
    });
  });

  createEffect(() => {
    if (!chart) return;

    if (!props.histograms.length) {
      chart.clear();
      return;
    }

    const aggregated = aggregatedHistograms();
    const timestampValues = timestamps();
    const heatmap = heatmapData();
    const labelStep = heatmapLabelStep();

    chart.setOption(
      {
        backgroundColor: "transparent",
        tooltip:
          chartMode() === "line"
            ? {
                trigger: "axis",
                backgroundColor: "hsl(250, 21%, 11%)",
                borderColor: "hsl(246, 11%, 22%)",
                textStyle: {
                  color: "hsl(0, 0%, 100%)",
                  fontFamily: "Inter, sans-serif",
                  fontSize: 12,
                },
                formatter(
                  params: Array<{
                    seriesName: string;
                    value: number;
                    color: string;
                    dataIndex: number;
                  }>,
                ) {
                  if (!params.length) return "";
                  const header = `<div style="margin-bottom:4px;font-weight:600">${new Date(timestampValues[params[0].dataIndex]!).toLocaleTimeString()}</div>`;
                  const rows = params
                    .map(
                      (param) =>
                        `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:${param.color}">${param.seriesName}</span><span style="font-family:monospace">${formatDuration(param.value)}</span></div>`,
                    )
                    .join("");
                  return header + rows;
                },
              }
            : {
                position: "top",
                backgroundColor: "hsl(250, 21%, 11%)",
                borderColor: "hsl(246, 11%, 22%)",
                textStyle: {
                  color: "hsl(0, 0%, 100%)",
                  fontFamily: "Inter, sans-serif",
                  fontSize: 12,
                },
                formatter(param: { data: [number, number, number, number] }) {
                  const [timeIndex, bucketIndex, _intensity, bucketCount] =
                    param.data;
                  return [
                    `<div style="font-weight:600;margin-bottom:4px">${new Date(timestampValues[timeIndex]!).toLocaleTimeString()}</div>`,
                    `<div>Latency ${heatmap.ranges[bucketIndex]}</div>`,
                    `<div style="display:flex;justify-content:space-between;gap:12px"><span>Requests</span><span style="font-family:monospace">${bucketCount.toLocaleString()}</span></div>`,
                  ].join("");
                },
              },
        legend:
          chartMode() === "line"
            ? {
                data: ["p50", "p90", "p99", "p99.9"],
                textStyle: { color: "hsl(246, 6%, 65%)", fontSize: 12 },
                top: 0,
              }
            : undefined,
        visualMap:
          chartMode() === "heatmap"
            ? {
                min: 0,
                max: Math.max(1, heatmap.maxIntensity),
                show: false,
                dimension: 2,
                inRange: {
                  color: [
                    "rgba(20, 34, 56, 0.16)",
                    "rgba(53, 112, 186, 0.52)",
                    "rgba(82, 189, 182, 0.72)",
                    "rgba(255, 196, 61, 0.9)",
                    "rgba(255, 94, 58, 1)",
                  ],
                },
              }
            : undefined,
        grid: {
          left: 72,
          right: chartMode() === "heatmap" ? 24 : 16,
          top: 40,
          bottom: 32,
        },
        xAxis: {
          type: "category",
          data: timestampValues,
          axisLabel: {
            color: "hsl(246, 6%, 55%)",
            formatter(value: string) {
              return new Date(value).toLocaleTimeString();
            },
            fontSize: 11,
          },
          axisLine: { lineStyle: { color: "hsl(246, 11%, 22%)" } },
          splitLine: { show: false },
        },
        yAxis: {
          type: chartMode() === "line" ? "value" : "category",
          data: chartMode() === "heatmap" ? heatmap.labels : undefined,
          name: chartMode() === "line" ? "Latency (ms)" : "Latency bucket",
          nameTextStyle: { color: "hsl(246, 6%, 55%)", fontSize: 11 },
          axisLabel: {
            color: "hsl(246, 6%, 55%)",
            fontSize: 11,
            formatter(value: string, index: number) {
              if (chartMode() === "heatmap" && index % labelStep !== 0) {
                return "";
              }

              return value;
            },
          },
          axisLine: { lineStyle: { color: "hsl(246, 11%, 22%)" } },
          splitLine: {
            show: chartMode() === "line",
            lineStyle: { color: "hsl(246, 11%, 22%)", type: "dashed" },
          },
        },
        series:
          chartMode() === "line"
            ? buildLineSeries(aggregated)
            : [
                {
                  name: "Request density",
                  type: "heatmap",
                  data: heatmap.cells,
                  progressive: 0,
                  itemStyle: {
                    borderWidth: 0,
                    borderRadius: 2,
                  },
                  emphasis: {
                    itemStyle: {
                      borderColor: "hsl(0, 0%, 100%)",
                      borderWidth: 1,
                    },
                  },
                },
              ],
        animation: false,
      },
      true,
    );
  });

  return (
    <div class="border-border border-b px-12 py-8">
      <h2 class="text-foreground text-lg font-semibold">Tail Latency</h2>
      <p class="text-muted-foreground mt-1 text-xs">{chartDescription()}</p>
      <div class="mt-4 inline-flex rounded-lg border border-white/10 bg-black/10 p-1">
        <button
          type="button"
          class={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            chartMode() === "line"
              ? "text-foreground bg-white/10"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setChartMode("line")}
        >
          Line
        </button>
        <button
          type="button"
          class={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            chartMode() === "heatmap"
              ? "text-foreground bg-white/10"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setChartMode("heatmap")}
        >
          Heatmap
        </button>
      </div>
      <Show when={!hasData()}>
        <p class="border-border text-muted-foreground mt-4 rounded-lg border px-4 py-3 text-sm">
          No latency data available yet.
        </p>
      </Show>
      <Show when={hasData() && chartMode() === "heatmap"}>
        <p class="text-muted-foreground mt-4 text-xs">
          Warmer cells mean more requests landed in that latency bucket during a
          10-second window.
        </p>
      </Show>
      <div
        ref={chartContainer}
        class="mt-4 h-[300px] w-full"
        classList={{ hidden: !hasData() }}
      />
    </div>
  );
}

function ServiceDetail() {
  return (
    <Layout>
      <Header>
        <ErrorBoundary fallback={() => <ServiceHeaderControlsError />}>
          <Suspense fallback={<ServiceHeaderControlsSkeleton />}>
            <ServiceHeaderControls />
          </Suspense>
        </ErrorBoundary>
      </Header>

      <Content class="bg-[radial-gradient(circle_at_center,var(--grid-dot)_1.05px,transparent_0)] bg-size-[22px_22px] p-4 md:p-6">
        <section class="mx-auto w-full max-w-[1200px]">
          <div class="border-border bg-secondary-background overflow-hidden rounded-2xl border">
            <ErrorBoundary
              fallback={(error) => <ServiceContentError error={error} />}
            >
              <Suspense fallback={<ServiceContentSkeleton />}>
                <ServiceContentSection />
              </Suspense>
            </ErrorBoundary>

            <ErrorBoundary
              fallback={(error) => <ServiceLogsError error={error} />}
            >
              <Suspense fallback={<ServiceLogsSkeleton />}>
                <ServiceLogsSection />
              </Suspense>
            </ErrorBoundary>
          </div>
        </section>
      </Content>
    </Layout>
  );
}

function ServiceHeaderControls() {
  const params = Route.useParams();
  const navigate = useNavigate();
  const workspacesQuery = useQuery(() => workspacesQueryOptions());

  const workspaces = createMemo(() => workspacesQuery.data?.workspaces ?? []);

  const selectedWorkspace = createMemo(() =>
    workspaces().find((workspace) => workspace.id === params().workspaceId),
  );

  const selectedProject = createMemo(() =>
    selectedWorkspace()?.projects.find(
      (project) => project.id === params().projectId,
    ),
  );

  const selectedEnvironment = createMemo(() =>
    selectedProject()?.environments.find(
      (environment) => environment.id === params().environmentId,
    ),
  );

  const workspaceOptions = createMemo<WorkspaceOption[]>(() =>
    workspaces().map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
    })),
  );

  const projectOptions = createMemo<ProjectOption[]>(() => {
    const workspace = selectedWorkspace();
    if (!workspace) {
      return [];
    }

    return workspace.projects.map((project) => ({
      id: project.id,
      name: project.name,
    }));
  });

  const environmentOptions = createMemo<EnvironmentOption[]>(() => {
    const project = selectedProject();
    if (!project) {
      return [];
    }

    return project.environments.filter(
      (environment) => environment.serviceInstances.length > 0,
    );
  });

  const serviceOptions = createMemo<ServiceOption[]>(() => {
    const environment = selectedEnvironment();
    if (!environment) {
      return [];
    }

    return environment.serviceInstances.map((instance) => ({
      serviceId: instance.serviceId,
      name: instance.serviceName,
    }));
  });

  function onWorkspaceChange(nextWorkspaceId: string | null): void {
    if (!nextWorkspaceId || nextWorkspaceId === params().workspaceId) {
      return;
    }

    const nextWorkspace = workspaces().find(
      (workspace) => workspace.id === nextWorkspaceId,
    );
    if (!nextWorkspace) {
      return;
    }

    const nextProject = nextWorkspace.projects[0];
    if (!nextProject) {
      return;
    }

    const nextEnvironment = nextProject.environments.find(
      (environment) => environment.serviceInstances.length > 0,
    );
    const nextServiceId = nextEnvironment?.serviceInstances[0]?.serviceId;
    if (!nextEnvironment || !nextServiceId) {
      return;
    }

    void navigate({
      to: "/$workspaceId/$projectId/$environmentId/$serviceId",
      params: {
        workspaceId: nextWorkspaceId,
        projectId: nextProject.id,
        environmentId: nextEnvironment.id,
        serviceId: nextServiceId,
      },
    });
  }

  function onProjectChange(nextProjectId: string | null): void {
    if (!nextProjectId || nextProjectId === params().projectId) {
      return;
    }

    const nextProject = selectedWorkspace()?.projects.find(
      (project) => project.id === nextProjectId,
    );
    if (!nextProject) {
      return;
    }

    const nextEnvironment = nextProject.environments.find(
      (environment) => environment.serviceInstances.length > 0,
    );
    const nextServiceId = nextEnvironment?.serviceInstances[0]?.serviceId;
    if (!nextEnvironment || !nextServiceId) {
      return;
    }

    void navigate({
      to: "/$workspaceId/$projectId/$environmentId/$serviceId",
      params: {
        workspaceId: params().workspaceId,
        projectId: nextProjectId,
        environmentId: nextEnvironment.id,
        serviceId: nextServiceId,
      },
    });
  }

  function onEnvironmentChange(nextEnvironmentId: string | null): void {
    if (!nextEnvironmentId || nextEnvironmentId === params().environmentId) {
      return;
    }

    const nextEnvironment = selectedProject()?.environments.find(
      (environment) => environment.id === nextEnvironmentId,
    );
    const nextServiceId = nextEnvironment?.serviceInstances[0]?.serviceId;
    if (!nextEnvironment || !nextServiceId) {
      return;
    }

    void navigate({
      to: "/$workspaceId/$projectId/$environmentId/$serviceId",
      params: {
        workspaceId: params().workspaceId,
        projectId: params().projectId,
        environmentId: nextEnvironmentId,
        serviceId: nextServiceId,
      },
    });
  }

  function onServiceChange(nextServiceId: string | null): void {
    if (!nextServiceId || nextServiceId === params().serviceId) {
      return;
    }

    void navigate({
      to: "/$workspaceId/$projectId/$environmentId/$serviceId",
      params: {
        workspaceId: params().workspaceId,
        projectId: params().projectId,
        environmentId: params().environmentId,
        serviceId: nextServiceId,
      },
    });
  }

  return (
    <div class="flex items-center gap-1">
      <Select<WorkspaceOption>
        options={workspaceOptions()}
        optionValue="id"
        optionTextValue="name"
        value={workspaceOptions().find(
          (option) => option.id === params().workspaceId,
        )}
        onChange={(nextOption) => onWorkspaceChange(nextOption?.id ?? null)}
        itemComponent={(props) => (
          <SelectItem item={props.item}>{props.item.rawValue.name}</SelectItem>
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

      <span class="text-border">/</span>

      <Select<ProjectOption>
        options={projectOptions()}
        optionValue="id"
        optionTextValue="name"
        value={projectOptions().find(
          (option) => option.id === params().projectId,
        )}
        onChange={(nextOption) => onProjectChange(nextOption?.id ?? null)}
        itemComponent={(props) => (
          <SelectItem item={props.item}>{props.item.rawValue.name}</SelectItem>
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
          (option) => option.id === params().environmentId,
        )}
        onChange={(nextOption) => onEnvironmentChange(nextOption?.id ?? null)}
        itemComponent={(props) => (
          <SelectItem item={props.item}>{props.item.rawValue.name}</SelectItem>
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

      <span class="text-border">/</span>

      <Select<ServiceOption>
        options={serviceOptions()}
        optionValue="serviceId"
        optionTextValue="name"
        value={serviceOptions().find(
          (option) => option.serviceId === params().serviceId,
        )}
        onChange={(nextOption) =>
          onServiceChange(nextOption?.serviceId ?? null)
        }
        itemComponent={(props) => (
          <SelectItem item={props.item}>{props.item.rawValue.name}</SelectItem>
        )}
      >
        <SelectTrigger>
          <SelectValue<ServiceOption>>
            {(state) => state.selectedOption()?.name ?? "Service"}
          </SelectValue>
        </SelectTrigger>
        <SelectHiddenSelect />
        <SelectContent />
      </Select>
    </div>
  );
}

function ServiceContentSection() {
  const params = Route.useParams();
  const serviceQuery = useQuery(
    () =>
      params() &&
      serviceQueryOptions(params().serviceId, params().environmentId),
  );

  return (
    <Show
      when={serviceQuery.data}
      fallback={
        <div class="px-12 py-8">
          <p class="border-border text-muted-foreground rounded-lg border px-4 py-3 text-sm">
            Service data is unavailable.
          </p>
        </div>
      }
    >
      {(resolvedData) => <ServiceOverviewSection data={resolvedData()} />}
    </Show>
  );
}

function ServiceLogsSection() {
  const params = Route.useParams();
  const serviceLogsQuery = useQuery(
    () =>
      params() &&
      serviceLogsQueryOptions(params().serviceId, params().environmentId),
  );

  return (
    <Show
      when={serviceLogsQuery.data}
      fallback={
        <div class="px-12 py-8">
          <p class="border-border text-muted-foreground rounded-lg border px-4 py-3 text-sm">
            Service logs are unavailable.
          </p>
        </div>
      }
    >
      {(resolvedData) => (
        <>
          <LatencySection data={resolvedData()} />
          <HttpLogsSection data={resolvedData()} />
        </>
      )}
    </Show>
  );
}

function ServiceOverviewSection(props: { data: ServiceData }) {
  return (
    <div class="border-border border-b px-12 pt-12 pb-8">
      <h1 class="text-foreground text-3xl font-semibold tracking-tight">
        {props.data.serviceInstance.serviceName}
      </h1>

      <Show
        when={props.data.serviceInstance.activeDeployments.length > 0}
        fallback={
          <p class="text-muted-foreground mt-2 text-sm">
            No active deployments
          </p>
        }
      >
        <div class="mt-4 flex flex-col gap-2">
          <For each={props.data.serviceInstance.activeDeployments}>
            {(dep) => (
              <div class="flex flex-wrap items-center gap-3 text-sm">
                <span
                  class={cn(
                    "inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-medium uppercase",
                    deploymentStatusColor(dep.status),
                  )}
                >
                  {dep.status}
                </span>
                <span class="text-muted-foreground">
                  {formatTimestamp(dep.createdAt)}
                </span>
                <span class="text-muted-foreground font-mono text-xs">
                  {dep.id}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="border-border bg-muted mt-5 grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <ServiceStat
          label="Region"
          value={props.data.serviceInstance.region ?? "-"}
        />
        <ServiceStat
          label="Replicas"
          value={(props.data.serviceInstance.numReplicas ?? 1).toString()}
        />
        <ServiceStat
          label="Restart Policy"
          value={`${props.data.serviceInstance.restartPolicyType}${
            props.data.serviceInstance.restartPolicyMaxRetries > 0
              ? ` (max ${props.data.serviceInstance.restartPolicyMaxRetries})`
              : ""
          }`}
        />
        <Show when={props.data.serviceInstance.healthcheckPath}>
          {(path) => <ServiceStat label="Health Check" value={path()} mono />}
        </Show>
        <Show when={props.data.serviceInstance.startCommand}>
          {(cmd) => <ServiceStat label="Start Command" value={cmd()} mono />}
        </Show>
        <Show when={props.data.serviceInstance.buildCommand}>
          {(cmd) => <ServiceStat label="Build Command" value={cmd()} mono />}
        </Show>
        <Show when={props.data.serviceInstance.rootDirectory}>
          {(dir) => <ServiceStat label="Root Directory" value={dir()} mono />}
        </Show>
      </div>
    </div>
  );
}

function ServiceStat(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span class="text-muted-foreground text-[11px] tracking-[0.14em] uppercase">
        {props.label}
      </span>
      <p class={cn("text-card-foreground mt-1", props.mono && "font-mono")}>
        {props.value}
      </p>
    </div>
  );
}

function LatencySection(props: { data: ServiceLogsData }) {
  return (
    <LatencyChart histograms={props.data.histograms as LatencyHistogram[]} />
  );
}

function HttpLogsSection(props: { data: ServiceLogsData }) {
  return (
    <div class="px-12 py-8">
      <h2 class="text-foreground text-lg font-semibold">HTTP Logs</h2>
      <p class="text-muted-foreground mt-1 text-xs">
        Last {props.data.httpLogs.length.toLocaleString()} requests from this
        histogram page
      </p>

      <Show
        when={props.data.httpLogs.length > 0}
        fallback={
          <p class="border-border text-muted-foreground mt-4 rounded-lg border px-4 py-3 text-sm">
            No HTTP logs available.
          </p>
        }
      >
        <div class="border-border mt-4 overflow-x-auto rounded-md border">
          <table class="w-full text-left text-xs">
            <thead class="border-border text-muted-foreground border-b">
              <tr>
                <th class="px-3 py-2 font-semibold whitespace-nowrap">
                  Timestamp
                </th>
                <th class="px-3 py-2 font-semibold whitespace-nowrap">
                  Method
                </th>
                <th class="px-3 py-2 font-semibold whitespace-nowrap">Path</th>
                <th class="px-3 py-2 font-semibold whitespace-nowrap">Host</th>
                <th class="px-3 py-2 font-semibold whitespace-nowrap">
                  Status
                </th>
                <th class="px-3 py-2 font-semibold whitespace-nowrap">Total</th>
                <th class="px-3 py-2 font-semibold whitespace-nowrap">
                  Upstream
                </th>
                <th class="px-3 py-2 font-semibold whitespace-nowrap">
                  Edge Region
                </th>
                <th class="px-3 py-2 font-semibold whitespace-nowrap">
                  Request ID
                </th>
                <th class="px-3 py-2 font-semibold whitespace-nowrap">
                  Deployment
                </th>
              </tr>
            </thead>
            <tbody class="divide-border divide-y">
              <For each={props.data.httpLogs}>
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
                    <td class="text-muted-foreground px-3 py-1.5 font-mono whitespace-nowrap">
                      {log.deploymentId}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
}

function ServiceHeaderControlsSkeleton() {
  return (
    <div class="flex items-center gap-2">
      <Skeleton height={40} width={144} class="rounded-lg" />
      <span class="text-border">/</span>
      <Skeleton height={40} width={144} class="rounded-lg" />
      <span class="text-border">/</span>
      <Skeleton height={40} width={128} class="rounded-lg" />
      <span class="text-border">/</span>
      <Skeleton height={40} width={128} class="rounded-lg" />
    </div>
  );
}

function ServiceContentSkeleton() {
  return (
    <div class="border-border border-b px-12 pt-12 pb-8">
      <div class="space-y-3">
        <Skeleton height={40} width={288} class="rounded-lg" />
        <Skeleton height={16} width={160} class="rounded-md" />
      </div>

      <div class="mt-4 flex flex-col gap-2">
        <DeploymentRowSkeleton />
        <DeploymentRowSkeleton />
        <DeploymentRowSkeleton />
      </div>

      <div class="border-border bg-muted mt-5 grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <ServiceStatSkeleton />
        <ServiceStatSkeleton />
        <ServiceStatSkeleton />
        <ServiceStatSkeleton />
        <ServiceStatSkeleton />
        <ServiceStatSkeleton />
      </div>
    </div>
  );
}

function DeploymentRowSkeleton() {
  return (
    <div class="flex flex-wrap items-center gap-3">
      <Skeleton height={24} width={96} class="rounded-md" />
      <Skeleton height={16} width={176} class="rounded-md" />
      <Skeleton height={16} width={128} class="rounded-md" />
    </div>
  );
}

function ServiceStatSkeleton() {
  return (
    <div class="space-y-2">
      <Skeleton height={12} width={80} class="rounded-md" />
      <Skeleton height={16} width={112} class="rounded-md" />
    </div>
  );
}

function ServiceLogsSkeleton() {
  return (
    <>
      <div class="border-border border-b px-12 py-8">
        <Skeleton height={28} width={128} class="rounded-md" />
        <Skeleton height={12} width={288} class="mt-2 rounded-md" />
        <div class="mt-4 inline-flex rounded-lg border border-white/10 bg-black/10 p-1">
          <Skeleton height={32} width={64} class="rounded-md" />
          <Skeleton height={32} width={80} class="ml-1 rounded-md" />
        </div>
        <Skeleton height={300} class="mt-4 w-full rounded-xl" />
      </div>

      <div class="px-12 py-8">
        <div class="space-y-2">
          <Skeleton height={28} width={112} class="rounded-md" />
          <Skeleton height={12} width={288} class="rounded-md" />
        </div>

        <div class="border-border mt-4 overflow-hidden rounded-md border">
          <div class="border-border flex items-center gap-6 border-b px-3 py-2">
            <For each={[120, 64, 160, 132, 72, 88, 96, 112, 128, 120]}>
              {(width) => (
                <Skeleton height={12} width={width} class="rounded-md" />
              )}
            </For>
          </div>
          <div class="divide-border divide-y">
            <For each={[0, 1, 2, 3, 4, 5]}>{() => <HttpLogRowSkeleton />}</For>
          </div>
        </div>
      </div>
    </>
  );
}

function HttpLogRowSkeleton() {
  return (
    <div class="grid min-w-[980px] grid-cols-[120px_64px_160px_132px_72px_88px_96px_112px_128px_120px] gap-3 px-3 py-2">
      <Skeleton height={12} width={96} class="rounded-md" />
      <Skeleton height={12} width={48} class="rounded-md" />
      <Skeleton height={12} width={128} class="rounded-md" />
      <Skeleton height={12} width={96} class="rounded-md" />
      <Skeleton height={12} width={40} class="rounded-md" />
      <Skeleton height={12} width={56} class="rounded-md" />
      <Skeleton height={12} width={64} class="rounded-md" />
      <Skeleton height={12} width={80} class="rounded-md" />
      <Skeleton height={12} width={96} class="rounded-md" />
      <Skeleton height={12} width={80} class="rounded-md" />
    </div>
  );
}

function ServiceHeaderControlsError() {
  return (
    <span class="text-muted-foreground text-xs">
      Route controls unavailable
    </span>
  );
}

function ServiceContentError(props: { error: unknown }) {
  const message =
    props.error instanceof Error ? props.error.message : "Please try again.";

  return (
    <div class="mx-6 my-6 rounded-lg border border-rose-300/40 bg-rose-900/40 px-4 py-3 text-sm text-rose-50">
      <p class="font-medium">Failed to load service details.</p>
      <p class="mt-1 text-rose-100/80">{message}</p>
    </div>
  );
}

function ServiceLogsError(props: { error: unknown }) {
  const message =
    props.error instanceof Error ? props.error.message : "Please try again.";

  return (
    <div class="px-12 py-8">
      <div class="rounded-lg border border-rose-300/40 bg-rose-900/40 px-4 py-3 text-sm text-rose-50">
        <p class="font-medium">Failed to load service logs.</p>
        <p class="mt-1 text-rose-100/80">{message}</p>
      </div>
    </div>
  );
}
