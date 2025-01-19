import { defineCollection, defineConfig } from "@content-collections/core";
import { compileMDX } from "@content-collections/mdx";

// for more information on configuration, visit:
// https://www.content-collections.dev/docs/configuration

const legal = defineCollection({
  name: "legal",
  directory: "content/legal",
  include: "*.mdx",
  schema: (z) => ({
    title: z.string(),
    lastUpdated: z.coerce.date(),
  }),
  transform: async (document, context) => {
    const mdx = await compileMDX(context, document);
    return {
      ...document,
      mdx,
    };
  },
});

export default defineConfig({
  collections: [legal],
});
