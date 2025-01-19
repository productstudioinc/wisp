import type { Metadata } from "next";
import { allLegals } from "@/.content-collections/generated";

import LegalPage from "@/components/legal-page";
import { constructMetadata } from "@/lib/utils";

export const metadata: Metadata = constructMetadata({
  title: "Privacy Policy | Wisp",
});

export default function Privacy() {
  const post = allLegals.find((post) => post.title === "Privacy Policy");

  if (!post) {
    throw new Error("Privacy Policy not found");
  }

  return <LegalPage page={post} />;
}
