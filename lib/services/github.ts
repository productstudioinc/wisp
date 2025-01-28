import { Octokit } from 'octokit'
import type { Octokit as OctokitRest } from '@octokit/rest'

const octokit: OctokitRest = new Octokit({
	auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
})

type TreeItem = {
	type: 'file' | 'dir'
	name: string
	path: string
	children?: TreeItem[]
}


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

function shouldIgnorePath(path: string): boolean {
	const allowedFiles = ['index.html', 'package.json', 'vite.config.ts']

	if (path.startsWith('src/')) {
		return false
	}

	if (allowedFiles.includes(path)) {
		return false
	}

	return true
}

function generateTreeString(tree: TreeItem[], prefix = ''): string {
	let result = ''
	tree.forEach((item, index) => {
		const isLast = index === tree.length - 1
		const connector = isLast ? '└── ' : '├── '
		result += `${prefix}${connector}${item.name}\n`

		if (item.children) {
			const newPrefix = prefix + (isLast ? '    ' : '│   ')
			result += generateTreeString(item.children, newPrefix)
		}
	})
	return result
}

async function fetchGithubTree(
	octokit: OctokitRest,
	owner: string,
	repo: string,
	path = '',
): Promise<TreeItem[]> {
	const response = await octokit.rest.repos.getContent({
		owner,
		repo,
		path,
	})

	const items = Array.isArray(response.data) ? response.data : [response.data]
	const result: TreeItem[] = []

	for (const item of items) {
		if (shouldIgnorePath(item.path)) {
			continue
		}

		if (item.type === 'dir') {
			const children = await fetchGithubTree(octokit, owner, repo, item.path)
			if (children.length > 0) {
				result.push({
					type: 'dir',
					name: item.name,
					path: item.path,
					children,
				})
			}
		} else if (item.type === 'file') {
			result.push({
				type: 'file',
				name: item.name,
				path: item.path,
			})
		}
	}

	return result.sort((a, b) => {
		if (a.type === b.type) return a.name.localeCompare(b.name)
		return a.type === 'dir' ? -1 : 1
	})
}

async function fetchFileContent(
	octokit: OctokitRest,
	owner: string,
	repo: string,
	path: string,
): Promise<string> {
	const response = await octokit.rest.repos.getContent({
		owner,
		repo,
		path,
	})

	if ('content' in response.data) {
		return Buffer.from(response.data.content, 'base64').toString()
	}
	throw new Error('Not a file')
}

export async function getContent(url: string): Promise<string> {
	const urlParts = url.replace('https://github.com/', '').split('/')
	const owner = urlParts[0]
	const repo = urlParts[1]
	const path = urlParts.slice(2).join('/')

	const tree = await fetchGithubTree(octokit, owner, repo, path)
	const treeString = generateTreeString([
		{
			type: 'dir',
			name: `${repo}/`,
			path: '',
			children: tree,
		},
	])

	const files: { path: string; content: string }[] = []

	async function collectFiles(items: TreeItem[]) {
		for (const item of items) {
			if (item.type === 'file' && !shouldIgnorePath(item.path)) {
				const content = await fetchFileContent(octokit, owner, repo, item.path)
				files.push({
					path: item.path,
					content,
				})
			}
			if (item.children) {
				await collectFiles(item.children)
			}
		}
	}

	await collectFiles(tree)
	const repoContent = `Directory structure:\n${treeString}\n\nFiles:\n${files
		.map(
			(f: { path: string; content: string }) =>
				`\n--- ${f.path} ---\n${f.content}`,
		)
		.join('\n')}`

	return repoContent
}
