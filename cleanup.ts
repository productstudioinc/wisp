import { $ } from "bun";
import { db } from "./lib/db/drizzle";
import { projects } from "./lib/db/schema";
import { eq } from "drizzle-orm";
import { deleteDomainRecord } from "./lib/services/cloudflare";

const BASE_NAME = "study-session-aesthetic";
const RANGE_START = 1;
const RANGE_END = 14;
const BATCH_SIZE = 10;

async function deleteProject(i: number) {
  const projectName = i === 1 ? BASE_NAME : `${BASE_NAME}-${i}`;
  try {
    const projectRecord = await db.query.projects.findFirst({
      where: eq(projects.name, projectName),
    });

    await $`gh repo delete productstudioinc/${projectName} --yes`;
    await $`vercel remove ${projectName} --yes`;

    if (projectRecord?.dnsRecordId) {
      await deleteDomainRecord(projectRecord.dnsRecordId);
    }

    await db.delete(projects).where(eq(projects.name, projectName));

    console.log(`✅ Deleted ${projectName}`);
  } catch (error) {
    console.error(`❌ Failed to delete ${projectName}:`, error);
  }
}

async function cleanup() {
  for (let start = RANGE_START; start <= RANGE_END; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, RANGE_END);
    const batch = Array.from(
      { length: end - start + 1 },
      (_, i) => deleteProject(start + i)
    );

    console.log(`Processing batch ${start} to ${end}...`);
    await Promise.all(batch);
    console.log(`Completed batch ${start} to ${end}`);
  }
}

cleanup().catch(console.error); 