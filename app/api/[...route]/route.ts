import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { handle } from 'hono/vercel'
import { z } from 'zod'
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import type { Variables } from '../types'
import { withGithubAuth } from '../middleware'
import { GithubService } from '../services/github'

export const runtime = 'edge'

const createRequestSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Repository name must only contain letters, numbers, underscores, and hyphens'),
  prompt: z.string().optional()
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

app.get('/create', async (c) => {
  const query = c.req.query()
  const result = createRequestSchema.safeParse({ name: query.name, prompt: query.prompt })

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

    if (result.data.prompt) {
      const { tree, files } = await GithubService.getContent(octokit, newRepoUrl)

      const repoContent = `Directory structure:\n${tree}\n\nFiles:\n${files.map(f => `\n--- ${f.path} ---\n${f.content}`).join('\n')}`

      const { object } = await generateObject({
        model: openai('gpt-4o'),
        schema: fileChangeSchema,
        prompt: `Given this repository content:\n\n${repoContent}\n\nImplement the following feature: ${result.data.prompt}\n\nProvide the necessary file changes to implement this feature. Only include files that need to be modified or created.`,
        system: 'You are an expert developer. Generate code changes following best practices. Focus on modifying only the necessary files.',
      })

      await GithubService.createCommitWithFiles(
        octokit,
        'productstudioinc',
        result.data.name,
        'main',
        object.changes,
        `feat: ${result.data.prompt}\n\n${object.changes.map(c => `- ${c.description}`).join('\n')}`
      )

      await new Promise(resolve => setTimeout(resolve, 2000))
    }

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
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  } catch (error: any) {
    throw new HTTPException(500, { message: error.message })
  }
})

export const GET = handle(app)
