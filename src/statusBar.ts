import * as vscode from "vscode";

type StatusBarState = "idle" | "running" | "ok" | "error" | "disabled";

let statusBarItem: vscode.StatusBarItem | undefined;

export function createStatusBar(): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10,
  );
  statusBarItem.command = "tflint.run";
  statusBarItem.tooltip = "Click to run tflint";
  setStatusBarState("idle");
  statusBarItem.show();
  return statusBarItem;
}

export function setStatusBarState(state: StatusBarState): void {
  if (statusBarItem === undefined) {
    return;
  }

  switch (state) {
    case "idle": {
      statusBarItem.text = "$(check) tflint";
      statusBarItem.backgroundColor = undefined;
      break;
    }

    case "ok": {
      statusBarItem.text = "$(check) tflint";
      statusBarItem.backgroundColor = undefined;
      break;
    }

    case "running": {
      statusBarItem.text = "$(sync~spin) tflint";
      statusBarItem.backgroundColor = undefined;
      break;
    }

    case "error": {
      statusBarItem.text = "$(warning) tflint";
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
      break;
    }

    case "disabled": {
      statusBarItem.text = "$(circle-slash) tflint (disabled)";
      statusBarItem.backgroundColor = undefined;
      break;
    }
  }
}

export function disposeStatusBar(): void {
  statusBarItem?.dispose();
  statusBarItem = undefined;
}
