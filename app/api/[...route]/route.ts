import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { handle } from 'hono/vercel'
import { z } from 'zod'
import type { Variables } from '../types'
import { withGithubAuth } from '../middleware'
import { createFromTemplate, getContent, createCommitWithFiles, deleteRepository } from '../services/github'
import { setupVercelProject, addDomainToProject, checkDomainStatus, deleteProject, checkDeploymentStatus } from '../services/vercel'
import { createDomainRecord, deleteDomainRecord } from '../services/cloudflare'
import { generateImplementationPlan, generateCodeChanges, applyChangesToFiles, generateDeploymentErrorFix } from '../services/ai'
import type { Octokit } from '@octokit/rest'

export const runtime = 'edge'

const createRequestSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Repository name must only contain letters, numbers, underscores, and hyphens'),
  prompt: z.string().optional()
})

const deleteRequestSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Repository name must only contain letters, numbers, underscores, and hyphens'),
  dns_record_id: z.string().min(1),
  project_id: z.string().min(1)
})

const fileChangeSchema = z.object({
  changes: z.array(z.object({
    path: z.string().describe('The path to the file relative to the repository root'),
    changes: z.array(z.object({
      type: z.enum(['add', 'remove', 'replace']).describe('The type of change to make'),
      start: z.number().describe('The line number where the change starts (1-indexed)'),
      end: z.number().optional().describe('The line number where the change ends (for replace/remove)'),
      content: z.string().describe('The new content to add (for add/replace)')
    })),
    description: z.string().describe('A brief description of what changed in this file')
  }))
})

const app = new Hono<{ Variables: Variables }>().basePath('/api')

app.use('*', withGithubAuth)

app.delete('/repositories/:name', async (c) => {
  const params = c.req.param('name')
  const query = z.object({
    dns_record_id: z.string().min(1),
    project_id: z.string().min(1)
  }).safeParse(c.req.query())

  if (!query.success) {
    throw new HTTPException(400, { message: 'Invalid query parameters' })
  }

  try {
    const octokit = c.get('octokit')
    await deleteRepository(octokit, 'productstudioinc', params)
    await deleteDomainRecord(query.data.dns_record_id)
    await deleteProject(query.data.project_id)

    return c.json({
      status: 'success',
      message: 'Repository, domain record, and project deleted successfully'
    })
  } catch (error: any) {
    throw new HTTPException(500, { message: error.message })
  }
})

async function waitForDeployment(projectId: string, octokit: Octokit, repoName: string, maxAttempts = 20): Promise<{ success: boolean; error?: string }> {
  let attempts = 0
  while (attempts < maxAttempts) {
    const { state, logs } = await checkDeploymentStatus(projectId)
    console.log(`Deployment status: ${state}${logs ? ` (Logs: ${logs})` : ''}`)

    switch (state) {
      case 'READY':
        return { success: true }
      case 'ERROR':
        return { success: false, error: logs || 'Unknown deployment error' }
      case 'CANCELED':
      case 'DELETED':
        return { success: false, error: `Deployment ${state.toLowerCase()}` }
      default:
        await new Promise(resolve => setTimeout(resolve, 5000))
        attempts++
    }
  }
  return { success: false, error: 'Deployment timeout' }
}

async function handleDeploymentError(error: string, octokit: Octokit, repoName: string, repoUrl: string): Promise<boolean> {
  console.log('[!] Attempting to fix deployment error:', error)

  const { tree, files } = await getContent(octokit, repoUrl)
  const repoContent = `Directory structure:\n${tree}\n\nFiles:\n${files.map((f: { path: string; content: string }) => `\n--- ${f.path} ---\n${f.content}`).join('\n')}`

  const changes = await generateDeploymentErrorFix(repoContent, error)
  console.log('[✓] Fix changes generated')

  if (changes.changes.length === 0) {
    console.log('[!] No fixes could be generated')
    return false
  }

  const patchChanges = await applyChangesToFiles(octokit, 'productstudioinc', repoName, changes.changes)

  await createCommitWithFiles(
    octokit,
    'productstudioinc',
    repoName,
    'main',
    patchChanges,
    `fix: deployment error\n\n${error}\n\n${changes.changes.map(c => `- ${c.description}`).join('\n')}`
  )
  console.log('[✓] Fix changes committed')

  return true
}

app.post('/repositories', async (c) => {
  const body = await createRequestSchema.parseAsync(await c.req.json())

  try {
    const octokit = c.get('octokit')
    const templateOwner = 'productstudioinc'
    const templateRepo = 'vite_react_shadcn_pwa'

    console.log(`[1/7] Creating repository from template: ${body.name}`)
    const newRepoUrl = await createFromTemplate(
      octokit,
      templateOwner,
      templateRepo,
      body.name
    )
    console.log(`[✓] Repository created: ${newRepoUrl}`)

    await new Promise(resolve => setTimeout(resolve, 2000))

    console.log('[2/7] Setting up Vercel project')
    const { projectId, deploymentUrl } = await setupVercelProject(body.name)
    console.log(`[✓] Vercel project created: ${deploymentUrl}`)

    console.log('[3/7] Setting up custom domain')
    await addDomainToProject(projectId, body.name)
    console.log('[✓] Domain added to Vercel project')

    console.log('[4/7] Creating DNS record')
    const dnsRecordId = await createDomainRecord(body.name)
    console.log('[✓] DNS record created in Cloudflare')

    if (body.prompt) {
      console.log(`[5/7] Generating AI changes for prompt: ${body.prompt}`)
      const { tree, files } = await getContent(octokit, newRepoUrl)
      const repoContent = `Directory structure:\n${tree}\n\nFiles:\n${files.map((f: { path: string; content: string }) => `\n--- ${f.path} ---\n${f.content}`).join('\n')}`

      const plan = await generateImplementationPlan(repoContent, body.prompt)
      console.log('[✓] Implementation plan generated')

      const changes = await generateCodeChanges(plan, repoContent)
      console.log('[✓] Code changes generated')

      const patchChanges = await applyChangesToFiles(octokit, 'productstudioinc', body.name, changes.changes)

      await createCommitWithFiles(
        octokit,
        'productstudioinc',
        body.name,
        'main',
        patchChanges,
        `feat: ${body.prompt}\n\n${changes.changes.map(c => `- ${c.description}`).join('\n')}`
      )
      console.log('[✓] Changes committed to repository')

      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    console.log('[6/7] Waiting for domain verification')
    let isVerified = false
    let attempts = 0
    while (!isVerified && attempts < 10) {
      isVerified = await checkDomainStatus(projectId, body.name)
      if (!isVerified) {
        console.log(`Domain not verified yet, attempt ${attempts + 1}/10`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        attempts++
      }
    }
    console.log(isVerified ? '[✓] Domain verified successfully' : '[!] Domain verification timed out')

    console.log('[7/7] Checking deployment status')
    const maxFixAttempts = 3
    let fixAttempts = 0

    while (fixAttempts < maxFixAttempts) {
      const deploymentStatus = await waitForDeployment(projectId, octokit, body.name)

      if (deploymentStatus.success) {
        console.log('[✓] Deployment successful')
        break
      }

      if (!deploymentStatus.error) {
        console.log('[!] Deployment failed without error message')
        break
      }

      console.log(`[!] Deployment failed (attempt ${fixAttempts + 1}/${maxFixAttempts}): ${deploymentStatus.error}`)

      const fixed = await handleDeploymentError(deploymentStatus.error, octokit, body.name, newRepoUrl)
      if (!fixed) {
        console.log('[!] Could not generate fixes for deployment error')
        break
      }

      await new Promise(resolve => setTimeout(resolve, 5000)) // Wait for new deployment to start
      fixAttempts++
    }

    const customDomain = `${body.name}.usewisp.app`

    return c.json({
      custom_domain: customDomain,
      dns_record_id: dnsRecordId,
      project_id: projectId,
      status: 'success',
      message: body.prompt
        ? 'Repository created and deployed with AI-generated changes'
        : 'Repository created and deployed'
    })
  } catch (error: any) {
    throw new HTTPException(500, { message: error.message })
  }
})

export const POST = handle(app)
export const DELETE = handle(app)