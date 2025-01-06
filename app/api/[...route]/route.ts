import { Hono } from 'hono'
import { handle } from 'hono/vercel'
import { z } from 'zod'
import type { Variables } from '../types'
import { withGithubAuth } from '../middleware'
import { GithubService } from '../services/github'

export const runtime = 'edge'

const createRequestSchema = z.object({
  url: z.string().url().startsWith('https://github.com/')
})

const app = new Hono<{ Variables: Variables }>().basePath('/api')

app.use('*', withGithubAuth)

app.get('/create', async (c) => {
  const query = c.req.query()
  const result = createRequestSchema.safeParse({ url: query.url })
  
  if (!result.success) {
    return c.json({ message: 'Invalid GitHub URL' }, 400)
  }

  try {
    const octokit = c.get('octokit')
    const { tree, files } = await GithubService.getContent(octokit, result.data.url)
    
    let output = "Directory structure:\n\n"
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
    return c.json({ message: error.message }, 500)
  }
})

export const GET = handle(app)
