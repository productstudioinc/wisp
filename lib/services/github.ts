import { Octokit } from 'octokit'
import type { Octokit as OctokitRest } from '@octokit/rest'

const octokit: OctokitRest = new Octokit({
	auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
})

export default octokit
