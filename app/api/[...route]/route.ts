import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { handle } from 'hono/vercel'
import { z } from 'zod'
import { generateObject, generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import type { Variables } from '../types'
import { withGithubAuth } from '../middleware'
import { createFromTemplate, getContent, createCommitWithFiles, deleteRepository } from '../services/github'
import { setupVercelProject, addDomainToProject, checkDomainStatus, deleteProject } from '../services/vercel'
import { createDomainRecord, deleteDomainRecord } from '../services/cloudflare'
import { anthropic } from '@ai-sdk/anthropic'
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
    content: z.string().describe('The complete content of the file'),
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

app.post('/repositories', async (c) => {
  const body = await createRequestSchema.parseAsync(await c.req.json())

  try {
    const octokit = c.get('octokit')
    const templateOwner = 'productstudioinc'
    const templateRepo = 'vite_react_shadcn_pwa'

    console.log(`[1/6] Creating repository from template: ${body.name}`)
    const newRepoUrl = await createFromTemplate(
      octokit,
      templateOwner,
      templateRepo,
      body.name
    )
    console.log(`[✓] Repository created: ${newRepoUrl}`)

    await new Promise(resolve => setTimeout(resolve, 2000))

    console.log('[2/6] Setting up Vercel project')
    const { projectId, deploymentUrl } = await setupVercelProject(body.name)
    console.log(`[✓] Vercel project created: ${deploymentUrl}`)

    console.log('[3/6] Setting up custom domain')
    await addDomainToProject(projectId, body.name)
    console.log('[✓] Domain added to Vercel project')

    console.log('[4/6] Creating DNS record')
    const dnsRecordId = await createDomainRecord(body.name)
    console.log('[✓] DNS record created in Cloudflare')

    if (body.prompt) {
      console.log(`[5/6] Generating AI changes for prompt: ${body.prompt}`)
      const { tree, files } = await getContent(octokit, newRepoUrl)

      const repoContent = `Directory structure:\n${tree}\n\nFiles:\n${files.map((f: { path: string; content: string }) => `\n--- ${f.path} ---\n${f.content}`).join('\n')}`

      const { text: plan } = await generateText({
        model: openai('gpt-4o'),
        prompt: `Given this repository content:\n\n${repoContent}\n\nImplement the following feature: ${body.prompt}\n\nFirst, create a detailed plan for implementing this feature.`,
        system: `You are an expert react and pwa developer named Wisp

        Your job is to take a simple idea from a user and use that idea to create an app based on a template for a functional PWA app.

        The main files you should be editing are:

        pwa-assets.config.ts
        vite.config.ts for the app manifest

        And all the files under the src directory

        Before implementing, think thoroughly about the steps you need to take.

        Start by thinking of the styling - in the context of the prompt, how should the app look?

        Then think of the actual implementation. You can only make frontend/react changes since this is a vite app.

        Make sure everything is typesafe.

        You can NEVER install dependencies, you can only edit code`,
      })
      console.log('[✓] Implementation plan generated')

      const { object } = await generateObject({
        model: openai('gpt-4o', {
          structuredOutputs: true
        }),
        schema: fileChangeSchema,
        prompt: `Using this implementation plan:\n\n${plan}\n\nAnd this repository content:\n\n${repoContent}\n\nProvide the necessary file changes to implement this feature according to the plan. Only include files that need to be modified or created.`,
      })
      console.log('[✓] Code changes generated')

      await createCommitWithFiles(
        octokit,
        'productstudioinc',
        body.name,
        'main',
        object.changes,
        `feat: ${body.prompt}\n\n${object.changes.map(c => `- ${c.description}`).join('\n')}`
      )
      console.log('[✓] Changes committed to repository')

      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    console.log('[6/6] Waiting for domain verification')
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