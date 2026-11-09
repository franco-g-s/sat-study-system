// Run a tools/*.swift script with a module cache this repo owns.
//
// Why (2026-09-24): `swift script.swift` compiles on every call, and compiling
// writes Clang/Swift modules into the user's default module cache
// (DARWIN_USER_CACHE_DIR/clang/ModuleCache, or ~/.cache/clang/ModuleCache).
// In a sandboxed session that directory is outside the writable roots, so the
// very first crop died with "unable to open output file ... SwiftShims-*.pcm:
// Operation not permitted" -- followed by a misleading "this SDK is not
// supported by the compiler", which is only the fallback failing too. DR06 had
// to be built by hand with CLANG_MODULE_CACHE_PATH set.
//
// The cache now lives under out/ (gitignored, inside the repo, so writable
// wherever the build itself can write). It is passed both ways -- the
// environment variable reaches clang's module builds, -module-cache-path
// reaches the Swift frontend -- because either alone depends on which one the
// toolchain of the day consults. An explicit CLANG_MODULE_CACHE_PATH in the
// environment still wins. SDKROOT is inherited untouched: with a writable cache
// the default SDK works, so nothing is pinned.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const swiftModuleCache = () =>
  process.env.CLANG_MODULE_CACHE_PATH || `${ROOT}out/.swift-module-cache`;

export function runSwift(script, args, opts = {}) {
  const cache = swiftModuleCache();
  mkdirSync(cache, { recursive: true });
  return execFileSync('swift', ['-module-cache-path', cache, script, ...args.map(String)], {
    stdio: 'pipe',
    ...opts,
    env: { ...process.env, CLANG_MODULE_CACHE_PATH: cache, ...(opts.env ?? {}) },
  });
}
