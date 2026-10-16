import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Runs the project's wrangler with the given args against the remote JO_KV namespace. */
export function wrangler(args: string[], opts: { capture?: boolean } = {}): string {
  const bin = join(ROOT, "node_modules", ".bin", "wrangler");
  const out = execFileSync(bin, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  return out ?? "";
}

export function kvArgs(...rest: string[]): string[] {
  return ["kv", "key", ...rest, "--binding=JO_KV", "--remote"];
}

/** Reads KEY=value pairs from .dev.vars (for scripts that call providers directly). */
export function readDevVars(): Record<string, string> {
  const path = join(ROOT, ".dev.vars");
  if (!existsSync(path)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) vars[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return vars;
}

export function readJoMd(): string {
  return readFileSync(join(ROOT, "content", "jo.md"), "utf8");
}
