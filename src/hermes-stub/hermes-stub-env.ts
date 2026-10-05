export type HermesStubEnv = {
  Bindings: { server?: Bun.Server<undefined> };
  Variables: { body: string };
};
