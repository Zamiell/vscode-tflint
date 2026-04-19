import * as vscode from "vscode";
import { getConfig } from "./config.js";
import { issuesToDiagnostics } from "./diagnostics.js";
import { runTflint } from "./linter.js";
import { disposeOutputChannel, getOutputChannel } from "./outputChannel.js";
import {
  createStatusBar,
  disposeStatusBar,
  setStatusBarState,
} from "./statusBar.js";

let diagnosticCollection: vscode.DiagnosticCollection | undefined;

const trackedFilesByFolder = new Map<string, Set<string>>();

export function activate(context: vscode.ExtensionContext): void {
  diagnosticCollection = vscode.languages.createDiagnosticCollection("tflint");
  const statusBar = createStatusBar();

  context.subscriptions.push(
    diagnosticCollection,
    statusBar,
    vscode.commands.registerCommand("tflint.run", async () => {
      await lintAllWorkspaceFolders();
    }),
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      if (!isTerraformDocument(document)) {
        return;
      }
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (folder === undefined) {
        return;
      }
      if (!getConfig(folder).runOnOpen) {
        return;
      }
      await lintWorkspaceFolder(folder);
    }),
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (!isTerraformDocument(document)) {
        return;
      }
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (folder === undefined) {
        return;
      }
      if (!getConfig(folder).runOnSave) {
        return;
      }
      await lintWorkspaceFolder(folder);
    }),
  );

  for (const document of vscode.workspace.textDocuments) {
    if (isTerraformDocument(document)) {
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (folder !== undefined) {
        lintWorkspaceFolder(folder).catch((error: unknown) => {
          getOutputChannel().appendLine(
            `[tflint] Activation error: ${String(error)}`,
          );
        });
      }
    }
  }
}

export function deactivate(): void {
  disposeStatusBar();
  disposeOutputChannel();
}

function isTerraformDocument(document: vscode.TextDocument): boolean {
  return (
    document.languageId === "terraform" || document.uri.fsPath.endsWith(".tf")
  );
}

async function lintAllWorkspaceFolders() {
  const folders = vscode.workspace.workspaceFolders ?? [];
  await Promise.all(folders.map(lintWorkspaceFolder));
}

async function lintWorkspaceFolder(folder: vscode.WorkspaceFolder) {
  const config = getConfig(folder);

  if (!config.enable) {
    setStatusBarState("disabled");
    return;
  }

  setStatusBarState("running");

  const result = await runTflint(folder.uri.fsPath, config);

  switch (result.kind) {
    case "ok": {
      if (diagnosticCollection === undefined) {
        return;
      }

      const byFile = issuesToDiagnostics(result.output.issues);
      const folderKey = folder.uri.fsPath;
      const prevTracked =
        trackedFilesByFolder.get(folderKey) ?? new Set<string>();

      for (const filePath of prevTracked) {
        if (byFile.has(filePath)) {
          continue;
        }
        diagnosticCollection.delete(vscode.Uri.file(filePath));
      }

      for (const [filePath, diags] of byFile) {
        diagnosticCollection.set(vscode.Uri.file(filePath), diags);
      }

      trackedFilesByFolder.set(folderKey, new Set(byFile.keys()));
      setStatusBarState(result.output.issues.length > 0 ? "error" : "ok");

      if (result.output.errors.length > 0) {
        const channel = getOutputChannel();
        for (const err of result.output.errors) {
          channel.appendLine(
            `[tflint] Error: ${err.summary}${err.detail === undefined ? "" : `: ${err.detail}`}`,
          );
        }
        channel.show(true);
      }

      break;
    }

    case "notFound": {
      setStatusBarState("error");
      await vscode.window.showWarningMessage(
        `tflint: executable not found at "${config.executablePath}". Install tflint or update the tflint.executablePath setting.`,
        "OK",
      );
      break;
    }

    case "parseError": {
      setStatusBarState("error");
      const channel = getOutputChannel();
      channel.appendLine(
        `[tflint] Unexpected output (not JSON): ${result.raw}`,
      );
      channel.show(true);
      break;
    }

    case "execError": {
      setStatusBarState("error");
      getOutputChannel().appendLine(
        `[tflint] Process exited with code ${result.code ?? "unknown"}: ${result.stderr}`,
      );
      break;
    }
  }
}
