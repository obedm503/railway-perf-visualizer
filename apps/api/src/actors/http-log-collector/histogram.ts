/**
 * Histogram computation for latency data using sqrt(2)-factor bucket boundaries.
 *
 * Bucket boundaries increase by a factor of sqrt(2) from 1ms to ~65536ms (2^16).
 * This gives ~33 boundaries, providing accurate percentile approximation (~0.66% error)
 * with minimal storage overhead.
 *
 * Histograms use cumulative counts (like Prometheus): bucket[i].count = number of
 * values <= bucket[i].le. This makes percentile computation via linear interpolation
 * straightforward and allows histogram merging by summing counts.
 *
 * @see https://igor.io/latency/
 * @see https://blog.bramp.net/post/2018/01/16/measuring-percentile-latency/
 */

const SQRT2 = Math.SQRT2;
const MAX_BOUNDARY = 65536; // 2^16 ms (~65.5 seconds)

export type HistogramBucket = {
  /** Upper bound of this bucket in milliseconds. +Infinity for the final catch-all bucket. */
  le: number;
  /** Cumulative count: number of values <= le. */
  count: number;
};

/**
 * Generate bucket boundaries using sqrt(2) factor.
 * Produces boundaries: 1, sqrt(2), 2, 2*sqrt(2), 4, 4*sqrt(2), ..., up to MAX_BOUNDARY.
 * Rounds to 2 decimal places for clean JSON serialization.
 */
function generateBoundaries(): number[] {
  const boundaries: number[] = [];
  let value = 1;
  while (value <= MAX_BOUNDARY) {
    boundaries.push(Math.round(value * 100) / 100);
    value *= SQRT2;
  }
  // Ensure we end cleanly at MAX_BOUNDARY if rounding didn't land exactly
  if (boundaries[boundaries.length - 1] !== MAX_BOUNDARY) {
    boundaries.push(MAX_BOUNDARY);
  }
  return boundaries;
}

/** Pre-computed bucket boundaries. Shared across all histogram computations. */
export const BUCKET_BOUNDARIES: readonly number[] = generateBoundaries();

/** The 10-second window size in milliseconds. */
export const WINDOW_SIZE_MS = 10_000;

/**
 * Align a timestamp down to the nearest 10-second window boundary.
 */
export function alignToWindow(timestampMs: number): number {
  return Math.floor(timestampMs / WINDOW_SIZE_MS) * WINDOW_SIZE_MS;
}

/**
 * Compute a cumulative histogram from an array of duration values (in ms).
 *
 * Each bucket stores the cumulative count of values <= its upper bound (le).
 * The final implicit +Inf bucket is represented by the totalCount.
 */
export function computeHistogram(durations: number[]): HistogramBucket[] {
  // Initialize counts for each boundary
  const counts = new Array<number>(BUCKET_BOUNDARIES.length).fill(0);

  for (const duration of durations) {
    // Find the first boundary >= duration using binary search
    let lo = 0;
    let hi = BUCKET_BOUNDARIES.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (BUCKET_BOUNDARIES[mid] < duration) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    // If duration exceeds all boundaries, it still counts in the last bucket
    if (lo < counts.length) {
      counts[lo]++;
    } else {
      counts[counts.length - 1]++;
    }
  }

  // Convert to cumulative counts
  const buckets: HistogramBucket[] = [];
  let cumulative = 0;
  for (let i = 0; i < BUCKET_BOUNDARIES.length; i++) {
    cumulative += counts[i];
    buckets.push({ le: BUCKET_BOUNDARIES[i], count: cumulative });
  }

  return buckets;
}

/**
 * Approximate a percentile value from a cumulative histogram using linear
 * interpolation between bucket boundaries.
 *
 * This is the standard approach used by Prometheus and described in both
 * reference articles. For a target percentile p:
 * 1. Compute targetCount = p * totalCount
 * 2. Find the first bucket where cumulative count >= targetCount
 * 3. Linearly interpolate within that bucket's boundary range
 *
 * @param buckets Cumulative histogram buckets (count is monotonically increasing)
 * @param totalCount Total number of observations in the histogram
 * @param p Percentile as a fraction (e.g. 0.99 for p99)
 * @returns Approximate percentile value in milliseconds
 */
export function approximatePercentile(
  buckets: HistogramBucket[],
  totalCount: number,
  p: number,
): number {
  if (totalCount === 0 || buckets.length === 0) {
    return 0;
  }

  const targetCount = p * totalCount;

  // Find the first bucket where cumulative count >= targetCount
  let i = 0;
  while (i < buckets.length && buckets[i].count < targetCount) {
    i++;
  }

  // All values exceed the last boundary
  if (i >= buckets.length) {
    return buckets[buckets.length - 1].le;
  }

  const bucketLe = buckets[i].le;
  const bucketCount = buckets[i].count;
  const prevLe = i > 0 ? buckets[i - 1].le : 0;
  const prevCount = i > 0 ? buckets[i - 1].count : 0;

  // Avoid division by zero when the bucket has no new observations
  if (bucketCount === prevCount) {
    return prevLe;
  }

  const fraction = (targetCount - prevCount) / (bucketCount - prevCount);
  return prevLe + fraction * (bucketLe - prevLe);
}

/**
 * Group log entries by their 10-second window and deployment, then compute
 * histograms for each group.
 *
 * Returns an array of objects ready to be inserted into the histograms table.
 */
export function computeWindowHistograms(
  logs: Array<{
    deploymentId: string;
    timestamp: Date;
    totalDuration: number;
  }>,
): Array<{
  deploymentId: string;
  windowStart: Date;
  windowEnd: Date;
  buckets: HistogramBucket[];
  totalCount: number;
}> {
  // Group logs by (deploymentId, windowStart)
  const groups = new Map<
    string,
    {
      deploymentId: string;
      windowStartMs: number;
      durations: number[];
    }
  >();

  for (const log of logs) {
    const windowStartMs = alignToWindow(log.timestamp.getTime());
    const key = `${log.deploymentId}:${windowStartMs}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        deploymentId: log.deploymentId,
        windowStartMs,
        durations: [],
      };
      groups.set(key, group);
    }
    group.durations.push(log.totalDuration);
  }

  // Compute histogram for each group
  const results: Array<{
    deploymentId: string;
    windowStart: Date;
    windowEnd: Date;
    buckets: HistogramBucket[];
    totalCount: number;
  }> = [];

  for (const group of groups.values()) {
    const buckets = computeHistogram(group.durations);
    results.push({
      deploymentId: group.deploymentId,
      windowStart: new Date(group.windowStartMs),
      windowEnd: new Date(group.windowStartMs + WINDOW_SIZE_MS),
      buckets,
      totalCount: group.durations.length,
    });
  }

  return results;
}
