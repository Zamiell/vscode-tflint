import { spawn } from "node:child_process";
import type { TflintConfig } from "./config.js";
import { getOutputChannel } from "./outputChannel.js";

export interface TflintRange {
  filename: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
}

export interface TflintRule {
  name: string;
  severity: "error" | "warning" | "notice";
}

export interface TflintIssue {
  rule: TflintRule;
  message: string;
  range: TflintRange;
}

interface TflintError {
  severity: string;
  summary: string;
  detail?: string;
}

interface TflintOutput {
  issues: TflintIssue[];
  errors: TflintError[];
}

type LintResult =
  | { kind: "ok"; output: TflintOutput }
  | { kind: "notFound" }
  | { kind: "parseError"; raw: string }
  | { kind: "execError"; code: number | undefined; stderr: string };

export async function runTflint(
  moduleDir: string,
  config: TflintConfig,
): Promise<LintResult> {
  const channel = getOutputChannel();
  const args = ["--format=json", `--chdir=${moduleDir}`, ...config.extraArgs];

  channel.appendLine(
    `[tflint] Running: ${config.executablePath} ${args.join(" ")}`,
  );

  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(config.executablePath, args, {
      env: process.env,
      cwd: moduleDir,
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        channel.appendLine(
          `[tflint] Executable not found: ${config.executablePath}`,
        );
        resolve({ kind: "notFound" });
      } else {
        channel.appendLine(`[tflint] Spawn error: ${err.message}`);
        resolve({ kind: "execError", code: undefined, stderr: err.message });
      }
    });

    child.on("close", (code) => {
      if (stderr !== "") {
        channel.appendLine(`[tflint] stderr: ${stderr}`);
      }

      if (stdout.trim() === "") {
        if (code !== 0 && code !== 1) {
          resolve({ kind: "execError", code: code ?? undefined, stderr });
          return;
        }
        resolve({ kind: "ok", output: { issues: [], errors: [] } });
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as TflintOutput;
        resolve({ kind: "ok", output: parsed });
      } catch {
        channel.appendLine(
          `[tflint] Failed to parse JSON output: ${stdout.slice(0, 500)}`,
        );
        resolve({ kind: "parseError", raw: stdout });
      }
    });
  });
}
