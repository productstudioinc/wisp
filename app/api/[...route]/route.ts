import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { handle } from 'hono/vercel'
import { z } from 'zod'
import type { Variables } from '../types'
import { withGithubAuth } from '../middleware'
import { deleteRepository } from '../services/github'
import { deleteProject, checkDomainStatus } from '../services/vercel'
import { deleteDomainRecord } from '../services/cloudflare'
import { setupRepository } from '../services/repository'
import { handleDeploymentWithRetries } from '../services/deployment'

const createRequestSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Repository name must only contain letters, numbers, underscores, and hyphens'),
  prompt: z.string().optional()
})

const app = new Hono<{ Variables: Variables }>().basePath('/api')

app.use('*', withGithubAuth)

app.delete('/projects/:name', async (c) => {
  const params = c.req.param('name')
  console.log(`Deleting project: ${params}`)

  const query = z.object({
    dns_record_id: z.string().min(1),
    project_id: z.string().min(1)
  }).safeParse(c.req.query())

  if (!query.success) {
    console.error('Invalid query parameters for project deletion')
    throw new HTTPException(400, { message: 'Invalid query parameters' })
  }

  try {
    const octokit = c.get('octokit')
    await deleteRepository(octokit, 'productstudioinc', params)
    await deleteDomainRecord(query.data.dns_record_id)
    await deleteProject(query.data.project_id)
    console.log(`Successfully deleted project ${params} and associated resources`)

    return c.json({
      status: 'success',
      message: 'Repository, domain record, and project deleted successfully'
    })
  } catch (error: any) {
    console.error(`Failed to delete project ${params}:`, error.message)
    throw new HTTPException(500, { message: error.message })
  }
})

app.post('/projects', async (c) => {
  const body = await createRequestSchema.parseAsync(await c.req.json())
  console.log(`Creating new project: ${body.name}`)

  try {
    const octokit = c.get('octokit')
    const { projectId, dnsRecordId, customDomain } = await setupRepository(
      octokit,
      body.name,
      body.prompt
    )
    console.log(`Repository setup complete for ${body.name}`)

    let isVerified = false
    let attempts = 0
    while (!isVerified && attempts < 10) {
      console.log(`Verifying domain status for ${body.name} (attempt ${attempts + 1}/10)`)
      isVerified = await checkDomainStatus(projectId, body.name)
      if (!isVerified) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        attempts++
      }
    }

    const deploymentSuccess = await handleDeploymentWithRetries(
      projectId,
      octokit,
      body.name,
      `https://github.com/productstudioinc/${body.name}`
    )

    if (!deploymentSuccess) {
      console.error(`Deployment failed for ${body.name} after multiple attempts`)
      throw new Error('Deployment failed after multiple attempts')
    }

    console.log(`Project ${body.name} successfully created and deployed`)
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
    console.error(`Failed to create project ${body.name}:`, error.message)
    throw new HTTPException(500, { message: error.message })
  }
})

export const POST = handle(app)
export const DELETE = handle(app)