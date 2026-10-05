import type { Context } from "hono";
import { resolve, sep } from "node:path";
import type { HermesStubEnv } from "../hermes-stub-env.ts";

export async function serveUiFile(
  context: Context<HermesStubEnv>,
  uiDir: string,
  assetPath: string,
) {
  const path = assetPath;
  let filePath: string;
  try {
    filePath = resolve(
      uiDir,
      path === "/" ? "index.html" : `.${decodeURIComponent(path)}`,
    );
  } catch {
    return context.json({ error: "Invalid asset path" }, 400);
  }
  if (!filePath.startsWith(uiDir + sep))
    return context.json({ error: "Not found" }, 404);
  const file = Bun.file(filePath);
  if (!(await file.exists()))
    return context.json(
      { error: "UI assets missing. Run bun run build:hermes-ui." },
      404,
    );
  return new Response(file);
}
