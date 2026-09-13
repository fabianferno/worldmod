/**
 * The ThreeUI shader components inline their WebGL scenes as HTML documents
 * pulled in with Turbopack's `?raw` query. Turbopack resolves these; TypeScript
 * needs to be told the module is a string.
 */
declare module "*.html?raw" {
  const source: string;
  export default source;
}
