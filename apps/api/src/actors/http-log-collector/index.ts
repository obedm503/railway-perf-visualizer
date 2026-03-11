import { and, desc, gte, lt, lte, sql } from "drizzle-orm";
import { actor, ActorDefinition } from "rivetkit";
import { db } from "rivetkit/db/drizzle";
import { workflow } from "rivetkit/workflow";
import { auth } from "../../auth";
import {
  fetchDeployments,
  fetchHttpLogsWithVariables,
  nextLogs,
  previousLogs,
} from "../../railway";
import migrations from "./drizzle/migrations";
import {
  approximatePercentile,
  computeWindowHistograms,
  type HistogramBucket,
} from "./histogram";
import { histograms, httpLogs, schema } from "./schema";

type HttpLogCollectorInput = {
  serviceId: string;
  environmentId: string;
  userId: string;
};

type HttpLogCollectorState = {
  serviceId: string;
  environmentId: string;
  userId: string;
  lastFetchedAt: number | null;
};

const collector = actor({
  createState(_ctx, input: HttpLogCollectorInput): HttpLogCollectorState {
    return {
      serviceId: input.serviceId,
      environmentId: input.environmentId,
      userId: input.userId,
      lastFetchedAt: null,
    };
  },

  db: db({ schema, migrations }),

  run: workflow(async function run(ctx) {
    await ctx.loop("poll-logs", async function pollLogs(loopCtx) {
      await loopCtx.step("fetch-and-process", async function fetchAndProcess() {
        const { serviceId, environmentId, userId, lastFetchedAt } =
          loopCtx.state;

        // 1. Get access token
        const accessToken = await auth.getAccessToken(userId);
        if (!accessToken) {
          loopCtx.log.warn({ msg: "No access token available", userId });
          return;
        }

        // 2. Fetch deployments from the last 7 days
        let deployments;
        try {
          deployments = await fetchDeployments(
            accessToken,
            serviceId,
            environmentId,
          );
        } catch (error) {
          loopCtx.log.error({
            msg: "Failed to fetch deployments",
            error,
          });
          return;
        }

        if (deployments.length === 0) {
          loopCtx.log.info({ msg: "No deployments in the last 7 days" });
          return;
        }

        // 3. Fetch logs for each deployment
        let totalInserted = 0;
        const allNewLogs: Array<{
          deploymentId: string;
          timestamp: Date;
          totalDuration: number;
        }> = [];

        for (const deployment of deployments) {
          try {
            const variables =
              lastFetchedAt === null
                ? previousLogs({
                    deploymentId: deployment.id,
                    from: new Date(),
                    take: 5000,
                  })
                : nextLogs({
                    deploymentId: deployment.id,
                    to: new Date(lastFetchedAt),
                    take: 5000,
                  });

            const logs = await fetchHttpLogsWithVariables(
              accessToken,
              variables,
            );

            if (logs.length === 0) {
              continue;
            }

            // 4. Insert logs with dedup (ON CONFLICT DO NOTHING)
            const values = logs.map((log) => {
              return {
                requestId: log.requestId,
                deploymentId: log.deploymentId,
                timestamp: new Date(log.timestamp),
                method: log.method,
                path: log.path,
                host: log.host,
                httpStatus: log.httpStatus,
                totalDuration: log.totalDuration,
                upstreamRqDuration: log.upstreamRqDuration,
                edgeRegion: log.edgeRegion,
              };
            });

            // Insert in batches to avoid SQLite variable limits
            const BATCH_SIZE = 100;
            for (let i = 0; i < values.length; i += BATCH_SIZE) {
              const batch = values.slice(i, i + BATCH_SIZE);
              await loopCtx.db
                .insert(httpLogs)
                .values(batch)
                .onConflictDoNothing({ target: httpLogs.requestId });
            }

            totalInserted += logs.length;

            // Collect for histogram computation
            for (const log of logs) {
              allNewLogs.push({
                deploymentId: log.deploymentId,
                timestamp: new Date(log.timestamp),
                totalDuration: log.totalDuration,
              });
            }

            loopCtx.log.info({
              msg: "Fetched logs for deployment",
              deploymentId: deployment.id,
              count: logs.length,
            });
          } catch (error) {
            loopCtx.log.error({
              msg: "Failed to fetch logs for deployment",
              deploymentId: deployment.id,
              error,
            });
          }
        }

        // 5. Compute histograms for new log windows
        if (allNewLogs.length > 0) {
          const windowHistograms = computeWindowHistograms(allNewLogs);
          const now = new Date();

          for (const hist of windowHistograms) {
            // Upsert: if we already have a histogram for this window+deployment,
            // replace it (the window may have gotten more data since last cycle)
            await loopCtx.db
              .insert(histograms)
              .values({
                deploymentId: hist.deploymentId,
                windowStart: hist.windowStart,
                windowEnd: hist.windowEnd,
                buckets: JSON.stringify(hist.buckets),
                totalCount: hist.totalCount,
                createdAt: now,
              })
              .onConflictDoUpdate({
                target: [histograms.deploymentId, histograms.windowStart],
                set: {
                  buckets: sql`excluded.buckets`,
                  totalCount: sql`excluded.total_count`,
                  windowEnd: sql`excluded.window_end`,
                  createdAt: sql`excluded.created_at`,
                },
              });
          }

          loopCtx.log.info({
            msg: "Computed histograms",
            windowCount: windowHistograms.length,
            logCount: totalInserted,
          });
        }

        // 6. Update lastFetchedAt
        loopCtx.state.lastFetchedAt = Date.now();
      });

      await loopCtx.sleep("wait-1min", 60_000);
    });
  }),

  actions: {
    updateUser(c, userId: string) {
      c.state.userId = userId;
    },

    async getLogsPage(
      c,
      params: { before?: string; limit?: number },
    ): Promise<{
      histograms: Array<{
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
      }>;
      httpLogs: Array<{
        deploymentId: string;
        requestId: string;
        timestamp: string;
        method: string;
        path: string;
        host: string;
        httpStatus: number;
        totalDuration: number;
        upstreamRqDuration: number;
        edgeRegion: string;
      }>;
      nextCursor: string | null;
    }> {
      const limit = Math.min(params.limit ?? 100, 1000);
      const histogramConditions = [];

      if (params.before) {
        histogramConditions.push(
          lt(histograms.windowStart, new Date(params.before)),
        );
      }

      const histogramRows = await c.db
        .select()
        .from(histograms)
        .where(
          histogramConditions.length > 0
            ? and(...histogramConditions)
            : undefined,
        )
        .orderBy(desc(histograms.windowStart))
        .limit(limit + 1);

      const hasMore = histogramRows.length > limit;
      const resultHistogramRows = hasMore
        ? histogramRows.slice(0, limit)
        : histogramRows;

      const nextCursor = hasMore
        ? resultHistogramRows[
            resultHistogramRows.length - 1
          ]!.windowStart.toISOString()
        : null;

      const mappedHistograms = resultHistogramRows.map((row) => {
        const buckets = JSON.parse(row.buckets) as HistogramBucket[];
        return {
          id: row.id,
          deploymentId: row.deploymentId,
          windowStart: row.windowStart.toISOString(),
          windowEnd: row.windowEnd.toISOString(),
          totalCount: row.totalCount,
          buckets,
          p50: approximatePercentile(buckets, row.totalCount, 0.5),
          p90: approximatePercentile(buckets, row.totalCount, 0.9),
          p99: approximatePercentile(buckets, row.totalCount, 0.99),
          p999: approximatePercentile(buckets, row.totalCount, 0.999),
        };
      });

      if (resultHistogramRows.length === 0) {
        return {
          histograms: mappedHistograms,
          httpLogs: [],
          nextCursor,
        };
      }

      const oldestWindowStart =
        resultHistogramRows[resultHistogramRows.length - 1]!.windowStart;
      const newestWindowEnd = resultHistogramRows[0]!.windowEnd;

      const httpLogRows = await c.db
        .select()
        .from(httpLogs)
        .where(
          and(
            gte(httpLogs.timestamp, oldestWindowStart),
            lte(httpLogs.timestamp, newestWindowEnd),
          ),
        )
        .orderBy(desc(httpLogs.timestamp));

      return {
        histograms: mappedHistograms,
        httpLogs: httpLogRows.map((row) => ({
          deploymentId: row.deploymentId,
          requestId: row.requestId,
          timestamp: row.timestamp.toISOString(),
          method: row.method,
          path: row.path,
          host: row.host,
          httpStatus: row.httpStatus,
          totalDuration: row.totalDuration,
          upstreamRqDuration: row.upstreamRqDuration,
          edgeRegion: row.edgeRegion,
        })),
        nextCursor,
      };
    },

    async getHistograms(
      c,
      params: { before?: string; limit?: number },
    ): Promise<{
      histograms: Array<{
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
      }>;
      nextCursor: string | null;
    }> {
      const limit = Math.min(params.limit ?? 100, 1000);
      const conditions = [];

      if (params.before) {
        conditions.push(lt(histograms.windowStart, new Date(params.before)));
      }

      const rows = await c.db
        .select()
        .from(histograms)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(histograms.windowStart))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const resultRows = hasMore ? rows.slice(0, limit) : rows;

      const nextCursor = hasMore
        ? resultRows[resultRows.length - 1].windowStart.toISOString()
        : null;

      return {
        histograms: resultRows.map((row) => {
          const buckets = JSON.parse(row.buckets) as HistogramBucket[];
          return {
            id: row.id,
            deploymentId: row.deploymentId,
            windowStart: row.windowStart.toISOString(),
            windowEnd: row.windowEnd.toISOString(),
            totalCount: row.totalCount,
            buckets,
            p50: approximatePercentile(buckets, row.totalCount, 0.5),
            p90: approximatePercentile(buckets, row.totalCount, 0.9),
            p99: approximatePercentile(buckets, row.totalCount, 0.99),
            p999: approximatePercentile(buckets, row.totalCount, 0.999),
          };
        }),
        nextCursor,
      };
    },

    async getHttpLogs(
      c,
      params: { before?: string; limit?: number },
    ): Promise<{
      httpLogs: Array<{
        deploymentId: string;
        requestId: string;
        timestamp: string;
        method: string;
        path: string;
        host: string;
        httpStatus: number;
        totalDuration: number;
        upstreamRqDuration: number;
        edgeRegion: string;
      }>;
      nextCursor: string | null;
    }> {
      const limit = Math.min(params.limit ?? 100, 1000);
      const conditions = [];

      if (params.before) {
        conditions.push(lt(httpLogs.timestamp, new Date(params.before)));
      }

      const rows = await c.db
        .select()
        .from(httpLogs)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(httpLogs.timestamp))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const resultRows = hasMore ? rows.slice(0, limit) : rows;

      const nextCursor = hasMore
        ? resultRows[resultRows.length - 1].timestamp.toISOString()
        : null;

      return {
        httpLogs: resultRows.map((row) => ({
          deploymentId: row.deploymentId,
          requestId: row.requestId,
          timestamp: row.timestamp.toISOString(),
          method: row.method,
          path: row.path,
          host: row.host,
          httpStatus: row.httpStatus,
          totalDuration: row.totalDuration,
          upstreamRqDuration: row.upstreamRqDuration,
          edgeRegion: row.edgeRegion,
        })),
        nextCursor,
      };
    },
  },
});

type Actions = {
  updateUser(c: any, userId: string): void;
  getLogsPage(
    c: any,
    params: { before?: string; limit?: number },
  ): Promise<{
    histograms: Array<{
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
    }>;
    httpLogs: Array<{
      deploymentId: string;
      requestId: string;
      timestamp: string;
      method: string;
      path: string;
      host: string;
      httpStatus: number;
      totalDuration: number;
      upstreamRqDuration: number;
      edgeRegion: string;
    }>;
    nextCursor: string | null;
  }>;
  getHistograms(
    c: any,
    params: { before?: string; limit?: number },
  ): Promise<{
    histograms: Array<{
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
    }>;
    nextCursor: string | null;
  }>;
  getHttpLogs(
    c: any,
    params: { before?: string; limit?: number },
  ): Promise<{
    httpLogs: Array<{
      deploymentId: string;
      requestId: string;
      timestamp: string;
      method: string;
      path: string;
      host: string;
      httpStatus: number;
      totalDuration: number;
      upstreamRqDuration: number;
      edgeRegion: string;
    }>;
    nextCursor: string | null;
  }>;
};

export const httpLogCollector = collector as ActorDefinition<
  HttpLogCollectorState,
  unknown,
  unknown,
  unknown,
  unknown,
  any,
  any,
  any,
  Actions
>;
