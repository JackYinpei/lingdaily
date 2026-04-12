export function buildScenarioPrompt(scenario) {
  const title = scenario.title || scenario.originalTitle || "";
  const description = scenario.description || "";
  const systemPrompt = scenario._systemPrompt || "";
  return [
    `[Scenario Role-Play]`,
    `Title: ${title}`,
    description && `Description: ${description}`,
    ``,
    `Instructions for the AI:`,
    systemPrompt,
  ]
    .filter(Boolean)
    .join("\n");
}
