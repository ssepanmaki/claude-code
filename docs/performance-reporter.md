# 1 GB Memory Usage Investigation

> Diagnosis of session `a3593062` (RSS 1.09 GB): finding the root cause of the Bun runtime memory bloat

## Data collected

- **Diagnostics**: RSS 1,118 MB, V8 heap 84 MB, native memory gap 1,034 MB (92%)
- **Build**: `bun run build:vite` → single-file Vite/Rollup build, producing a 17 MB `dist/cli.js`
- **Vite config**: `codeSplitting: false` (`vite.config.ts:97`), so all code is inlined into one file
- **Node.js comparison**: with the same 17 MB output, Node.js RSS is only 223 MB (`--version`) / 340 MB (full load)

## Exploration and verification

### Confirmed

| Issue | Location | Notes |
|------|------|------|
| **Root cause: single-file Vite build + Bun parsing large files inefficiently** | `vite.config.ts:97` | `codeSplitting: false` produces a 17 MB single file; Bun/JSC parsing pushes RSS up to 966 MB |
| Node.js needs only 223 MB for the same 17 MB file | Measured | V8 parses large files far more memory-efficiently than JSC |
| Bun.build code splitting fixes it | Measured | `bun run build` (code splitting → 627 chunks) gives Bun RSS of only 30 MB (`--version`) / 318 MB (full load) |

### Ruled out

- Not the number of feature flags: with all 35 features enabled, the code-split build uses normal memory
- Not a memory leak: `detachedContexts: 0`, `activeHandles: 0`
- Not a native addon problem: vendor files total only 2.7 MB
- Not the size of the TypeScript sources: `bun run dev` (loading TS directly) uses only 345 MB on the full path

## Conclusion

**The root cause is the Vite build setting `codeSplitting: false`, which produces a 17 MB single file. Bun/JSC is very memory-inefficient when parsing a single large JS file (966 MB vs 223 MB for Node).**

Measured comparison:

| Build | Output | Bun RSS | Node RSS | Bun/Node |
|----------|----------|---------|----------|----------|
| `build:vite` | 17 MB single file | **966 MB** | 223 MB | 4.3x |
| `build:vite` pipe mode | same | **1,088 MB** | 340 MB | 3.2x |
| `build` (Bun) | 627 chunks | 30 MB | 42 MB | 0.7x |
| `build` (Bun) pipe mode | same | 318 MB | 253 MB | 1.3x |
| `bun run dev` TS sources | dynamic loading | 42 MB | n/a | n/a |
| `bun run dev` pipe mode | dynamic loading | 345 MB | n/a | n/a |

Key differences:
- **Node/V8** needs only 223 MB to parse the 17 MB file, because V8's lazy parsing compiles only the parts the entry point needs
- **Bun/JSC** needs 966 MB for the same file: JSC compiles the whole file up front, and bytecode + JIT take a lot of native memory
- After code splitting (627 small chunks), Bun loads chunks on demand and memory returns to normal

## Recommendations

1. **Enable Vite code splitting**: set `codeSplitting: true` in `vite.config.ts` or use Rollup's `manualChunks`. This is the most direct fix
2. **Or switch to Bun.build**: `bun run build` already enables code splitting (`splitting: true`), and Bun RSS is only 30-318 MB
3. **If a single file is mandatory**: consider running the Vite output with Node.js (`node dist/cli-node.js`), at the cost of losing Bun-specific APIs
4. **Check why `codeSplitting: false` exists**: the comment says "all dynamic imports inlined", probably to simplify deployment. Evaluate whether a single file is really needed
