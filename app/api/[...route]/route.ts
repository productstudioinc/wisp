import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { handle } from 'hono/vercel'
import { z } from 'zod'
import type { Variables } from '../types'
import { withGithubAuth } from '../middleware'
import { deleteRepository } from '../services/github'
import { deleteProject as deleteVercelProject, checkDomainStatus } from '../services/vercel'
import { deleteDomainRecord } from '../services/cloudflare'
import { setupRepository } from '../services/repository'
import { handleDeploymentWithRetries } from '../services/deployment'
import { createProject, deleteProject, getProject, updateProjectStatus, updateProjectDetails, ProjectError } from '../services/db/queries'
import { generateObject, generateText, streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { stream } from 'hono/streaming';
import { openai } from '@ai-sdk/openai'
import { groq } from '@ai-sdk/groq'

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds

const createRequestSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Repository name must only contain letters, numbers, underscores, and hyphens'),
  prompt: z.string().optional(),
  userId: z.string().uuid()
})

const refineRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
})

const app = new Hono<{ Variables: Variables }>().basePath('/api')

app.use('*', withGithubAuth)

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  retries = MAX_RETRIES,
  delay = INITIAL_RETRY_DELAY,
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      if (onRetry) onRetry(attempt, error);

      if (attempt === retries) break;
      await sleep(delay * 2 ** (attempt - 1));
    }
  }

  // biome-ignore lint/style/noNonNullAssertion: <explanation>
  throw lastError!;
}

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

    // Delete resources in parallel with proper error handling
    const results = await Promise.allSettled([
      retryWithBackoff(() => deleteRepository(octokit, 'productstudioinc', params), 3),
      retryWithBackoff(() => deleteDomainRecord(query.data.dns_record_id), 3),
      retryWithBackoff(() => deleteVercelProject(query.data.project_id), 3)
    ]);

    // Check for any failures
    const failures = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    if (failures.length > 0) {
      const failureDetails = failures.map(f => f.reason).join('\n');
      throw new Error(`Failed to delete project resources:\n${failureDetails}`);
    }

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

app.post('/projects', async (c) => {
  const body = await createRequestSchema.parseAsync(await c.req.json())
  console.log(`Creating new project: ${body.name}`)

  try {
    const octokit = c.get('octokit')

    // Create project in database first
    const project = await createProject({
      userId: body.userId,
      name: body.name,
      prompt: body.prompt,
      projectId: '', // Will be updated after repository setup
    })

    try {
      // Setup repository with retries
      const { projectId, dnsRecordId, customDomain } = await retryWithBackoff(
        () => setupRepository(octokit, body.name, body.prompt),
        3,
        2000,
        async (attempt, error) => {
          await updateProjectStatus({
            projectId: project.id,
            status: 'creating',
            message: `Setting up repository (attempt ${attempt}/3)`,
            error: error.toString()
          });
        }
      );

      // Update project with the new values
      await updateProjectDetails({
        projectId: project.id,
        vercelProjectId: projectId,
        dnsRecordId,
        customDomain
      });

      await updateProjectStatus({
        projectId: project.id,
        status: 'creating',
        message: 'Repository setup complete'
      });

      // Verify domain with exponential backoff
      const domainVerified = await retryWithBackoff(
        async () => {
          const isVerified = await checkDomainStatus(projectId, body.name);
          if (!isVerified) throw new Error('Domain not verified');
          return true;
        },
        10,
        1000,
        async (attempt, error) => {
          await updateProjectStatus({
            projectId: project.id,
            status: 'deploying',
            message: `Verifying domain status (attempt ${attempt}/10)`,
            error: error.toString()
          });
        }
      );

      if (!domainVerified) {
        throw new Error('Domain verification failed after multiple attempts');
      }

      const deploymentSuccess = await handleDeploymentWithRetries(
        projectId,
        octokit,
        body.name,
        `https://github.com/productstudioinc/${body.name}`
      );

      if (!deploymentSuccess) {
        throw new Error('Deployment failed after multiple attempts');
      }

      await updateProjectStatus({
        projectId: project.id,
        status: 'deployed',
        message: 'Project successfully deployed',
        deployedAt: new Date()
      });

      console.log(`Project ${body.name} successfully created and deployed`);
      return c.json({
        custom_domain: customDomain,
        dns_record_id: dnsRecordId,
        project_id: projectId,
        status: 'success',
        message: body.prompt
          ? 'Repository created and deployed with AI-generated changes'
          : 'Repository created and deployed'
      });
    } catch (error) {
      // If we fail after creating the project, update its status to failed
      await updateProjectStatus({
        projectId: project.id,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        error: error instanceof Error ? error.toString() : String(error)
      });
      throw error;
    }
  } catch (error) {
    handleError(error);
  }
})

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


export const POST = handle(app)
export const DELETE = handle(app)