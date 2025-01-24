import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { handle } from 'hono/vercel'
import { z } from 'zod'
import { zfd } from 'zod-form-data'
import { deleteRepository, octokit } from '../services/github'
import {
	deleteProject as deleteVercelProject,
	checkDomainStatus,
} from '../services/vercel'
import { deleteDomainRecord } from '../services/cloudflare'
import { setupRepository } from '../services/repository'
import { handleDeployment } from '../services/deployment'
import {
	createProject,
	deleteProject,
	getProject,
	updateProjectStatus,
	updateProjectDetails,
	updateMobileScreenshot,
	ProjectError,
	getUserProjects,
	getProjectByName,
	findAvailableProjectName,
} from '../services/db/queries'
import { generateObject, generateText, streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { groq } from '@ai-sdk/groq'
import { db } from '../services/db'
import { eq, like } from 'drizzle-orm'
import { projects } from '../services/db/schema'
import { users } from '../services/db/schema'
import { supabase } from '../services/supabase'
import { captureAndStoreMobileScreenshot } from '../services/screenshot'
import { serve, type WorkflowBindings } from '@upstash/workflow/hono'
import {
	createWorkflowAnthropic,
	createWorkflowOpenAI,
} from '../services/aiwrappers'

const createRequestSchema = zfd.formData({
	name: z.string(),
	description: z.string(),
	userId: z.string().uuid(),
	questions: z.string().optional(),
	additionalInfo: zfd.text(z.string().optional()),
	icon: z.instanceof(Blob).optional(),
	images: z.array(z.instanceof(Blob)).optional(),
	private: z.boolean().optional(),
})

const refineRequestSchema = z.object({
	name: z.string().min(1),
	description: z.string().min(1),
})

interface Bindings extends WorkflowBindings {}

const app = new Hono<{ Bindings: Bindings }>().basePath('/api')

function handleError(error: unknown) {
	console.error(
		'Error details:',
		error instanceof ProjectError ? error.toString() : error,
	)

	if (error instanceof ProjectError) {
		const status =
			error.code === 'PROJECT_EXISTS'
				? 409
				: error.code === 'PROJECT_NOT_FOUND'
					? 404
					: error.code === 'USER_NOT_FOUND'
						? 404
						: 500

		throw new HTTPException(status, {
			message: error.message,
		})
	}

	if (error instanceof Error) {
		throw new HTTPException(500, {
			message: error.message,
		})
	}

	throw new HTTPException(500, {
		message: 'An unknown error occurred',
	})
}

app.delete('/projects/:name', async (c) => {
	const projectName = c.req.param('name')
	console.log(`Deleting project: ${projectName}`)

	const body = await z
		.object({
			userId: z.string().uuid(),
		})
		.parseAsync(await c.req.json())
		.catch(() => {
			throw new HTTPException(400, {
				message: 'Invalid request body: userId is required',
			})
		})

	try {
		const project = await getProjectByName(projectName)

		if (project.userId !== body.userId) {
			throw new HTTPException(403, {
				message: 'Unauthorized: Project does not belong to the user',
			})
		}

		await Promise.all([
			deleteRepository(octokit, 'productstudioinc', projectName),
			project.dnsRecordId
				? deleteDomainRecord(project.dnsRecordId)
				: Promise.resolve(),
			project.vercelProjectId
				? deleteVercelProject(project.vercelProjectId)
				: Promise.resolve(),
			supabase.storage
				.from('project-screenshots')
				.remove([`${project.userId}/${project.id}/screenshot.jpg`])
				.catch((error) => console.error('Failed to delete screenshot:', error)),
		])

		await db.delete(projects).where(eq(projects.id, project.id))
		console.log(
			`Successfully deleted project ${projectName} and associated resources`,
		)

		return c.json({
			status: 'success',
			message:
				'Repository, domain record, project and screenshot deleted successfully',
		})
	} catch (error) {
		handleError(error)
	}
})

type ProjectCreationPayload = z.infer<typeof createRequestSchema>

const handler = serve<ProjectCreationPayload, Bindings>(async (context) => {
	const validName = await context.run('get-valid-name', async () => {
		const formattedName = context.requestPayload.name
			.toLowerCase()
			.trim()
			.replace(/\s+/g, '-')
			.replace(/[^a-z0-9-]/g, '')
		const availableName = await findAvailableProjectName(formattedName)
		return availableName
	})

	let questionsContext = ''
	if (context.requestPayload.questions) {
		try {
			const questions = JSON.parse(context.requestPayload.questions)
			questionsContext = `\n\nAdditional context from questions:\n${Object.entries(
				questions,
			)
				.map(([question, answer]) => `${question}: ${answer}`)
				.join('\n')}`
		} catch (e) {
			console.error('Failed to parse questions:', e)
		}
	}

	const workflowOpenAI = createWorkflowOpenAI(context)

	const { text: conciseDescription } = await generateText({
		model: workflowOpenAI('gpt-4o-mini'),
		prompt: `Given this app description and any additional context from questions, generate a clear and personalized 1-sentence description that captures the core purpose and any personal customization details of the app. Make it brief but informative, and include any personal details that make it unique to the user.

Description: ${context.requestPayload.description}${questionsContext}

Example 1:
Description: Make a love language tracker for me and jake to see who's more romantic
Questions: Theme preference: Romantic and elegant
Output: A love language tracker for my boyfriend Jake with a romantic theme

Example 2:
Description: Create a workout tracker
Questions: Preferred workout type: Weightlifting, Goal: Build muscle mass
Output: A weightlifting tracker focused on muscle-building progress

Response format: Just return the concise description, nothing else.`,
	})

	const project = await context.run('create-database-project', async () => {
		const project = await createProject({
			userId: context.requestPayload.userId,
			name: validName,
			description: conciseDescription,
			displayName: context.requestPayload.name,
			projectId: '',
			private: context.requestPayload.private,
		})
		return project
	})

	const repoSetup = await context.run('setup-repository', async () => {
		const {
			projectId: vercelProjectId,
			dnsRecordId,
			customDomain,
		} = await setupRepository(
			octokit,
			validName,
			context.requestPayload.description + questionsContext,
		)
		return { vercelProjectId, dnsRecordId, customDomain }
	})

	await context.run('update-project-details', async () => {
		await updateProjectDetails({
			projectId: project.id,
			vercelProjectId: repoSetup.vercelProjectId,
			dnsRecordId: repoSetup.dnsRecordId,
			customDomain: repoSetup.customDomain,
		})
	})

	await context.run('update-project-status', async () => {
		await updateProjectStatus({
			projectId: project.id,
			status: 'creating',
			message: 'Repository setup complete',
		})
	})

	await context.run('check-domain-status', async () => {
		const isVerified = await checkDomainStatus(
			repoSetup.vercelProjectId,
			validName,
		)
		if (!isVerified) {
			throw new Error('Domain verification failed')
		}
	})

	await context.run('handle-deployment', async () => {
		await handleDeployment(
			project.id,
			octokit,
			validName,
			repoSetup.vercelProjectId,
		)
	})

	await context.run('screenshot-project', async () => {
		const screenshotUrl = await captureAndStoreMobileScreenshot(
			project.id,
			project.userId,
			`https://${validName}.usewisp.app`,
		)
		await updateMobileScreenshot(project.id, screenshotUrl)
	})
})

async function processProjectSetup(
	project: { id: string },
	name: string,
	description: string,
) {
	try {
		const {
			projectId: vercelProjectId,
			dnsRecordId,
			customDomain,
		} = await setupRepository(octokit, name, description)

		const projectDetails = await getProject(project.id)

		await updateProjectDetails({
			projectId: project.id,
			vercelProjectId,
			dnsRecordId,
			customDomain,
		})

		await updateProjectStatus({
			projectId: project.id,
			status: 'creating',
			message: 'Repository setup complete',
		})

		const isVerified = await checkDomainStatus(vercelProjectId, name)
		if (!isVerified) {
			throw new Error('Domain verification failed')
		}

		try {
			const screenshotUrl = await captureAndStoreMobileScreenshot(
				project.id,
				projectDetails.userId,
				`https://${name}.usewisp.app`,
			)
			await updateMobileScreenshot(project.id, screenshotUrl)
		} catch (screenshotError) {
			console.error('Failed to capture screenshot:', screenshotError)
		}

		await updateProjectStatus({
			projectId: project.id,
			status: 'deployed',
			message: 'Project successfully deployed',
			deployedAt: new Date(),
		})

		console.log(`Project ${name} successfully created and deployed`)
	} catch (error) {
		await updateProjectStatus({
			projectId: project.id,
			status: 'failed',
			message:
				error instanceof Error ? error.message : 'Unknown error occurred',
			error: error instanceof Error ? error.toString() : String(error),
		})
		console.error('Background task failed:', error)
	}
}

app.delete('/users/:id', async (c) => {
	const userId = c.req.param('id')
	console.log(`Deleting user: ${userId}`)

	try {
		const userProjects = await getUserProjects(userId)

		await Promise.all(
			userProjects.map(async (project) => {
				if (project.vercelProjectId && project.dnsRecordId && project.name) {
					await Promise.all([
						deleteRepository(octokit, 'productstudioinc', project.name),
						deleteDomainRecord(project.dnsRecordId),
						deleteVercelProject(project.vercelProjectId),
					])
				}
			}),
		)

		await db.delete(projects).where(eq(projects.userId, userId))

		await db.delete(users).where(eq(users.id, userId))

		const { error } = await supabase.auth.admin.deleteUser(userId)

		if (error) {
			throw new Error('Failed to delete user from Supabase')
		}

		console.log('User deleted from Supabase')

		return c.json({
			status: 'success',
			message: 'User and all associated projects deleted successfully',
		})
	} catch (error) {
		handleError(error)
	}
})

export const POST = handle(app)
export const DELETE = handle(app)
