import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel("tflint");
  return channel;
}

export function disposeOutputChannel(): void {
  channel?.dispose();
  channel = undefined;
}
