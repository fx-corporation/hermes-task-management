import type { Handler } from "hono";
import type { HermesStubEnv } from "../hermes-stub-env.ts";
import { serveUiFile } from "../http/serve-ui-file.ts";
import type { HermesStubState } from "../stub-state.ts";

export function indexHandler(
  state: HermesStubState,
): Handler<HermesStubEnv, "/"> {
  return (context) => {
    return serveUiFile(context, state.uiDir, "/");
  };
}
