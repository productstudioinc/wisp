import { eq, like } from 'drizzle-orm'
import { db } from './index'
import { projects, type projectStatus, users } from './schema'
import { NonRetriableError } from 'inngest'

export type ProjectStatus = (typeof projectStatus.enumValues)[number]

interface ErrorMetadata {
	timestamp: string
	operation: string
	details?: Record<string, unknown>
}

export class ProjectError extends Error {
	public timestamp: string
	public errorChain: string[]
	public metadata: ErrorMetadata

	constructor(
		message: string,
		public code: string,
		metadata: Partial<ErrorMetadata>,
		public originalError?: unknown,
	) {
		super(message)
		this.name = 'ProjectError'
		this.timestamp = new Date().toISOString()
		this.errorChain = []
		this.metadata = {
			timestamp: this.timestamp,
			operation: metadata.operation || 'unknown',
			details: metadata.details || {},
		}
		this.captureErrorChain()
	}

	private captureErrorChain() {
		this.errorChain = [this.message]

		if (this.originalError instanceof ProjectError) {
			this.errorChain.push(...this.originalError.errorChain)
		} else if (this.originalError instanceof Error) {
			this.errorChain.push(this.originalError.message)
			if (this.originalError.cause) {
				this.errorChain.push(String(this.originalError.cause))
			}
		} else if (this.originalError) {
			this.errorChain.push(String(this.originalError))
		}
	}

	public toJSON() {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			timestamp: this.timestamp,
			metadata: this.metadata,
			errorChain: this.errorChain,
		}
	}

	public toString() {
		const errorChain = this.errorChain.join(' → ')
		const details = JSON.stringify(this.metadata.details, null, 2)
		return `[${this.code}] ${errorChain}\nOperation: ${this.metadata.operation}\nDetails: ${details}`
	}
}

function createError(
	code: string,
	message: string,
	operation: string,
	details?: Record<string, unknown>,
	originalError?: unknown,
): ProjectError {
	return new ProjectError(message, code, { operation, details }, originalError)
}

export async function createProjectInDatabase({
	userId,
	name,
	description,
	displayName,
	projectId,
	dnsRecordId,
	customDomain,
	private: isPrivate = false,
}: {
	userId: string
	name: string
	description?: string
	displayName?: string
	projectId: string
	dnsRecordId?: string
	customDomain?: string
	private?: boolean
}) {
	const existingProject = await db
		.select()
		.from(projects)
		.where(eq(projects.name, name))
		.limit(1)

	if (existingProject.length > 0) {
		throw createError(
			'PROJECT_EXISTS',
			`Project with name "${name}" already exists`,
			'createProject',
			{ name, userId },
		)
	}

	const project = await db
		.insert(projects)
		.values({
			id: crypto.randomUUID(),
			userId,
			name,
			description,
			displayName,
			vercelProjectId: projectId,
			dnsRecordId,
			customDomain,
			private: isPrivate,
			status: 'creating',
			statusMessage: 'Project creation started',
			lastUpdated: new Date(),
			createdAt: new Date(),
		})
		.returning()

	return project[0]
}

export async function updateProjectStatus({
	projectId,
	status,
	message,
	error,
	deployedAt,
}: {
	projectId: string
	status: ProjectStatus
	message: string
	error?: string
	deployedAt?: Date
}) {
	try {
		const project = await db
			.select()
			.from(projects)
			.where(eq(projects.id, projectId))
			.limit(1)

		if (!project.length) {
			throw createError(
				'PROJECT_NOT_FOUND',
				`Project with ID "${projectId}" not found`,
				'updateProjectStatus',
				{ projectId, requestedStatus: status },
			)
		}

		const updatedProject = await db
			.update(projects)
			.set({
				status,
				statusMessage: message,
				lastUpdated: new Date(),
				error: error || null,
				deployedAt: deployedAt || project[0].deployedAt,
			})
			.where(eq(projects.id, projectId))
			.returning()

		return updatedProject[0]
	} catch (error) {
		if (error instanceof ProjectError) throw error

		throw createError(
			'UPDATE_FAILED',
			'Failed to update project status',
			'updateProjectStatus',
			{
				projectId,
				attemptedStatus: status,
				attemptedMessage: message,
			},
			error,
		)
	}
}

export async function deleteProject(projectId: string) {
	try {
		const project = await db
			.select()
			.from(projects)
			.where(eq(projects.vercelProjectId, projectId))
			.limit(1)

		if (!project.length) {
			throw createError(
				'PROJECT_NOT_FOUND',
				`Project with ID "${projectId}" not found`,
				'deleteProject',
				{ projectId },
			)
		}

		await db.delete(projects).where(eq(projects.vercelProjectId, projectId))
	} catch (error) {
		if (error instanceof ProjectError) throw error

		throw createError(
			'DELETE_FAILED',
			'Failed to delete project',
			'deleteProject',
			{
				projectId,
				attemptedOperation: 'delete',
			},
			error,
		)
	}
}

export async function getProject(id: string) {
	try {
		const project = await db
			.select()
			.from(projects)
			.where(eq(projects.id, id))
			.limit(1)

		if (!project.length) {
			throw createError(
				'PROJECT_NOT_FOUND',
				`Project with ID "${id}" not found`,
				'getProject',
				{ id },
			)
		}

		return project[0]
	} catch (error) {
		if (error instanceof ProjectError) throw error

		throw createError(
			'FETCH_FAILED',
			'Failed to fetch project',
			'getProject',
			{
				id,
				attemptedOperation: 'select',
			},
			error,
		)
	}
}

export async function getUserProjects(userId: string) {
	try {
		const user = await getUser(userId)
		if (!user) {
			throw createError(
				'USER_NOT_FOUND',
				`User with ID "${userId}" not found`,
				'getUserProjects',
				{ userId },
			)
		}

		return await db.select().from(projects).where(eq(projects.userId, userId))
	} catch (error) {
		if (error instanceof ProjectError) throw error

		throw createError(
			'FETCH_FAILED',
			'Failed to fetch user projects',
			'getUserProjects',
			{
				userId,
				attemptedOperation: 'select_user_projects',
			},
			error,
		)
	}
}

export async function getUser(userId: string) {
	try {
		const user = await db
			.select()
			.from(users)
			.where(eq(users.id, userId))
			.limit(1)

		if (!user.length) {
			throw createError(
				'USER_NOT_FOUND',
				`User with ID "${userId}" not found`,
				'getUser',
				{ userId },
			)
		}

		return user[0]
	} catch (error) {
		if (error instanceof ProjectError) throw error

		throw createError(
			'FETCH_FAILED',
			'Failed to fetch user',
			'getUser',
			{
				userId,
				attemptedOperation: 'select_user',
			},
			error,
		)
	}
}

export async function updateProjectDetails({
	projectId,
	vercelProjectId,
	dnsRecordId,
	customDomain,
}: {
	projectId: string
	vercelProjectId: string
	dnsRecordId?: string
	customDomain?: string
}) {
	const project = await db
		.select()
		.from(projects)
		.where(eq(projects.id, projectId))
		.limit(1)

	if (!project.length) {
		throw new NonRetriableError('Project not found')
	}

	const updatedProject = await db
		.update(projects)
		.set({
			vercelProjectId,
			dnsRecordId,
			customDomain,
			lastUpdated: new Date(),
		})
		.where(eq(projects.id, projectId))
		.returning()

	return updatedProject[0]
}

export async function updateMobileScreenshot(
	projectId: string,
	screenshotUrl: string,
) {
	try {
		const project = await db
			.select()
			.from(projects)
			.where(eq(projects.id, projectId))
			.limit(1)

		if (!project.length) {
			throw createError(
				'PROJECT_NOT_FOUND',
				`Project with ID "${projectId}" not found`,
				'updateMobileScreenshot',
				{ projectId },
			)
		}

		const updatedProject = await db
			.update(projects)
			.set({ mobileScreenshot: screenshotUrl })
			.where(eq(projects.id, projectId))
			.returning()

		return updatedProject[0]
	} catch (error) {
		if (error instanceof ProjectError) throw error

		throw createError(
			'UPDATE_FAILED',
			'Failed to update mobile screenshot',
			'updateMobileScreenshot',
			{
				projectId,
				attemptedOperation: 'update_screenshot',
			},
			error,
		)
	}
}

export async function getProjectByName(name: string) {
	try {
		const project = await db
			.select()
			.from(projects)
			.where(eq(projects.name, name))
			.limit(1)
			.then((results) => results[0])

		if (!project) {
			throw createError(
				'PROJECT_NOT_FOUND',
				`Project with name "${name}" not found`,
				'getProjectByName',
				{ name },
			)
		}

		return project
	} catch (error) {
		if (error instanceof ProjectError) throw error

		throw createError(
			'FETCH_FAILED',
			'Failed to fetch project by name',
			'getProjectByName',
			{
				name,
				attemptedOperation: 'select',
			},
			error,
		)
	}
}

export async function findAvailableProjectName(
	baseName: string,
): Promise<string> {
	const existingProjects = await db
		.select({ name: projects.name })
		.from(projects)
		.where(like(projects.name, `${baseName}%`))

	if (existingProjects.length === 0) return baseName

	const namePattern = new RegExp(`^${baseName}(-\\d+)?$`)
	const numbers = existingProjects
		.map((p) => p.name.match(namePattern))
		.filter((match): match is RegExpMatchArray => match !== null)
		.map((match) => {
			const num = match[1] ? Number.parseInt(match[1].slice(1), 10) : 1
			return num
		})

	const maxNumber = Math.max(0, ...numbers)
	return `${baseName}-${maxNumber + 1}`
}

export async function checkIfUserExists(userId: string) {
	try {
		const user = await db
			.select()
			.from(users)
			.where(eq(users.id, userId))
			.limit(1)
		return user.length > 0
	} catch (error) {
		throw new NonRetriableError('User does not exist')
	}
}
