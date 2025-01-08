import type { RequestParameters } from '@octokit/types'
import type { OctokitResponse } from '@octokit/types'
import type { Octokit } from '@octokit/rest'

export type TreeItem = {
  type: 'file' | 'dir'
  name: string
  path: string
  children?: TreeItem[]
}

export type GithubContent = {
  tree: string
  files: { path: string; content: string }[]
}

export type Variables = {
  octokit: Octokit
} 