// Bun inlines files imported `with { type: "text" }` as strings.
declare module "*.css" {
  const text: string;
  export default text;
}
