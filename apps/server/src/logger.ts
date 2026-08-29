// ---------------------------------------------------------------------------
// logger — the ONE place that writes structured JSON log lines to stdout.
// Every other module logs through this instead of raw `console.log`, so
// output is uniformly parseable by whatever the deployment platform's log
// pipeline is (Railway/Fly/Render/CloudWatch/whatever — they all ingest
// "one JSON object per line" the same way, and none of them parse a
// hand-formatted string reliably).
//
// Deliberately minimal: no external logging library. A JSON.stringify call
// per line covers everything this app needs (level, message, structured
// fields, ISO timestamp) without adding a dependency whose main value —
// log shipping, rotation, multi-transport — this process doesn't need
// (stdout capture is the deployment platform's job, not this app's).
//
// Levels are informational only (all lines go to stdout, not split by
// stream) — splitting error->stderr is a common convention but would
// complicate `docker logs`/platform log viewers that already interleave
// both streams by arrival order; keeping everything on one stream keeps
// chronological ordering exact.
// ---------------------------------------------------------------------------

type LogFields = Record<string, unknown>;

function write(level: 'info' | 'warn' | 'error', message: string, fields?: LogFields): void {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...fields,
    }),
  );
}

export const logger = {
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
};
