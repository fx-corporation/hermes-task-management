export type ApplicationEnv = {
  Variables: {
    requestContext: { requestId: string; method: string; url: string };
    rawBody: Buffer;
  };
};
