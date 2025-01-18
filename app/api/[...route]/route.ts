import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { handle } from 'hono/vercel'
import { z } from 'zod'
import { zfd } from "zod-form-data"
import type { Variables } from '../types'
import { withGithubAuth } from '../middleware'
import { deleteRepository } from '../services/github'
import { deleteProject as deleteVercelProject, checkDomainStatus } from '../services/vercel'
import { deleteDomainRecord } from '../services/cloudflare'
import { setupRepository } from '../services/repository'
import { handleDeploymentWithRetries } from '../services/deployment'
import { createProject, deleteProject, getProject, updateProjectStatus, updateProjectDetails, updateMobileScreenshot, ProjectError, getUserProjects } from '../services/db/queries'
import { generateObject, generateText, streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { groq } from '@ai-sdk/groq'
import { db } from '../services/db'
import { eq, like } from 'drizzle-orm'
import { projects } from '../services/db/schema'
import { users } from '../services/db/schema'
import { supabase } from '../services/supabase'
import { captureAndStoreMobileScreenshot } from '../services/screenshot'

const createRequestSchema = zfd.formData({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Repository name must only contain letters, numbers, underscores, and hyphens'),
  description: z.string(),
  userId: z.string().uuid(),
  additionalInfo: zfd.text(z.string().optional()),
  icon: zfd.file().optional(),
  images: zfd.repeatableOfType(zfd.file()).optional(),
  private: z.boolean().optional(),
})

const refineRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
})

const app = new Hono<{ Variables: Variables }>().basePath('/api')

app.use('*', withGithubAuth)

function handleError(error: unknown) {
  console.error('Error details:', error instanceof ProjectError ? error.toString() : error);

  if (error instanceof ProjectError) {
    const status = error.code === 'PROJECT_EXISTS' ? 409 :
      error.code === 'PROJECT_NOT_FOUND' ? 404 :
        error.code === 'USER_NOT_FOUND' ? 404 : 500;

    throw new HTTPException(status, {
      message: error.message,
    });
  }

  if (error instanceof Error) {
    throw new HTTPException(500, {
      message: error.message,
    });
  }

  throw new HTTPException(500, {
    message: 'An unknown error occurred',
  });
}

app.delete('/projects/:name', async (c) => {
  const params = c.req.param('name')
  console.log(`Deleting project: ${params}`)

  const query = z.object({
    dns_record_id: z.string().min(1),
    project_id: z.string().min(1)
  }).safeParse(c.req.query())

  if (!query.success) {
    throw new HTTPException(400, {
      message: 'Invalid query parameters',
    });
  }

  try {
    const octokit = c.get('octokit')
    const project = await getProject(query.data.project_id)

    await Promise.all([
      deleteRepository(octokit, 'productstudioinc', params),
      deleteDomainRecord(query.data.dns_record_id),
      deleteVercelProject(query.data.project_id)
    ]);

    await deleteProject(query.data.project_id);
    console.log(`Successfully deleted project ${params} and associated resources`);

    return c.json({
      status: 'success',
      message: 'Repository, domain record, and project deleted successfully'
    })
  } catch (error) {
    handleError(error);
  }
})

async function findAvailableProjectName(baseName: string): Promise<string> {
  const existingProjects = await db.select({ name: projects.name })
    .from(projects)
    .where(like(projects.name, `${baseName}%`));

  if (existingProjects.length === 0) return baseName;

  const namePattern = new RegExp(`^${baseName}(-\\d+)?$`);
  const numbers = existingProjects
    .map(p => p.name.match(namePattern))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map(match => {
      const num = match[1] ? Number.parseInt(match[1].slice(1), 10) : 1;
      return num;
    });

  const maxNumber = Math.max(0, ...numbers);
  return `${baseName}-${maxNumber + 1}`;
}

app.post('/projects', async (c) => {
  const formData = await c.req.formData()
  const result = await createRequestSchema.parseAsync(formData)
  console.log(`Requested project name: ${result.name}`)

  try {
    const octokit = c.get('octokit')
    const availableName = await findAvailableProjectName(result.name)
    console.log(`Using available project name: ${availableName}`)

    const project = await createProject({
      userId: result.userId,
      name: availableName,
      prompt: result.description,
      projectId: '',
      private: result.private,
    })

    processProjectSetup(project, octokit, availableName, result.description).catch(error => {
      console.error('Background task failed:', error);
    });

    return c.json({
      id: project.id,
      name: availableName,
      status: 'creating',
      message: 'Project creation started'
    });

  } catch (error) {
    handleError(error);
  }
})

async function processProjectSetup(
  project: { id: string },
  octokit: any,
  name: string,
  prompt: string
) {
  try {
    const { projectId: vercelProjectId, dnsRecordId, customDomain } = await setupRepository(octokit, name, prompt);

    const projectDetails = await getProject(project.id);

    await updateProjectDetails({
      projectId: project.id,
      vercelProjectId,
      dnsRecordId,
      customDomain
    });

    await updateProjectStatus({
      projectId: project.id,
      status: 'creating',
      message: 'Repository setup complete'
    });

    const isVerified = await checkDomainStatus(vercelProjectId, name);
    if (!isVerified) {
      throw new Error('Domain verification failed');
    }

    const deploymentSuccess = await handleDeploymentWithRetries(
      vercelProjectId,
      octokit,
      name,
      `https://github.com/productstudioinc/${name}`
    );

    if (!deploymentSuccess) {
      throw new Error('Deployment failed');
    }

    try {
      const screenshotUrl = await captureAndStoreMobileScreenshot(
        project.id,
        projectDetails.userId,
        `https://${name}.usewisp.app`
      );
      await updateMobileScreenshot(project.id, screenshotUrl);
    } catch (screenshotError) {
      console.error('Failed to capture screenshot:', screenshotError);
    }

    await updateProjectStatus({
      projectId: project.id,
      status: 'deployed',
      message: 'Project successfully deployed',
      deployedAt: new Date()
    });

    console.log(`Project ${name} successfully created and deployed`);
  } catch (error) {
    await updateProjectStatus({
      projectId: project.id,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
      error: error instanceof Error ? error.toString() : String(error)
    });
    console.error('Background task failed:', error);
  }
}

app.post('/refine', async c => {
  const body = await refineRequestSchema.parseAsync(await c.req.json())
  const result = await generateText({
    model: anthropic('claude-3-5-sonnet-latest'),
    prompt: `You are an AI assistant specialized in product development, particularly in helping users generate ideas for personalized apps. Your task is to analyze an app concept and provide tailored questions and image suggestions to help refine the app idea.

Here's the app concept you need to work with:

App Name: ${body.name}
App Description: ${body.description}

Your goal is to generate:
1. A list of 3-5 questions that will help personalize the app that are concise and not overly specific.
2. A single string of suggestions for images that users could provide to enhance the app's development.

Before providing your final output, in <app_analysis> tags:

1. Break down the app concept into key features and potential target audience.
2. Brainstorm a list of 8-10 potential questions related to personalizing the app.
3. Narrow down the list to the 3-5 most effective questions that are tailored but not overly specific.
4. Consider different aspects of the app that could benefit from visual elements and list potential image categories.

Make sure to focus on creating questions that are tailored towards creating a personalized app without being so specific that they limit the app's potential.

<app_analysis>
[Your analysis of the app concept, breakdown of features, target audience, question brainstorming, question selection, and image suggestion consideration goes here.]
</app_analysis>

After your analysis, please provide your final output in the following format:

<output>
Questions:
1. [Question 1]
2. [Question 2]
3. [Question 3]
(Add more if necessary, up to 5 questions)

Image Suggestions: [A single string of suggestions for types of images to upload]
</output>

Remember, the questions should be designed to gather information that will help personalize the app without being so specific that they limit the app's potential or make it impossible to generate. The image suggestions should be general enough to apply to various users while still being relevant to the app concept.`,
  })

  console.log(result.text)

  const { object } = await generateObject({
    model: groq('llama-3.1-8b-instant'),
    schema: z.object({
      questions: z.string().array(),
      imageSuggestions: z.string()
    }),
    prompt: `From this analysis, generate a JSON object with the questions and image suggestions for my app. Do not modify or include any other text.

    Analysis: ${result.text}
    `
  })

  console.log(object)

  return c.json(object)
})

app.delete('/users/:id', async (c) => {
  const userId = c.req.param('id')
  console.log(`Deleting user: ${userId}`)

  try {
    const userProjects = await getUserProjects(userId)

    await Promise.all(userProjects.map(async (project) => {
      if (project.vercelProjectId && project.dnsRecordId && project.name) {
        await Promise.all([
          deleteRepository(c.get('octokit'), 'productstudioinc', project.name),
          deleteDomainRecord(project.dnsRecordId),
          deleteVercelProject(project.vercelProjectId)
        ]);
      }
    }));

    await db.delete(projects).where(eq(projects.userId, userId));

    await db.delete(users).where(eq(users.id, userId));

    const { error } = await supabase.auth.admin.deleteUser(userId)

    if (error) {
      throw new Error('Failed to delete user from Supabase');
    }

    console.log('User deleted from Supabase')

    return c.json({
      status: 'success',
      message: 'User and all associated projects deleted successfully'
    })
  } catch (error) {
    handleError(error);
  }
})

export const POST = handle(app)
export const DELETE = handle(app)