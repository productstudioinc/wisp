import type { Octokit } from '@octokit/rest'
import { checkDeploymentStatus } from './vercel'
import { getContent, createCommitWithFiles } from './github'
import { generateDeploymentErrorFix } from './ai'

const DEPLOYMENT_CHECK_INTERVAL = 5000
const MAX_DEPLOYMENT_ATTEMPTS = 20
const MAX_FIX_ATTEMPTS = 3

interface DeploymentStatus {
  success: boolean
  error?: string
  logs?: any
}

export async function waitForDeployment(
  projectId: string,
  octokit: Octokit,
  repoName: string,
): Promise<DeploymentStatus> {
  let attempts = 0

  while (attempts < MAX_DEPLOYMENT_ATTEMPTS) {
    const { state, logs } = await checkDeploymentStatus(projectId)

    switch (state) {
      case 'READY':
        return { success: true }
      case 'ERROR':
        return { success: false, error: 'Deployment failed', logs }
      case 'CANCELED':
      case 'DELETED':
        return { success: false, error: `Deployment ${state.toLowerCase()}`, logs }
      case 'NO_DEPLOYMENTS':
        if (attempts === MAX_DEPLOYMENT_ATTEMPTS - 1) {
          return { success: false, error: 'No deployments found after maximum attempts' }
        }
        break
      default:
        if (attempts === MAX_DEPLOYMENT_ATTEMPTS - 1) {
          return { success: false, error: `Deployment timed out in state: ${state}`, logs }
        }
    }

    await new Promise(resolve => setTimeout(resolve, DEPLOYMENT_CHECK_INTERVAL))
    attempts++
  }

  return { success: false, error: 'Deployment timeout exceeded' }
}

export async function handleDeploymentError(
  error: string,
  logs: any,
  octokit: Octokit,
  repoName: string,
  repoUrl: string
): Promise<boolean> {
  const { tree, files } = await getContent(octokit, repoUrl)
  const repoContent = `Directory structure:\n${tree}\n\nFiles:\n${files.map(
    (f: { path: string; content: string }) => `\n--- ${f.path} ---\n${f.content}`
  ).join('\n')}`

  const result = await generateDeploymentErrorFix(repoContent, logs)
  if (!result?.changes?.length) return false

  const patchFiles = result.changes.map(change => ({
    path: change.path,
    content: change.content
  }))

  await createCommitWithFiles(
    octokit,
    'productstudioinc',
    repoName,
    'main',
    patchFiles,
    `fix: deployment error\n\n${error}\n\n${result.changes.map(c => `- ${c.description}`).join('\n')}`
  )

  return true
}

export async function handleDeploymentWithRetries(
  projectId: string,
  octokit: Octokit,
  repoName: string,
  repoUrl: string
): Promise<boolean> {
  let fixAttempts = 0

  while (fixAttempts < MAX_FIX_ATTEMPTS) {
    const deploymentStatus = await waitForDeployment(projectId, octokit, repoName)
    if (deploymentStatus.success) return true

    if (!deploymentStatus.logs) return false

    const fixed = await handleDeploymentError(
      deploymentStatus.error || 'Unknown error',
      deploymentStatus.logs,
      octokit,
      repoName,
      repoUrl
    )

    if (!fixed) return false

    await new Promise(resolve => setTimeout(resolve, DEPLOYMENT_CHECK_INTERVAL))
    fixAttempts++
  }

  return false
} 