import * as vscode from "vscode";

const SECTION = "tflint";

export interface TflintConfig {
  enable: boolean;
  executablePath: string;
  extraArgs: string[];
  runOnSave: boolean;
  runOnOpen: boolean;
}

export function getConfig(scope?: vscode.WorkspaceFolder): TflintConfig {
  const cfg = vscode.workspace.getConfiguration(SECTION, scope?.uri);
  return {
    enable: cfg.get("enable", true),
    executablePath: cfg.get("executablePath", "tflint"),
    extraArgs: cfg.get<string[]>("extraArgs", []),
    runOnSave: cfg.get("runOnSave", true),
    runOnOpen: cfg.get("runOnOpen", true),
  };
}
