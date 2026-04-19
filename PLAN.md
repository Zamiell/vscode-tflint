# vscode-tflint Implementation Plan

## Overview

Turn this TypeScript/Bun project into a VS Code extension that shows yellow squiggly lines (Warning-severity diagnostics) for tflint issues in Terraform files.

## Architecture

Six modules with clear single responsibilities, bundled by esbuild into one CJS file:

```txt
src/
  main.ts          ← activate/deactivate, wires everything together
  config.ts        ← typed getConfiguration wrapper
  linter.ts        ← spawns tflint --format=json, parses output
  diagnostics.ts   ← maps tflint issues → vscode.Diagnostic[]
  statusBar.ts     ← status bar item management
  outputChannel.ts ← shared Output Channel singleton
```

---

## Phase 0: Install New Dependencies

```bash
bun add --dev esbuild @types/vscode@1.85.0 @vscode/vsce
```

- `esbuild` — bundler that replaces `tsc` emit
- `@types/vscode` — type stubs only; the extension host provides the runtime `vscode` module
- `@vscode/vsce` — for `vsce package` / `vsce publish`

> **Pitfall:** `@types/vscode` version must match `engines.vscode` in package.json. If `engines.vscode` is `^1.85.0`, install `@types/vscode@1.85.0`.

---

## Phase 1: `package.json` — Extension Manifest

VS Code reads `package.json` as the extension manifest at install time. Required additions:

| Field                       | Value                      | Why                                            |
| --------------------------- | -------------------------- | ---------------------------------------------- |
| `publisher`                 | `"Zamiell"`                | Required for marketplace publishing            |
| `engines.vscode`            | `"^1.85.0"`                | Minimum VS Code version                        |
| `activationEvents`          | `["onLanguage:terraform"]` | Lazy-load: only activate when a .tf file opens |
| `main`                      | `"./dist/main.cjs"`        | Points to esbuild bundle                       |
| `contributes.commands`      | `tflint.run`               | Manual lint command                            |
| `contributes.configuration` | See settings below         | User-configurable settings                     |

**Settings contributed:**

| Setting                 | Type     | Default    | Description                          |
| ----------------------- | -------- | ---------- | ------------------------------------ |
| `tflint.enable`         | boolean  | `true`     | Enable/disable diagnostics           |
| `tflint.executablePath` | string   | `"tflint"` | Path to tflint binary                |
| `tflint.extraArgs`      | string[] | `[]`       | Extra CLI args (e.g. `["--module"]`) |
| `tflint.runOnSave`      | boolean  | `true`     | Auto-lint on file save               |
| `tflint.runOnOpen`      | boolean  | `true`     | Auto-lint on file open               |

> **Critical pitfall — `main` and `"type": "module"`:** Because `"type": "module"` is set, any `.js` file is treated as ESM. The VS Code extension host calls `require()` on the `main` file; ESM fails with `require()`. Fix: output to `dist/main.cjs`. The `.cjs` extension is always CommonJS regardless of `"type"`.

---

## Phase 2: `tsconfig.json` — VS Code / Node 18 Environment

Override the bun preset defaults to target the extension host (Node 18, no DOM):

```jsonc
"compilerOptions": {
  "target": "ES2022",      // Node 18 supports ES2022 fully
  "lib": ["ES2022"],       // No DOM APIs in extension host
  "types": ["node", "vscode"],  // vscode types from @types/vscode
  "noEmit": true           // esbuild handles emit; tsc is type-check only
}
```

`tsc` becomes type-check only. esbuild handles transpilation and bundling.

> **Pitfall:** The `complete-tsconfig/tsconfig.bun.json` preset may include `types: ["bun-types"]` or similar. The explicit `types` override replaces it entirely — only `node` and `vscode` are in scope.

---

## Phase 3: `scripts/build.ts` — Replace `tsc` with esbuild

```typescript
import { $, buildScript } from "complete-node";

await buildScript(import.meta.dirname, async () => {
  await $`esbuild src/main.ts --bundle --format=cjs --platform=node --target=node18 --external:vscode --outfile=dist/main.cjs --sourcemap`;
});
```

**esbuild flag reference:**

| Flag                      | Purpose                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `--bundle`                | Inline all imports into a single file                       |
| `--format=cjs`            | CommonJS output — required by extension host's `require()`  |
| `--platform=node`         | Disable browser shims; enable Node built-ins                |
| `--target=node18`         | Transpile to syntax Node 18 supports                        |
| `--external:vscode`       | Leave `require('vscode')` as-is; extension host provides it |
| `--outfile=dist/main.cjs` | `.cjs` extension = always CommonJS                          |
| `--sourcemap`             | Stack traces point to original TypeScript line numbers      |

> **Pitfall:** esbuild does not type-check. The `tsc --noEmit` step in `scripts/lint.ts` still catches type errors.

---

## Phase 4: `src/config.ts`

Typed, centralized wrapper around `vscode.workspace.getConfiguration`. Passing `scope?.uri` enables per-workspace-folder configuration overrides in multi-root workspaces.

---

## Phase 5: `src/outputChannel.ts`

Module-level singleton. Creating multiple channels with the same name causes duplicate Output panel entries. The singleton is needed across modules without threading `ExtensionContext` everywhere.

---

## Phase 6: `src/linter.ts` — tflint Process Runner

Spawns `tflint --format=json --chdir=<moduleDir>` using Node's `child_process.spawn` (zero runtime dependencies — the extension host is plain Node, not Bun).

**tflint JSON output schema:**

```json
{
  "issues": [
    {
      "rule": { "name": "terraform_required_version", "severity": "warning" },
      "message": "...",
      "range": {
        "filename": "/abs/path/main.tf",
        "start": { "line": 1, "column": 1 },
        "end": { "line": 1, "column": 1 }
      }
    }
  ],
  "errors": []
}
```

**Exit code handling:**

- `0` — no issues (stdout may be empty or `{"issues":[],"errors":[]}`)
- `1` — issues found (stdout is valid JSON)
- `2+` — fatal error (no JSON)

Always attempt JSON parse first regardless of exit code.

**Result type** (discriminated union for clean pattern-matching in `main.ts`):

```typescript
type LintResult =
  | { kind: "ok"; output: TflintOutput }
  | { kind: "notFound" }
  | { kind: "parseError"; raw: string }
  | { kind: "execError"; code: number | null; stderr: string };
```

> **Pitfall — `--chdir` flag:** Only available in tflint ≥0.47.0 (released 2023). Document the minimum version requirement.
> **Pitfall — Windows paths:** Always pass `env: process.env` to `spawn` so PATH resolves correctly on Windows.

---

## Phase 7: `src/diagnostics.ts`

Maps tflint issues to `vscode.Diagnostic[]`.

**Key conversions:**

- tflint uses **1-based** line/column → subtract 1 for VS Code's **0-based** positions
- `diagnostic.source = "tflint"` — shows "tflint" next to each squiggle
- `diagnostic.code = issue.rule.name` — shows the rule name inline
- Severity: `"notice"` → `Information`; `"warning"` / `"error"` → `Warning` (yellow squiggles)

Returns `Map<string /* absolute file path */, vscode.Diagnostic[]>`.

> **Pitfall — stale diagnostics:** After a user fixes all issues in a file, tflint returns zero issues for it. The diagnostic collection must be explicitly cleared for that file, or old squiggles persist.
> **Pitfall — Windows path separators:** Normalize all file paths before using as Map keys to avoid `\` vs `/` mismatches.

---

## Phase 8: `src/statusBar.ts`

Status bar item with states: `idle | running | ok | error | disabled`.

Uses VS Code codicons (no external icon files needed):

- `$(sync~spin)` — animated spinner while running
- `$(check)` — clean lint result
- `$(warning)` — issues found or error state
- `$(circle-slash)` — disabled

Clicking the status bar item triggers the `tflint.run` command.

---

## Phase 9: `src/main.ts` — Extension Entry Point

**Extension lifecycle:**

- `activate(context)` — named export, called when first `.tf` file opens
- `deactivate()` — named export, called on extension unload

**Event wiring:**

- `vscode.workspace.onDidOpenTextDocument` → lint the file's workspace folder (if `runOnOpen`)
- `vscode.workspace.onDidSaveTextDocument` → lint the file's workspace folder (if `runOnSave`)
- `vscode.commands.registerCommand("tflint.run", ...)` → lint all workspace folders

All disposables pushed to `context.subscriptions` — VS Code auto-disposes on deactivation.

**Stale diagnostics management:** Track which files had diagnostics per workspace folder using `Map<string /* folder fsPath */, Set<string /* file paths */>>`. On each run, clear files that dropped out of the result set.

**Activation scan:** Lint any already-open `.tf` files when the extension first activates (fire-and-forget to avoid blocking the activation event).

---

## Phase 10: `.vscodeignore`

Controls what gets excluded from the `.vsix` package. Without this, `vsce package` includes everything (enormous package).

---

## Phase 11: Tooling Config Updates

**`knip.config.js`:** Add `"@types/vscode"` and `"@vscode/vsce"` to `ignoreDependencies` (type-only / CLI tools, not imported in code).

**`cspell.config.jsonc`:** Add words: `tflint`, `chdir`, `esbuild`, `fsPath`, `vsce`, `vsix`, `hcl`, `codicon`, `noEmit`.

> **Note:** The `complete-cli check` step in `scripts/lint.ts` compares your project against the complete-cli template. VS Code-specific manifest fields like `publisher`, `engines`, `activationEvents`, and `contributes` will cause this check to fail. The `complete-cli check` command may need to be removed or configured to skip those fields.

---

## Implementation Order

| Step | Phase                | Notes                                                     |
| ---- | -------------------- | --------------------------------------------------------- |
| 1    | 0 — Install deps     | Must come first; `@types/vscode` needed for type checking |
| 2    | 2 — tsconfig.json    | Must come before writing source (IDE type inference)      |
| 3    | 1 — package.json     | Extension manifest                                        |
| 4    | 4 — config.ts        | No new dependencies                                       |
| 5    | 5 — outputChannel.ts | No new dependencies                                       |
| 6    | 6 — linter.ts        | Depends on config.ts + outputChannel.ts                   |
| 7    | 7 — diagnostics.ts   | Depends on linter.ts types                                |
| 8    | 8 — statusBar.ts     | No new dependencies                                       |
| 9    | 9 — main.ts          | Depends on all modules                                    |
| 10   | 3 — scripts/build.ts | Validate after source is written                          |
| 11   | 10 — .vscodeignore   | Required before `vsce package`                            |
| 12   | 11 — Tooling configs | Knip + CSpell updates                                     |

---

## Key Pitfalls Summary

| Pitfall                                         | Fix                                                     |
| ----------------------------------------------- | ------------------------------------------------------- |
| `"main": "./dist/main.js"` + `"type": "module"` | Use `./dist/main.cjs`                                   |
| esbuild doesn't type-check                      | Keep `tsc --noEmit` in lint script                      |
| `--chdir` flag missing in tflint <0.47          | Document minimum version; detect via `execError` result |
| Stale squiggles after fixing issues             | Track files per folder; clear explicitly on clean run   |
| Windows path separator inconsistency            | Normalize paths before using as Map keys                |
| `.js` imports with `verbatimModuleSyntax`       | Import as `"./config.js"` not `"./config.ts"`           |
| `@types/vscode` version mismatch                | Pin to match `engines.vscode` version                   |
| `complete-cli check` failing on manifest fields | Remove or configure to skip VS Code-specific fields     |
