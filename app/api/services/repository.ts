import type { Octokit } from '@octokit/rest'
import { createFromTemplate, getContent, createCommitWithFiles } from './github'
import { setupVercelProject, addDomainToProject } from './vercel'
import { createDomainRecord } from './cloudflare'
import { generateImplementationPlan, generateCodeChanges } from './ai'

interface SetupResult {
  projectId: string
  deploymentUrl: string
  dnsRecordId: string
  customDomain: string
}

export async function setupRepository(
  octokit: Octokit,
  name: string,
  prompt: string | undefined
): Promise<SetupResult> {
  const templateOwner = 'productstudioinc'
  const templateRepo = 'vite_react_shadcn_pwa'

  const newRepoUrl = await createFromTemplate(
    octokit,
    templateOwner,
    templateRepo,
    name
  )

  await new Promise(resolve => setTimeout(resolve, 2000))

  const { projectId, deploymentUrl } = await setupVercelProject(name)
  await addDomainToProject(projectId, name)

  const dnsRecordId = await createDomainRecord(name)

  if (prompt) {
    await handleAIChanges(octokit, name, newRepoUrl, prompt)
  }

  return {
    projectId,
    deploymentUrl,
    dnsRecordId,
    customDomain: `${name}.usewisp.app`
  }
}

async function handleAIChanges(
  octokit: Octokit,
  repoName: string,
  repoUrl: string,
  prompt: string
): Promise<void> {
  const { tree, files } = await getContent(octokit, repoUrl)
  const repoContent = `Directory structure:\n${tree}\n\nFiles:\n${files.map(
    (f: { path: string; content: string }) => `\n--- ${f.path} ---\n${f.content}`
  ).join('\n')}`

  const changes = await generateCodeChanges(prompt, repoContent)

  const patchFiles = changes.changes.map(change => ({
    path: change.path,
    content: change.content
  }))

  await createCommitWithFiles(
    octokit,
    'productstudioinc',
    repoName,
    'main',
    patchFiles,
    `feat: ${prompt}\n\n${changes.changes.map(c => `- ${c.description}`).join('\n')}`
  )

  await new Promise(resolve => setTimeout(resolve, 2000))
} 