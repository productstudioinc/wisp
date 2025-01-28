import { Octokit } from 'octokit'
import type { Octokit as OctokitRest } from '@octokit/rest'

const octokit: OctokitRest = new Octokit({
	auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
})

export interface CreateCommitFromDiffOptions {
	owner: string
	repo: string
	diff: string
	message: string
}

export async function createCommitFromDiff({
	owner,
	repo,
	diff,
	message,
}: CreateCommitFromDiffOptions): Promise<void> {
	// Get repository info
	const { data: repoData } = await octokit.rest.repos.get({
		owner,
		repo,
	})

	const defaultBranch = repoData.default_branch

	// Get the latest commit
	const { data: ref } = await octokit.rest.git.getRef({
		owner,
		repo,
		ref: `heads/${defaultBranch}`,
	})

	const latestCommitSha = ref.object.sha

	// Get the tree of the latest commit
	const { data: latestCommit } = await octokit.rest.git.getCommit({
		owner,
		repo,
		commit_sha: latestCommitSha,
	})

	// Create blobs for each file
	const treeItems = []
	const diffSections = diff.split('diff --git ')
		.filter(section => section.trim())
		.map(section => `diff --git ${section.trim()}`)

	for (const section of diffSections) {
		const fileMatch = section.match(/^diff --git a\/(.*?) b\//)
		if (!fileMatch) continue

		const filePath = fileMatch[1]
		const contentLines = section.split('\n')

		// Find the content start after the header lines
		const contentStartIndex = contentLines.findIndex(line => line.startsWith('@@'))
		if (contentStartIndex === -1) continue

		// Extract the content, removing diff markers
		const newContent = contentLines
			.slice(contentStartIndex + 1)
			.filter(line => !line.startsWith('@@'))
			.map(line => {
				if (line.startsWith('+')) return line.slice(1)
				if (line.startsWith('-')) return null
				return line
			})
			.filter(line => line !== null)
			.join('\n')

		// Create a blob for the file content
		const { data: blob } = await octokit.rest.git.createBlob({
			owner,
			repo,
			content: newContent,
			encoding: 'utf-8',
		})

		treeItems.push({
			path: filePath,
			mode: '100644' as const,
			type: 'blob' as const,
			sha: blob.sha,
		})
	}

	// Create a new tree with all changes
	const { data: newTree } = await octokit.rest.git.createTree({
		owner,
		repo,
		base_tree: latestCommit.tree.sha,
		tree: treeItems,
	})

	// Create the commit
	const { data: newCommit } = await octokit.rest.git.createCommit({
		owner,
		repo,
		message,
		tree: newTree.sha,
		parents: [latestCommitSha],
	})

	// Update the branch reference
	await octokit.rest.git.updateRef({
		owner,
		repo,
		ref: `heads/${defaultBranch}`,
		sha: newCommit.sha,
	})
}

export default octokit
