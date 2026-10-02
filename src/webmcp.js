import { TYPES, validateName, parseValue } from "./state.js";
export function registerAgentTools({ store, renderState, openState }) {
  const context = document.modelContext || navigator.modelContext;
  if (!context?.registerTool) return false;
  const lifecycle = new AbortController();
  const tools = [
    {
      name: "read_sample_variables",
      description:
        "Read local demo variables. These user-created values are not a credential store.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input) {
        if (!input || typeof input !== "object" || Object.keys(input).length)
          throw new Error("Expected an empty object.");
        return { variables: store.rows() };
      },
    },
    {
      name: "save_sample_variable",
      description:
        "Persist one typed demo value locally and display the sample state panel.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: TYPES },
          valueText: { type: "string" },
        },
        required: ["name", "type", "valueText"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input) {
        if (
          !input ||
          typeof input !== "object" ||
          Object.keys(input).some(
            (k) => !["name", "type", "valueText"].includes(k),
          ) ||
          typeof input.valueText !== "string"
        )
          throw new Error("Expected name, type, and valueText.");
        validateName(input.name);
        const value = parseValue(input.type, input.valueText);
        await store.set(input.name, input.type, value);
        renderState();
        openState();
        return { name: input.name, type: input.type, value };
      },
    },
  ];
  for (const tool of tools) {
    try {
      Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch((e) => console.warn("Optional WebMCP registration:", e.message));
    } catch (e) {
      console.warn("Optional WebMCP registration:", e.message);
    }
  }
  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
  return true;
}
