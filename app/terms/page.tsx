import type { Metadata } from "next";
import { allLegals } from "@/.content-collections/generated";

import LegalPage from "@/components/legal-page";
import { constructMetadata } from "@/lib/utils";

export const metadata: Metadata = constructMetadata({
  title: "Terms of Service | Wisp",
});

export default function Terms() {
  const post = allLegals.find((post) => post.title === "Terms of Service");
  return <LegalPage page={post} />;
}
