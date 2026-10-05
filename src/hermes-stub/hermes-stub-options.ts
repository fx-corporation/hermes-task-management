export interface HermesStubOptions {
  port?: number;
  hostname?: string;
  uiDir?: string;
  taskTrackerUrl?: string;
  taskTrackerToken?: string;
  scoringFixtures?: unknown[];
  log?: (request: Record<string, unknown>) => void;
}
