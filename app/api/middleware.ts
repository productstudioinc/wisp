import type { Context, Next } from 'hono'
import { Octokit } from 'octokit'
import type { Variables } from './types'

export const withGithubAuth = async (c: Context<{ Variables: Variables }>, next: Next) => {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN
  if (!token) {
    return c.json({ message: 'GitHub token not configured' }, 500)
  }
  c.set('octokit', new Octokit({ auth: token }))
  await next()
} 