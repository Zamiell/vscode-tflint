import path from "node:path";
import * as vscode from "vscode";
import type { TflintIssue } from "./linter.js";

function severityFor(
  tflintSeverity: TflintIssue["rule"]["severity"],
): vscode.DiagnosticSeverity {
  if (tflintSeverity === "notice") {
    return vscode.DiagnosticSeverity.Information;
  }
  // Both "warning" and "error" from tflint become Warning (yellow squiggles).
  return vscode.DiagnosticSeverity.Warning;
}

export function issuesToDiagnostics(
  issues: readonly TflintIssue[],
): ReadonlyMap<string, readonly vscode.Diagnostic[]> {
  const result = new Map<string, vscode.Diagnostic[]>();

  for (const issue of issues) {
    const filePath = path.normalize(issue.range.filename);

    // Positions in tflint output are 1-based; VS Code expects 0-based.
    const startLine = Math.max(0, issue.range.start.line - 1);
    const startChar = Math.max(0, issue.range.start.column - 1);
    const endLine = Math.max(0, issue.range.end.line - 1);
    const endChar = Math.max(0, issue.range.end.column - 1);

    const range = new vscode.Range(startLine, startChar, endLine, endChar);
    const diagnostic = new vscode.Diagnostic(
      range,
      issue.message,
      severityFor(issue.rule.severity),
    );
    diagnostic.source = "tflint";
    diagnostic.code = issue.rule.name;

    const existing = result.get(filePath) ?? [];
    existing.push(diagnostic);
    result.set(filePath, existing);
  }

  return result;
}
