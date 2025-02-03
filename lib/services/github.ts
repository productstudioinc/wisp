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

export async function getTrimmedContent(url: string): Promise<string> {
	const urlParts = url.replace('https://github.com/', '').split('/')
	const owner = urlParts[0]
	const repo = urlParts[1]

	const specificFiles = ['index.html', 'vite.config.ts', 'src/App.tsx', 'src/index.css']
	const files: { path: string; content: string }[] = []

	for (const filePath of specificFiles) {
		try {
			const content = await fetchFileContent(octokit, owner, repo, filePath)
			files.push({
				path: filePath,
				content,
			})
		} catch (error: any) {
			console.warn(`Could not fetch ${filePath}: ${error.message}`)
		}
	}

	const repoContent = `Files:\n${files
		.map(
			(f: { path: string; content: string }) =>
				`\n--- ${f.path} ---\n${f.content}`,
		)
		.join('\n')}`

	return repoContent
}

export async function createCommitFromDiff({
	owner,
	repo,
	diff,
	message,
}: CreateCommitFromDiffOptions) {
	// Get the default branch
	const { data: repository } = await octokit.rest.repos.get({
		owner,
		repo,
	})
	const defaultBranch = repository.default_branch

	// Get the latest commit SHA
	const { data: ref } = await octokit.rest.git.getRef({
		owner,
		repo,
		ref: `heads/${defaultBranch}`,
	})
	const parentSha = ref.object.sha

	// Get the current tree
	const { data: commit } = await octokit.rest.git.getCommit({
		owner,
		repo,
		commit_sha: parentSha,
	})
	const baseSha = commit.tree.sha

	// Parse the XML-style file contents
	const files: { path: string; content: string }[] = []
	const regex = /<([^>]+)>\n([\s\S]*?)\n<\/\1>/g
	let match: RegExpExecArray | null = null

	do {
		match = regex.exec(diff)
		if (match) {
			const [, filePath, content] = match
			if (filePath && content) {
				files.push({
					path: filePath,
					content: content.trim(),
				})
			}
		}
	} while (match)

	// Create blobs for each file
	const blobs = await Promise.all(
		files.map(async (file) => {
			const { data: blob } = await octokit.rest.git.createBlob({
				owner,
				repo,
				content: file.content,
				encoding: 'utf-8',
			})
			return {
				path: file.path,
				sha: blob.sha,
				mode: '100644' as const,
				type: 'blob' as const,
			}
		}),
	)

	// Create a new tree
	const { data: newTree } = await octokit.rest.git.createTree({
		owner,
		repo,
		base_tree: baseSha,
		tree: blobs,
	})

	// Create a new commit
	const { data: newCommit } = await octokit.rest.git.createCommit({
		owner,
		repo,
		message,
		tree: newTree.sha,
		parents: [parentSha],
	})

	// Update the reference
	await octokit.rest.git.updateRef({
		owner,
		repo,
		ref: `heads/${defaultBranch}`,
		sha: newCommit.sha,
	})

	return newCommit.sha
}
