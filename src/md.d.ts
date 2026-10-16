// jo.md is bundled as a text module (wrangler.toml [[rules]] type = "Text").
declare module "*.md" {
  const content: string;
  export default content;
}
