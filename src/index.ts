import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ConfigError } from './config.js';
import {
  createFoundationRuntime,
  type FoundationRuntime,
} from './mastra/index.js';

interface SignalTarget {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

export function installShutdownHandlers(
  runtime: Pick<FoundationRuntime, 'stop'>,
  signals: SignalTarget = process,
): () => void {
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= runtime.stop();
    void stopping.catch(() => {
      process.exitCode = 1;
    });
  };

  signals.once('SIGINT', stop);
  signals.once('SIGTERM', stop);

  return () => {
    signals.off('SIGINT', stop);
    signals.off('SIGTERM', stop);
  };
}

export async function main(): Promise<FoundationRuntime> {
  const runtime = await createFoundationRuntime();
  const removeShutdownHandlers = installShutdownHandlers(runtime);

  try {
    await runtime.start();
    return runtime;
  } catch (error) {
    removeShutdownHandlers();
    await runtime.stop().catch(() => undefined);
    throw error;
  }
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;

if (import.meta.url === entryUrl) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof ConfigError ? error.message : 'Gist failed to start.',
    );
    process.exitCode = 1;
  });
}
