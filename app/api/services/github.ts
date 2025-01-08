import micromatch from 'micromatch'
import type { TreeItem, GithubContent } from '../types'
import { DEFAULT_IGNORE_PATTERNS } from '../constants'
import type { Octokit } from '@octokit/rest'

function shouldIgnorePath(path: string): boolean {
  return micromatch.isMatch(path, DEFAULT_IGNORE_PATTERNS, { dot: true })
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

async function fetchGithubTree(octokit: Octokit, owner: string, repo: string, path = ''): Promise<TreeItem[]> {
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
          children
        })
      }
    } else if (item.type === 'file') {
      result.push({
        type: 'file',
        name: item.name,
        path: item.path
      })
    }
  }

  return result.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name)
    return a.type === 'dir' ? -1 : 1
  })
}

async function fetchFileContent(octokit: Octokit, owner: string, repo: string, path: string): Promise<string> {
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

export async function getContent(octokit: Octokit, url: string): Promise<GithubContent> {
  const urlParts = url.replace('https://github.com/', '').split('/')
  const owner = urlParts[0]
  const repo = urlParts[1]
  const path = urlParts.slice(2).join('/')

  try {
    const tree = await fetchGithubTree(octokit, owner, repo, path)
    const treeString = generateTreeString([{
      type: 'dir',
      name: `${repo}/`,
      path: '',
      children: tree
    }])

    const files: { path: string, content: string }[] = []

    async function collectFiles(items: TreeItem[]) {
      for (const item of items) {
        if (item.type === 'file' && !shouldIgnorePath(item.path)) {
          const content = await fetchFileContent(octokit, owner, repo, item.path)
          files.push({
            path: item.path,
            content
          })
        }
        if (item.children) {
          await collectFiles(item.children)
        }
      }
    }

    await collectFiles(tree)

    return {
      tree: treeString,
      files
    }
  } catch (error: any) {
    throw new Error(`Failed to fetch GitHub content: ${error.message}`)
  }
}

export async function createFromTemplate(octokit: Octokit, templateOwner: string, templateRepo: string, newRepoName: string): Promise<string> {
  await octokit.rest.repos.createUsingTemplate({
    template_owner: templateOwner,
    template_repo: templateRepo,
    owner: 'productstudioinc',
    name: newRepoName,
    private: false,
    include_all_branches: false
  })

  return `https://github.com/productstudioinc/${newRepoName}`
}

export async function createCommit(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  content: string,
  message: string
): Promise<void> {
  try {
    const { data: branchData } = await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch,
    })

    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
      sha: branchData.commit.sha
    })
  } catch (error: any) {
    throw new Error(`Failed to create commit: ${error.message}`)
  }
}

export async function createCommitWithFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  files: { path: string; content: string }[],
  message: string
): Promise<void> {
  try {
    const { data: ref } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    })
    const currentCommitSha = ref.object.sha

    const { data: commit } = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: currentCommitSha,
    })
    const currentTreeSha = commit.tree.sha

    const blobs = await Promise.all(
      files.map(file =>
        octokit.rest.git.createBlob({
          owner,
          repo,
          content: file.content,
          encoding: 'utf-8',
        })
      )
    )

    const treeEntries = files.map((file, index) => ({
      path: file.path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: blobs[index].data.sha,
    }))

    const { data: newTree } = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: currentTreeSha,
      tree: treeEntries,
    })

    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message,
      tree: newTree.sha,
      parents: [currentCommitSha],
    })

    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
    })
  } catch (error: any) {
    throw new Error(`Failed to create commit: ${error.message}`)
  }
}

export async function deleteRepository(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<void> {
  try {
    await octokit.rest.repos.delete({
      owner,
      repo,
    })
  } catch (error: any) {
    throw new Error(`Failed to delete repository: ${error.message}`)
  }
} 