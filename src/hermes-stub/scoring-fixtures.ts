export function scoringFixturesFromEnvironment(): unknown[] {
  const configured = process.env.HERMES_STUB_SCORING_FIXTURES;
  if (!configured) return [];
  let fixtures: unknown;
  try {
    fixtures = JSON.parse(configured) as unknown;
  } catch {
    throw new Error("HERMES_STUB_SCORING_FIXTURES must be a JSON array.");
  }
  if (!Array.isArray(fixtures))
    throw new Error("HERMES_STUB_SCORING_FIXTURES must be a JSON array.");
  return fixtures;
}
