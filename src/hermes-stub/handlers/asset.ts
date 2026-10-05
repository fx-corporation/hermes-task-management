import type { Handler } from "hono";
import type { HermesStubEnv } from "../hermes-stub-env.ts";
import { serveUiFile } from "../http/serve-ui-file.ts";
import type { HermesStubState } from "../stub-state.ts";

export function assetHandler(
  state: HermesStubState,
): Handler<HermesStubEnv, "/assets/*"> {
  return (context) => {
    return serveUiFile(context, state.uiDir, context.req.path);
  };
}
