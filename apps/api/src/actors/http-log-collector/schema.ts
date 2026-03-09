import {
  integer,
  real,
  sqliteTable,
  text,
  index,
  uniqueIndex,
} from "rivetkit/db/drizzle";

export const httpLogs = sqliteTable(
  "http_logs",
  {
    requestId: text("request_id").primaryKey(),
    deploymentId: text("deployment_id").notNull(),
    timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    host: text("host").notNull(),
    httpStatus: integer("http_status").notNull(),
    totalDuration: real("total_duration").notNull(),
    upstreamRqDuration: real("upstream_rq_duration").notNull(),
    edgeRegion: text("edge_region").notNull(),
  },
  (table) => [
    index("http_logs_deployment_idx").on(table.deploymentId),
    index("http_logs_timestamp_idx").on(table.timestamp),
    index("http_logs_deployment_timestamp_idx").on(
      table.deploymentId,
      table.timestamp,
    ),
  ],
);

export const histograms = sqliteTable(
  "histograms",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deploymentId: text("deployment_id").notNull(),
    windowStart: integer("window_start", { mode: "timestamp_ms" }).notNull(),
    windowEnd: integer("window_end", { mode: "timestamp_ms" }).notNull(),
    buckets: text("buckets").notNull(), // JSON: Array<{ le: number; count: number }>
    totalCount: integer("total_count").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("histograms_deployment_window_idx").on(
      table.deploymentId,
      table.windowStart,
    ),
    index("histograms_window_start_idx").on(table.windowStart),
  ],
);

export const schema = { httpLogs, histograms };
