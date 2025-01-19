import { MDXContent } from "@content-collections/mdx/react";
import { formatDate } from "@/lib/utils";
import type { Page } from "content-collections";

export default function LegalPage({ page }: { page: Page }) {
  return (
    <>
      <div className="py-20 sm:py-10">
        <h1 className="mt-5 text-center font-display text-4xl font-bold leading-[1.15] text-primary sm:text-5xl sm:leading-[1.15]">
          {page.title}
        </h1>
        <div className="mx-auto mt-10 w-full max-w-screen-md border-t border-gray-200 pt-10 text-center">
          <p className="text-priamry">
            Last updated: {formatDate(page.lastUpdated)}
          </p>
        </div>
      </div>

      <div className="flex flex-col text-left pb-10 pt-10 container max-w-6xl prose dark:prose-invert">
        <MDXContent code={page.mdx} />{" "}
      </div>
    </>
  );
}
