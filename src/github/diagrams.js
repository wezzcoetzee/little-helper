// @ts-check

// Loaded by reader.js only when a document has a diagram, since mermaid is a few MB.
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  // HTML labels are measured against the page's styles, not the reader's, and clip.
  htmlLabels: false,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif',
  themeVariables: {
    darkMode: true,
    background: "#000",
    fontSize: "14px",
    primaryColor: "#0d0d0d",
    primaryTextColor: "#fff",
    primaryBorderColor: "#555",
    secondaryColor: "#0d0d0d",
    tertiaryColor: "#050505",
    lineColor: "#888",
    textColor: "#fff",
    clusterBkg: "#050505",
    clusterBorder: "#333",
    edgeLabelBackground: "#000",
  },
});

let count = 0;

/**
 * @param {string} code mermaid source
 * @returns {Promise<string>} SVG markup, sanitized by mermaid's strict mode
 */
export async function renderDiagram(code) {
  const { svg } = await mermaid.render(`ghmd-diagram-${++count}`, code);
  return svg;
}
