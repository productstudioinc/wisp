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
import { createProject, deleteProject, getProject, updateProjectStatus, updateProjectDetails, updateMobileScreenshot, ProjectError, getUserProjects, getProjectByName, findAvailableProjectName } from '../services/db/queries'
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
  name: z.string(),
  description: z.string(),
  userId: z.string().uuid(),
  questions: z.string().optional(),
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
  const projectName = c.req.param('name')
  console.log(`Deleting project: ${projectName}`)

  const body = await z.object({
    userId: z.string().uuid()
  }).parseAsync(await c.req.json())
    .catch(() => {
      throw new HTTPException(400, {
        message: 'Invalid request body: userId is required',
      });
    });

  try {
    const octokit = c.get('octokit')
    const project = await getProjectByName(projectName);

    if (project.userId !== body.userId) {
      throw new HTTPException(403, {
        message: 'Unauthorized: Project does not belong to the user',
      });
    }

    await Promise.all([
      deleteRepository(octokit, 'productstudioinc', projectName),
      project.dnsRecordId ? deleteDomainRecord(project.dnsRecordId) : Promise.resolve(),
      project.vercelProjectId ? deleteVercelProject(project.vercelProjectId) : Promise.resolve(),
      supabase.storage
        .from('project-screenshots')
        .remove([`${project.userId}/${project.id}/screenshot.jpg`])
        .catch(error => console.error('Failed to delete screenshot:', error)),
    ]);

    await db.delete(projects).where(eq(projects.id, project.id));
    console.log(`Successfully deleted project ${projectName} and associated resources`);

    return c.json({
      status: 'success',
      message: 'Repository, domain record, project and screenshot deleted successfully'
    })
  } catch (error) {
    handleError(error);
  }
})

app.post('/projects', async (c) => {
  const formData = await c.req.formData()
  const result = await createRequestSchema.parseAsync(formData)
  console.log(`Requested project name: ${result.name}`)

  try {
    const octokit = c.get('octokit')
    const displayName = result.name
    const formattedName = result.name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const availableName = await findAvailableProjectName(formattedName)
    console.log(`Using available project name: ${availableName}`)

    let questionsContext = ''
    if (result.questions) {
      try {
        const questions = JSON.parse(result.questions)
        questionsContext = `\n\nAdditional context from questions:\n${Object.entries(questions)
          .map(([question, answer]) => `${question}: ${answer}`)
          .join('\n')
          }`
      } catch (e) {
        console.error('Failed to parse questions:', e)
      }
    }

    const conciseDescription = await generateText({
      model: anthropic('claude-3-5-sonnet-latest'),
      prompt: `Given this app description and any additional context from questions, generate a clear and personalized 1-sentence description that captures the core purpose and any personal customization details of the app. Make it brief but informative, and include any personal details that make it unique to the user.

Description: ${result.description}${questionsContext}

Example 1:
Description: Make a love language tracker for me and jake to see who's more romantic
Questions: Theme preference: Romantic and elegant
Output: A love language tracker for my boyfriend Jake with a romantic theme

Example 2:
Description: Create a workout tracker
Questions: Preferred workout type: Weightlifting, Goal: Build muscle mass
Output: A weightlifting tracker focused on muscle-building progress

Response format: Just return the concise description, nothing else.`
    });

    const project = await createProject({
      userId: result.userId,
      name: availableName,
      description: conciseDescription.text,
      displayName: displayName,
      projectId: '',
      private: result.private,
    })

    processProjectSetup(project, octokit, availableName, result.description + questionsContext).catch(error => {
      console.error('Background task failed:', error);
    });

    return c.json({
      id: project.id,
      name: availableName,
      displayName: result.name,
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
  description: string
) {
  try {
    const { projectId: vercelProjectId, dnsRecordId, customDomain } = await setupRepository(octokit, name, description);

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