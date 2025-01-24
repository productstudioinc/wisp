import type { Octokit } from '@octokit/rest'
import { checkDeploymentStatus } from './vercel'
import { getContent, createCommitWithFiles } from './github'
import { generateDeploymentErrorFix } from './ai'

interface DeploymentStatus {
	success: boolean
	error?: string
	logs?: any
}

export async function waitForDeployment(
	projectId: string,
): Promise<DeploymentStatus> {
	const { state, logs } = await checkDeploymentStatus(projectId)

	switch (state) {
		case 'READY':
			return { success: true }
		case 'ERROR':
			return { success: false, error: 'Deployment failed', logs }
		case 'CANCELED':
		case 'DELETED':
			return {
				success: false,
				error: `Deployment ${state.toLowerCase()}`,
				logs,
			}
		case 'NO_DEPLOYMENTS':
			return {
				success: false,
				error: 'No deployments found',
			}
		default:
			return {
				success: false,
				error: `Deployment in state: ${state}`,
				logs,
			}
	}
}

export async function handleDeploymentError(
	error: string,
	logs: any,
	octokit: Octokit,
	repoName: string,
	repoUrl: string,
): Promise<boolean> {
	const { tree, files } = await getContent(octokit, repoUrl)
	const repoContent = `Directory structure:\n${tree}\n\nFiles:\n${files
		.map(
			(f: { path: string; content: string }) =>
				`\n--- ${f.path} ---\n${f.content}`,
		)
		.join('\n')}`

	const result = await generateDeploymentErrorFix(repoContent, logs)
	if (!result?.changes?.length) return false

	const patchFiles = result.changes.map((change) => ({
		path: change.path,
		content: change.content,
	}))

	await createCommitWithFiles(
		octokit,
		'productstudioinc',
		repoName,
		'main',
		patchFiles,
		`fix: deployment error\n\n${error}\n\n${result.changes.map((c) => `- ${c.description}`).join('\n')}`,
	)

	return true
}

export async function handleDeployment(
	projectId: string,
	octokit: Octokit,
	repoName: string,
	repoUrl: string,
): Promise<boolean> {
	const deploymentStatus = await waitForDeployment(projectId)
	if (deploymentStatus.success) return true
	if (!deploymentStatus.logs) return false

	return handleDeploymentError(
		deploymentStatus.error || 'Unknown error',
		deploymentStatus.logs,
		octokit,
		repoName,
		repoUrl,
	)
}
