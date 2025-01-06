import micromatch from 'micromatch'
import type { TreeItem, GithubContent, OctokitClient } from '../types'
import { DEFAULT_IGNORE_PATTERNS } from '../constants'

export class GithubService {
  private static shouldIgnorePath(path: string): boolean {
    return micromatch.isMatch(path, DEFAULT_IGNORE_PATTERNS, { dot: true })
  }

  private static generateTreeString(tree: TreeItem[], prefix = ''): string {
    let result = ''
    tree.forEach((item, index) => {
      const isLast = index === tree.length - 1
      const connector = isLast ? '└── ' : '├── '
      result += `${prefix}${connector}${item.name}\n`
      
      if (item.children) {
        const newPrefix = prefix + (isLast ? '    ' : '│   ')
        result += this.generateTreeString(item.children, newPrefix)
      }
    })
    return result
  }

  private static async fetchGithubTree(octokit: OctokitClient, owner: string, repo: string, path: string = ''): Promise<TreeItem[]> {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
    })

    const items = Array.isArray(response.data) ? response.data : [response.data]
    const result: TreeItem[] = []

    for (const item of items) {
      if (this.shouldIgnorePath(item.path)) {
        continue
      }

      if (item.type === 'dir') {
        const children = await this.fetchGithubTree(octokit, owner, repo, item.path)
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

  private static async fetchFileContent(octokit: OctokitClient, owner: string, repo: string, path: string): Promise<string> {
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

  static async getContent(octokit: OctokitClient, url: string): Promise<GithubContent> {
    const urlParts = url.replace('https://github.com/', '').split('/')
    const owner = urlParts[0]
    const repo = urlParts[1]
    const path = urlParts.slice(2).join('/')

    try {
      const tree = await this.fetchGithubTree(octokit, owner, repo, path)
      const treeString = this.generateTreeString([{
        type: 'dir',
        name: `${repo}/`,
        path: '',
        children: tree
      }])

      const files: { path: string, content: string }[] = []
      
      async function collectFiles(items: TreeItem[]) {
        for (const item of items) {
          if (item.type === 'file' && !GithubService.shouldIgnorePath(item.path)) {
            const content = await GithubService.fetchFileContent(octokit, owner, repo, item.path)
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
} 