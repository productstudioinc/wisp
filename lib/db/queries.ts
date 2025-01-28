import { eq, like } from 'drizzle-orm'
import { projects, type projectStatus, users } from './schema'
import { NonRetriableError } from 'inngest'
import { db } from './drizzle'

export type ProjectStatus = (typeof projectStatus.enumValues)[number]

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
		throw new NonRetriableError(`Project with name "${name}" already exists`)
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
	const project = await db
		.select()
		.from(projects)
		.where(eq(projects.id, projectId))
		.limit(1)

	if (!project.length) {
		throw new NonRetriableError(`Project with ID "${projectId}" not found`)
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
}

export async function deleteProject(projectId: string) {
	const project = await db
		.select()
		.from(projects)
		.where(eq(projects.vercelProjectId, projectId))
		.limit(1)

	if (!project.length) {
		throw new NonRetriableError(`Project with ID "${projectId}" not found`)
	}

	await db.delete(projects).where(eq(projects.vercelProjectId, projectId))
}

export async function getProject(id: string) {
	const project = await db
		.select()
		.from(projects)
		.where(eq(projects.id, id))
		.limit(1)

	if (!project.length) {
		throw new NonRetriableError(`Project with ID "${id}" not found`)
	}

	return project[0]
}

export async function getUserProjects(userId: string) {
	const user = await getUser(userId)
	if (!user) {
		throw new NonRetriableError(`User with ID "${userId}" not found`)
	}

	return await db.select().from(projects).where(eq(projects.userId, userId))
}

export async function getUser(userId: string) {
	const user = await db
		.select()
		.from(users)
		.where(eq(users.id, userId))
		.limit(1)

	if (!user.length) {
		throw new NonRetriableError(`User with ID "${userId}" not found`)
	}

	return user[0]
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
	const project = await db
		.select()
		.from(projects)
		.where(eq(projects.id, projectId))
		.limit(1)

	if (!project.length) {
		throw new NonRetriableError(`Project with ID "${projectId}" not found`)
	}

	const updatedProject = await db
		.update(projects)
		.set({ mobileScreenshot: screenshotUrl })
		.where(eq(projects.id, projectId))
		.returning()

	return updatedProject[0]
}

export async function getProjectByName(name: string) {
	const project = await db
		.select()
		.from(projects)
		.where(eq(projects.name, name))
		.limit(1)
		.then((results) => results[0])

	if (!project) {
		throw new NonRetriableError(`Project with name "${name}" not found`)
	}

	return project
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
