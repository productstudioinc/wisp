import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { handle } from 'hono/vercel'
import { z } from 'zod'
import type { Variables } from '../types'
import { withGithubAuth } from '../middleware'
import { GithubService } from '../services/github'

export const runtime = 'edge'

const createRequestSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Repository name must only contain letters, numbers, underscores, and hyphens')
})

const app = new Hono<{ Variables: Variables }>().basePath('/api')

app.use('*', withGithubAuth)

app.get('/create', async (c) => {
  const query = c.req.query()
  const result = createRequestSchema.safeParse({ name: query.name })
  
  if (!result.success) {
    throw new HTTPException(400, { message: 'Invalid repository name' })
  }

  try {
    const octokit = c.get('octokit')
    const templateOwner = 'productstudioinc'
    const templateRepo = 'vite_react_shadcn_pwa'
    
    const newRepoUrl = await GithubService.createFromTemplate(
      octokit,
      templateOwner,
      templateRepo,
      result.data.name
    )

    await new Promise(resolve => setTimeout(resolve, 2000))

    const { tree, files } = await GithubService.getContent(octokit, newRepoUrl)
    
    let output = "Created new repository from template!\n\n"
    output += `Repository URL: ${newRepoUrl}\n\n`
    output += "Directory structure:\n\n"
    output += tree
    output += "\n\n"
    
    for (const file of files) {
      output += "================================================\n"
      output += `File: /${file.path}\n`
      output += "================================================\n"
      output += file.content
      output += "\n\n"
    }

    return c.text(output)
  } catch (error: any) {
    throw new HTTPException(500, { message: error.message })
  }
})

export const GET = handle(app)
