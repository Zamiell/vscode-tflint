import { $, buildScript } from "complete-node";
import path from "node:path";

await buildScript(import.meta.dirname, async () => {
  const packageRoot = path.resolve(import.meta.dirname, "..");
  const entry = path.join(packageRoot, "src", "main.ts");
  const outFile = path.join(packageRoot, "dist", "main.cjs");
  await $`esbuild ${entry} --bundle --format=cjs --platform=node --target=node18 --external:vscode --outfile=${outFile} --sourcemap`;
});
