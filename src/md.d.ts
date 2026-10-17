// The knowledge files (content/knowledge/*.md) are bundled as text modules (wrangler.toml [[rules]] type = "Text").
declare module "*.md" {
  const content: string;
  export default content;
}
