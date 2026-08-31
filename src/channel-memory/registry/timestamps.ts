const SLACK_TIMESTAMP = /^\d+\.\d{1,6}$/;

interface TimestampParts {
  readonly seconds: bigint;
  readonly fraction: string;
}

function timestampParts(value: unknown): TimestampParts | null {
  if (typeof value !== 'string' || !SLACK_TIMESTAMP.test(value)) return null;
  const [seconds, fraction] = value.split('.');
  if (seconds === undefined || fraction === undefined) return null;

  try {
    return { seconds: BigInt(seconds), fraction: fraction.padEnd(6, '0') };
  } catch {
    return null;
  }
}

export function isSlackTimestamp(value: unknown): value is string {
  return timestampParts(value) !== null;
}

/** enrollment.md §3: numeric ordering without float conversion or identity normalization. */
export function compareMessageTs(a: string, b: string): -1 | 0 | 1 | null {
  const left = timestampParts(a);
  const right = timestampParts(b);
  if (!left || !right) return null;

  if (left.seconds !== right.seconds) return left.seconds < right.seconds ? -1 : 1;
  if (left.fraction === right.fraction) return 0;
  return left.fraction < right.fraction ? -1 : 1;
}

export function withinCaptureFloor(
  enrollment: { readonly capture_floor_ts: string },
  messageTs: string,
): boolean {
  const comparison = compareMessageTs(messageTs, enrollment.capture_floor_ts);
  return comparison !== null && comparison >= 0;
}

export function slackTimestampToISOString(value: string): string | null {
  const parts = timestampParts(value);
  if (!parts) return null;

  const milliseconds = parts.seconds * 1_000n + BigInt(parts.fraction.slice(0, 3));
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  const date = new Date(Number(milliseconds));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
