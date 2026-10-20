function escapeYamlString(value: string): string {
  return JSON.stringify(value);
}

export function generateFrontMatter(url: string, title: string): string {
  const date = new Date().toISOString().split("T")[0];
  return `---\nurl: ${escapeYamlString(url)}\ntitle: ${escapeYamlString(title)}\ndate: ${date}\n---\n\n`;
}
