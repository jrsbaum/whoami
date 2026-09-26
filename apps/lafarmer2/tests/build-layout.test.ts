import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(workspaceRoot, relativePath), "utf8")) as Record<string, unknown>;

describe("apps/lafarmer2 workspace layout", () => {
  it("keeps an isolated Three.js app off the root lobby graph", () => {
    const rootPackage = readJson("package.json");
    const serverPackage = readJson("apps/server/package.json");
    const webPackage = readJson("apps/web/package.json");
    expect(rootPackage.workspaces).toEqual(["apps/*", "packages/*"]);
    expect(serverPackage.dependencies).toMatchObject({ "@lafarmer2/content": "file:../../packages/content" });
    expect(webPackage.dependencies).toMatchObject({
      "@lafarmer2/content": "file:../../packages/content",
      three: expect.any(String)
    });
    expect(webPackage.dependencies).not.toHaveProperty("phaser");
    expect(existsSync(resolve(workspaceRoot, "apps/server/src/index.ts"))).toBe(true);
    expect(existsSync(resolve(workspaceRoot, "apps/web/src/main.ts"))).toBe(true);
    expect(existsSync(resolve(workspaceRoot, "infra"))).toBe(false);
  });
});
