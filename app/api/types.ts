import type { RequestParameters } from '@octokit/types'
import type { OctokitResponse } from '@octokit/types'

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

export type OctokitClient = {
  rest: {
    repos: {
      getContent: (params: RequestParameters & {
        ref?: string
        owner: string
        repo: string
        path: string
      }) => Promise<OctokitResponse<any>>
      createUsingTemplate: (params: RequestParameters & {
        template_owner: string
        template_repo: string
        owner: string
        name: string
        private?: boolean
        include_all_branches?: boolean
      }) => Promise<OctokitResponse<any>>
      getBranch: (params: RequestParameters & {
        owner: string
        repo: string
        branch: string
      }) => Promise<OctokitResponse<any>>
      createOrUpdateFileContents: (params: RequestParameters & {
        owner: string
        repo: string
        path: string
        message: string
        content: string
        branch: string
        sha: string
      }) => Promise<OctokitResponse<any>>
    }
    git: {
      getRef: (params: RequestParameters & {
        owner: string
        repo: string
        ref: string
      }) => Promise<OctokitResponse<any>>
      getCommit: (params: RequestParameters & {
        owner: string
        repo: string
        commit_sha: string
      }) => Promise<OctokitResponse<any>>
      createBlob: (params: RequestParameters & {
        owner: string
        repo: string
        content: string
        encoding: string
      }) => Promise<OctokitResponse<any>>
      createTree: (params: RequestParameters & {
        owner: string
        repo: string
        base_tree: string
        tree: Array<{
          path: string
          mode: '100644'
          type: 'blob'
          sha: string
        }>
      }) => Promise<OctokitResponse<any>>
      createCommit: (params: RequestParameters & {
        owner: string
        repo: string
        message: string
        tree: string
        parents: string[]
      }) => Promise<OctokitResponse<any>>
      updateRef: (params: RequestParameters & {
        owner: string
        repo: string
        ref: string
        sha: string
      }) => Promise<OctokitResponse<any>>
    }
  }
}

export type Variables = {
  octokit: OctokitClient
} 