#!/usr/bin/env bun
/**
 * Build output integrity check script
 *
 * Checks whether the dist/ directory produced by Bun.build({ splitting: true }) contains:
 * 1. References to chunk files that do not exist (broken links)
 * 2. Third-party modules (non-Node.js builtins) referenced via __require() or import() that cannot be found in production
 * 3. Missing static import dependencies (cross-chunk reference target does not exist)
 *
 * Usage:
 *   bun scripts/check-bundle-integrity.ts          #   bun scripts/check-bundle-integrity.ts          # check the current dist/
 *   bun scripts/check-bundle-integrity.ts ./dist    #   bun scripts/check-bundle-integrity.ts ./dist    # specify a directory
 */

import { readdir, readFile } from 'fs/promises'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ─── Read dependencies from package.json as the allowlist ───
const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(
  await readFile(join(__dirname, '..', 'package.json'), 'utf-8'),
)
const PKG_DEPS = new Set(Object.keys(pkg.dependencies ?? {}))

// ─── Node.js builtin module allowlist ───
const NODE_BUILTINS = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
  'node:test',
])

// Builtin since Node 18+ but not in the traditional list
const NODE_18_PLUS_BUILTINS = new Set(['undici'])

// Bun-only modules (available only in the Bun runtime; fail under Node.js)
const BUN_MODULES = new Set(['bun', 'bun:ffi', 'bun:test', 'bun:sqlite'])

// macOS JXA / native frameworks (via ObjC.import, not a real require)
const NATIVE_FRAMEWORKS = new Set([
  'AppKit',
  'CoreGraphics',
  'Foundation',
  'UIKit',
])

// ─── Patterns ───
// Matches import { ... } from "./chunk-xxxxx.js" or import"./chunk-xxxxx.js"
const STATIC_IMPORT_RE = /(?:from\s+|import\s+)"(\.\/[^"]+\.js)"/g
// Matches __require("xxx")
const REQUIRE_RE = /__require\("([^"]+)"\)/g
// Matches dynamic import("xxx"), excluding internal ./chunk-xxx.js references
const DYNAMIC_IMPORT_RE = /import\("([^"]+)"\)/g
// Matches nodeRequire("xxx") (require alias created by createRequire)
const NODE_REQUIRE_RE = /nodeRequire\("([^"]+)"\)/g

interface Finding {
  type:
    | 'broken-chunk-ref'
    | 'third-party-require'
    | 'third-party-import'
    | 'third-party-node-require'
    | 'bun-runtime-only'
  severity: 'error' | 'warning'
  file: string
  line: number
  module: string
  snippet: string
}

async function main() {
  const distDir = resolve(process.argv[2] || './dist')

  console.log(`\n🔍 Checking build output integrity: ${distDir}\n`)

  // 1. List all chunk files
  let files: string[]
  try {
    files = (await readdir(distDir)).filter(f => f.endsWith('.js'))
  } catch {
    console.error(`❌ Cannot read directory: ${distDir}`)
    console.error('   Run bun run build first')
    process.exit(1)
  }

  const fileSet = new Set(files)
  console.log(`📦 Found ${files.length} JS files\n`)

  const findings: Finding[] = []

  // 2. Scan file by file
  for (const file of files) {
    const filePath = join(distDir, file)
    const content = await readFile(filePath, 'utf-8')
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNum = i + 1

      // 2a. Check whether static chunk references are broken
      const staticImportMatches = line.matchAll(STATIC_IMPORT_RE)
      for (const m of staticImportMatches) {
        const ref = m[1]
        // Extract the file name part (strip ./)
        const refFile = ref.replace(/^\.\//, '')
        if (!fileSet.has(refFile)) {
          findings.push({
            type: 'broken-chunk-ref',
            severity: 'error',
            file,
            line: lineNum,
            module: ref,
            snippet: line.trim().slice(0, 120),
          })
        }
      }

      // 2b. Check third-party modules in __require
      const requireMatches = line.matchAll(REQUIRE_RE)
      for (const m of requireMatches) {
        const mod = m[1]
        // Skip ObjC.import (JXA syntax, not a real require)
        if (NATIVE_FRAMEWORKS.has(mod)) continue
        if (
          NODE_BUILTINS.has(mod) ||
          NODE_18_PLUS_BUILTINS.has(mod) ||
          PKG_DEPS.has(mod) ||
          mod.startsWith('node:')
        )
          continue
        if (BUN_MODULES.has(mod)) {
          findings.push({
            type: 'bun-runtime-only',
            severity: 'warning',
            file,
            line: lineNum,
            module: mod,
            snippet: line.trim().slice(0, 120),
          })
          continue
        }
        // Third-party module — cannot be found in production (global npm install)
        findings.push({
          type: 'third-party-require',
          severity: 'error',
          file,
          line: lineNum,
          module: mod,
          snippet: line.trim().slice(0, 120),
        })
      }

      // 2c. Check third-party modules in dynamic import()
      const dynImportMatches = line.matchAll(DYNAMIC_IMPORT_RE)
      for (const m of dynImportMatches) {
        const mod = m[1]
        // Skip internal chunk references and relative paths
        if (mod.startsWith('./') || mod.startsWith('../')) continue
        // Skip ObjC.import
        if (NATIVE_FRAMEWORKS.has(mod)) continue
        if (
          NODE_BUILTINS.has(mod) ||
          NODE_18_PLUS_BUILTINS.has(mod) ||
          PKG_DEPS.has(mod) ||
          mod.startsWith('node:')
        )
          continue
        if (BUN_MODULES.has(mod)) {
          // bun:test etc. are available only in the Bun runtime and fail under Node.js
          findings.push({
            type: 'bun-runtime-only',
            severity: 'warning',
            file,
            line: lineNum,
            module: mod,
            snippet: line.trim().slice(0, 120),
          })
          continue
        }
        // Third-party dynamic import
        findings.push({
          type: 'third-party-import',
          severity: 'error',
          file,
          line: lineNum,
          module: mod,
          snippet: line.trim().slice(0, 120),
        })
      }

      // 2d. Check third-party modules in nodeRequire("xxx") (createRequire alias)
      const nodeRequireMatches = line.matchAll(NODE_REQUIRE_RE)
      for (const m of nodeRequireMatches) {
        const mod = m[1]
        if (NATIVE_FRAMEWORKS.has(mod)) continue
        if (
          NODE_BUILTINS.has(mod) ||
          NODE_18_PLUS_BUILTINS.has(mod) ||
          PKG_DEPS.has(mod) ||
          mod.startsWith('node:')
        )
          continue
        if (BUN_MODULES.has(mod)) {
          findings.push({
            type: 'bun-runtime-only',
            severity: 'warning',
            file,
            line: lineNum,
            module: mod,
            snippet: line.trim().slice(0, 120),
          })
          continue
        }
        findings.push({
          type: 'third-party-node-require',
          severity: 'error',
          file,
          line: lineNum,
          module: mod,
          snippet: line.trim().slice(0, 120),
        })
      }
    }
  }

  // 3. Summary report
  const errors = findings.filter(f => f.severity === 'error')
  const warnings = findings.filter(f => f.severity === 'warning')

  // Group by type
  const brokenRefs = errors.filter(f => f.type === 'broken-chunk-ref')
  const thirdPartyRequires = errors.filter(
    f => f.type === 'third-party-require',
  )
  const thirdPartyImports = errors.filter(f => f.type === 'third-party-import')
  const thirdPartyNodeRequires = errors.filter(
    f => f.type === 'third-party-node-require',
  )
  const bunRuntimeOnly = warnings.filter(f => f.type === 'bun-runtime-only')

  if (brokenRefs.length > 0) {
    console.log('❌ Broken chunk references (referenced files do not exist):')
    for (const f of brokenRefs) {
      console.log(`   ${f.file}:${f.line} → ${f.module}`)
    }
    console.log()
  }

  if (thirdPartyRequires.length > 0) {
    console.log(
      '❌ Third-party modules referenced via __require() (cannot be found in production):',
    )
    const grouped = groupByModule(thirdPartyRequires)
    for (const [mod, items] of grouped) {
      console.log(`   "${mod}" — appears ${items.length} times:`)
      for (const f of items.slice(0, 5)) {
        console.log(`     ${f.file}:${f.line}`)
      }
      if (items.length > 5) console.log(`     ... ${items.length - 5} more`)
    }
    console.log()
  }

  if (thirdPartyImports.length > 0) {
    console.log(
      '❌ Third-party modules dynamically referenced via import() (cannot be found in production):',
    )
    const grouped = groupByModule(thirdPartyImports)
    for (const [mod, items] of grouped) {
      console.log(`   "${mod}" — appears ${items.length} times:`)
      for (const f of items.slice(0, 5)) {
        console.log(`     ${f.file}:${f.line}`)
      }
      if (items.length > 5) console.log(`     ... ${items.length - 5} more`)
    }
    console.log()
  }

  if (thirdPartyNodeRequires.length > 0) {
    console.log(
      '❌ Third-party modules referenced via nodeRequire() (bypass bundling, cannot be found in production):',
    )
    const grouped = groupByModule(thirdPartyNodeRequires)
    for (const [mod, items] of grouped) {
      console.log(`   "${mod}" — appears ${items.length} times:`)
      for (const f of items.slice(0, 5)) {
        console.log(`     ${f.file}:${f.line}`)
      }
      if (items.length > 5) console.log(`     ... ${items.length - 5} more`)
    }
    console.log()
  }

  if (bunRuntimeOnly.length > 0) {
    console.log('⚠️  Bun Bun-runtime-only modules (fail under Node.js):')
    const grouped = groupByModule(bunRuntimeOnly)
    for (const [mod, items] of grouped) {
      console.log(`   "${mod}" — appears ${items.length} times`)
    }
    console.log()
  }

  // 4. Conclusion
  console.log('─'.repeat(50))
  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ Build output integrity check passed; no problems found.')
  } else {
    console.log(
      `📊 Total: ${errors.length} errors, ${warnings.length} warnings`,
    )
    if (errors.length > 0) {
      console.log(
        `\n💡 Suggested fixes:
   - Third-party module issues: exclude them via the external option in build.ts, or make sure they are bundled into chunks correctly
   - Broken links: check whether files were accidentally deleted during the build or the build is incomplete
   - Bun-only modules: make sure the runtime is bun rather than node`,
      )
    }
  }

  process.exit(errors.length > 0 ? 1 : 0)
}

function groupByModule(items: Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>()
  for (const item of items) {
    const list = map.get(item.module) || []
    list.push(item)
    map.set(item.module, list)
  }
  // Sort by occurrence count, descending
  return new Map([...map.entries()].sort((a, b) => b[1].length - a[1].length))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(2)
})
