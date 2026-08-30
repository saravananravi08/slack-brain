import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { RetentionConfig } from '@mastra/core/storage';
import { LibSQLStore } from '@mastra/libsql';

export const STORAGE_RETENTION = {
  observability: {
    spans: { maxAge: '30d' },
  },
} as const satisfies RetentionConfig;

interface StorageEnvironment {
  HOME?: string;
  XDG_DATA_HOME?: string;
}

interface CreateMastraStorageOptions {
  databaseUrl?: string;
  authToken?: string;
  repositoryRoot?: string;
}

export class StorageUnavailableError extends Error {
  readonly code = 'storage_unavailable';

  constructor() {
    super('Persistent storage is unavailable.');
    this.name = 'StorageUnavailableError';
  }
}

class GistLibSQLStore extends LibSQLStore {
  override async init(): Promise<void> {
    try {
      await super.init();
    } catch {
      throw new StorageUnavailableError();
    }
  }
}

export function defaultDatabaseUrl(
  environment: StorageEnvironment = process.env,
): string {
  const configuredDataHome = environment.XDG_DATA_HOME?.trim();
  const configuredHome = environment.HOME?.trim();
  const home = configuredHome && isAbsolute(configuredHome) ? configuredHome : homedir();
  const dataHome =
    configuredDataHome && isAbsolute(configuredDataHome)
      ? configuredDataHome
      : join(home, '.local', 'share');

  return pathToFileURL(join(dataHome, 'slack-brain', 'mastra.db')).href;
}

function pathIsInside(childPath: string, parentPath: string): boolean {
  const pathFromParent = relative(resolve(parentPath), resolve(childPath));
  return (
    pathFromParent === '' ||
    (pathFromParent !== '..' &&
      !pathFromParent.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromParent))
  );
}

function resolveDatabaseUrl(
  databaseUrl: string | undefined,
  repositoryRoot: string,
): { url: string; filePath?: string } {
  const value = databaseUrl?.trim() || defaultDatabaseUrl();

  try {
    if (value.startsWith('file:')) {
      const fileReference = value.slice('file:'.length);
      if (!fileReference.startsWith('/') || fileReference === '/:memory:') {
        throw new StorageUnavailableError();
      }

      const parsed = new URL(value);
      if (parsed.hostname && parsed.hostname !== 'localhost') {
        throw new StorageUnavailableError();
      }

      const filePath = fileURLToPath(parsed);
      if (!isAbsolute(filePath) || pathIsInside(filePath, repositoryRoot)) {
        throw new StorageUnavailableError();
      }

      return { url: pathToFileURL(filePath).href, filePath };
    }

    const parsed = new URL(value);
    if (
      !['libsql:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      throw new StorageUnavailableError();
    }

    return { url: parsed.toString() };
  } catch {
    throw new StorageUnavailableError();
  }
}

export function createMastraStorage({
  databaseUrl,
  authToken,
  repositoryRoot = process.cwd(),
}: CreateMastraStorageOptions = {}): LibSQLStore {
  const resolved = resolveDatabaseUrl(databaseUrl, repositoryRoot);

  try {
    if (resolved.filePath) {
      mkdirSync(dirname(resolved.filePath), { recursive: true, mode: 0o700 });
    }

    return new GistLibSQLStore({
      id: 'gist-storage',
      url: resolved.url,
      retention: STORAGE_RETENTION,
      ...(authToken ? { authToken } : {}),
    });
  } catch {
    throw new StorageUnavailableError();
  }
}
