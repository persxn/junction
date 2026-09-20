import { createRequire } from 'node:module';

/**
 * Loading the Argon2id addon (ruling R17).
 *
 * `@node-rs/argon2`'s own loader walks a list of `require` paths and throws at
 * import time if none of them work. That is fine in a source checkout and fatal
 * in the bundle, where there is no `node_modules` above the entry point — the
 * same problem R17 solved for better-sqlite3 by naming the `.node` file
 * explicitly.
 *
 * So the addon is loaded here, at first use, through a `require` whose argument
 * is a variable: esbuild cannot resolve it at build time, which is exactly what
 * we want, and the bundle passes the path to its own copy under `native\`.
 */

export interface Argon2Binding {
  hash(password: string, options?: unknown): Promise<string>;
  verify(hashed: string, password: string, options?: unknown): Promise<boolean>;
}

const nodeRequire = createRequire(import.meta.url);

let explicitPath: string | undefined;
let loaded: Argon2Binding | undefined;

/** Points at the bundle's `native\argon2.node`; called once from `main.ts`. */
export function setArgon2BindingPath(path: string | undefined): void {
  explicitPath = path;
  loaded = undefined;
}

/** Test seam: forces a binding, so a failure path can be exercised. */
export function setArgon2Binding(binding: Argon2Binding | undefined): void {
  loaded = binding;
}

function isBinding(value: unknown): value is Argon2Binding {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Argon2Binding).hash === 'function' &&
    typeof (value as Argon2Binding).verify === 'function'
  );
}

/**
 * The addon, loaded once. The explicit path wins; the package name is the
 * source-checkout fallback, where its own loader does the right thing.
 */
export function argon2(): Argon2Binding {
  if (loaded !== undefined) {
    return loaded;
  }
  const failures: string[] = [];
  for (const candidate of [explicitPath, '@node-rs/argon2']) {
    if (candidate === undefined) {
      continue;
    }
    try {
      const module: unknown = nodeRequire(candidate);
      if (isBinding(module)) {
        loaded = module;
        return module;
      }
      failures.push(`${candidate}: loaded but exports no hash/verify`);
    } catch (cause) {
      failures.push(`${candidate}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  throw new Error(`The Argon2id addon could not be loaded. Tried:\n  ${failures.join('\n  ')}`);
}
