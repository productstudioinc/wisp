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
import { createProject, deleteProject, getProject, updateProjectStatus, ProjectError } from '../services/db/queries'

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds

const createRequestSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Repository name must only contain letters, numbers, underscores, and hyphens'),
  prompt: z.string().optional(),
  userId: z.string().uuid()
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
      details: {
        code: error.code,
        errorChain: error.errorChain,
        operation: error.metadata.operation,
        details: error.metadata.details,
      }
    });
  }

  if (error instanceof Error) {
    throw new HTTPException(500, {
      message: error.message,
      details: { error: error.toString() }
    });
  }

  throw new HTTPException(500, {
    message: 'An unknown error occurred',
    details: { error: String(error) }
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
      details: query.error.format()
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
      metadata: {
        creationStarted: new Date().toISOString(),
      }
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
            message: `Repository setup attempt ${attempt} failed: ${error.message}`,
            metadata: { error: error.toString() }
          });
        }
      );

      await updateProjectStatus({
        projectId: project.id,
        status: 'deploying',
        message: 'Repository setup complete, starting deployment',
        metadata: { projectId, dnsRecordId, customDomain }
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
            metadata: { error: error.toString() }
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
        metadata: {
          customDomain,
          dnsRecordId,
          projectId,
          deployedAt: new Date().toISOString(),
        }
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
        metadata: { error: error instanceof Error ? error.toString() : String(error) }
      });
      throw error;
    }
  } catch (error) {
    handleError(error);
  }
})

export const POST = handle(app)
export const DELETE = handle(app)