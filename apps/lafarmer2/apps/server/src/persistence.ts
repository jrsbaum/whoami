import { Pool } from "pg";
import { createInMemoryRepositories } from "./in-memory-store.js";
import { createPostgresRepositories, initializePostgresSchema } from "./postgres-store.js";
import type { RepositoryBundle } from "./repositories.js";

export type Persistence = {
  kind: "memory" | "postgres";
  repositories: RepositoryBundle;
  initialize: () => Promise<void>;
  close: () => Promise<void>;
};

export type PersistenceOptions = {
  repositories?: RepositoryBundle;
  databaseUrl?: string | null;
  environment?: string;
};

/** Selects PostgreSQL only for a configured non-test runtime; tests and local runs without DATABASE_URL stay in memory. */
export function createPersistence(options: PersistenceOptions = {}): Persistence {
  if (options.repositories) {
    return {
      kind: "memory",
      repositories: options.repositories,
      initialize: async () => undefined,
      close: async () => undefined
    };
  }

  const databaseUrl = options.databaseUrl !== undefined ? options.databaseUrl : process.env.DATABASE_URL;
  const environment = options.environment ?? process.env.NODE_ENV;
  if (!databaseUrl || environment === "test") {
    return {
      kind: "memory",
      repositories: createInMemoryRepositories(),
      initialize: async () => undefined,
      close: async () => undefined
    };
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: parsePositiveInteger(process.env.DATABASE_POOL_MAX, 10)
  });
  return {
    kind: "postgres",
    repositories: createPostgresRepositories(pool),
    initialize: () => initializePostgresSchema(pool),
    close: () => pool.end()
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
