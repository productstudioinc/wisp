import type { Octokit } from '@octokit/core'
import type { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods'

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
  octokit: OctokitClient
}

export type OctokitClient = Octokit & {
  rest: {
    repos: {
      getContent: (params: RestEndpointMethodTypes['repos']['getContent']['parameters']) => 
        Promise<RestEndpointMethodTypes['repos']['getContent']['response']>
    }
  }
} 