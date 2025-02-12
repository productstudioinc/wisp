import {
  checkIfUserExists,
  createProjectInDatabase,
  findAvailableProjectName,
  getProject,
  updateMobileScreenshot,
  updateProjectDetails,
  updateProjectStatus,
} from '@/lib/db/queries'
import { inngest } from './client'
import { APICallError, generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { RetryAfterError } from 'inngest'
import octokit, {
  createCommitFromDiff,
  getTrimmedContent,
} from '../services/github'
import { checkDomainStatus, vercel } from '../services/vercel'
import { cloudflareClient } from '../services/cloudflare'
import { captureAndStoreMobileScreenshot } from '../services/screenshot'
import { google } from '@ai-sdk/google'

export const createProject = inngest.createFunction(
  {
    id: 'create-project',
  },
  { event: 'project/create' },
  async ({ event, step }) => {
    await checkIfUserExists(event.data.userId)

    const formattedName = event.data.name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
    const availableName = await step.run('find-available-name', async () => {
      const availableName = await findAvailableProjectName(formattedName)
      return availableName
    })

    let questionsContext = ''
    if (event.data.questions) {
      try {
        const questions = JSON.parse(event.data.questions)
        questionsContext = `\n\nAdditional context from questions:\n${Object.entries(
          questions,
        )
          .map(([question, answer]) => `${question}: ${answer}`)
          .join('\n')}`
      } catch (e) {
        console.error('Failed to parse questions:', e)
      }
    }

    const { text: description } = await step.ai
      .wrap('generate-description', generateText, {
        model: google('gemini-2.0-flash-lite-preview-02-05'),
        prompt: `Given this app description and any additional context from questions, generate a clear and personalized 1-sentence description that captures the core purpose and any personal customization details of the app. Make it brief but informative, and include any personal details that make it unique to the user.

      Description: ${event.data.description}${questionsContext}

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
      .catch((error) => {
        if (APICallError.isInstance(error) && error.responseHeaders) {
          const rateLimitReset =
            error.responseHeaders['anthropic-ratelimit-tokens-reset']
          if (rateLimitReset) {
            const resetTime = new Date(Number.parseInt(rateLimitReset) * 1000)
            throw new RetryAfterError('Hit Anthropic rate limit', resetTime)
          }
        }
        throw error
      })

    const project = await step.run('create-project-in-database', async () => {
      return await createProjectInDatabase({
        userId: event.data.userId,
        name: availableName,
        description: description,
        displayName: event.data.name,
        projectId: '',
        private: event.data.private,
      })
    })

    const repoUrl = await step.run('create-from-template', async () => {
      await octokit.rest.repos.createUsingTemplate({
        template_owner: 'productstudioinc',
        template_repo: 'vite_react_shadcn_pwa',
        owner: 'productstudioinc',
        name: availableName,
        private: false,
        include_all_branches: false,
      })

      return `https://github.com/productstudioinc/${availableName}`
    })

    await step.sleep('wait-for-template-creation', 3000)

    const vercelProject = await step.run('setup-vercel-project', async () => {
      const createResponse = await vercel.projects.createProject({
        teamId: 'product-studio',
        requestBody: {
          name: availableName,
          framework: 'vite',
          gitRepository: {
            repo: `productstudioinc/${availableName}`,
            type: 'github',
          },
        },
      })

      return {
        projectId: createResponse.id,
        deploymentUrl: `https://${availableName}.vercel.app`,
      }
    })

    await step.run('add-domain-to-project', async () => {
      await vercel.projects.addProjectDomain({
        idOrName: vercelProject.projectId,
        teamId: 'product-studio',
        requestBody: {
          name: `${availableName}.usewisp.app`,
        },
      })
    })

    const dnsRecord = await step.run('create-dns-record', async () => {
      const result = await cloudflareClient.dns.records.create({
        type: 'CNAME',
        name: availableName,
        zone_id: process.env.CLOUDFLARE_ZONE_ID as string,
        proxied: false,
        content: 'cname.vercel-dns.com.',
      })

      return result.id
    })

    await step.run('update-project-details', async () => {
      await updateProjectDetails({
        projectId: project.id,
        vercelProjectId: vercelProject.projectId,
        dnsRecordId: dnsRecord || undefined,
        customDomain: `${availableName}.usewisp.app`,
      })
    })

    const githubContent = await step.run('get-github-content', async () => {
      return await getTrimmedContent(repoUrl)
    })

    const { text: implementationPlan } = await step.ai.wrap('generate-implementation-plan', generateText, {
      model: anthropic('claude-3-5-sonnet-latest'),
      system: `You are Wisp, an AI assistant that is an expert at React, Vite, Shadcn, and PWAs.
Your task is to implement user-requested apps based on our template repository:
${githubContent}

Template Structure:
- index.html
- vite.config.ts
- src/App.tsx
- src/index.css

Available ShadCN Components:
- accordion.tsx
- button.tsx
- card.tsx
- checkbox.tsx
- dropdown-menu.tsx
- input.tsx
- label.tsx
- radio-group.tsx
- scroll-area.tsx
- select.tsx
- sonner.tsx
- tabs.tsx
- textarea.tsx
- theme-provider.tsx

Implementation Requirements:

1. File-Specific Rules:
   index.html:
   - ONLY modify title and meta tags in <head>
   
   vite.config.ts:
   - ONLY modify the manifest section
   - DO NOT modify the head section
   
   App.tsx:
   - MUST keep imports: 
     import { RootLayout } from './components/root-layout'
     import { toast } from 'sonner'
   - ONLY modify content within <RootLayout> where "Place app content here" is marked
   - MUST export App as default component

2. Styling Guidelines:
   - Use Tailwind throughout
   - Mobile-first design approach
   - Maintain existing Tailwind classes and variables
   - Can add new styles but cannot remove existing ones

3. Implementation Best Practices:
   - Use localStorage for data persistence
   - Ensure type safety (ignore common TypeScript errors like 'Type 'Timeout' is not assignable to type 'number'')
   - Create comprehensive, production-ready features

Output Format:
<think>
[Your implementation reasoning]
</think>

<files>
<index.html>
[Complete index.html content]
</index.html>

<vite.config.ts>
[Complete vite.config.ts content]
</vite.config.ts>

<src/App.tsx>
[Complete App.tsx content]
</src/App.tsx>
</files>`,
      prompt: `Analyze this feature request and create an implementation plan:
    ${event.data.description}

    Consider the overall feature context:
    ${githubContent}`,
    },
    )

    const filesMatch = implementationPlan.match(/<files>([\s\S]*?)<\/files>/)
    const files = filesMatch ? filesMatch[1].trim() : ''

    await step.run('create-commit', async () => {
      await createCommitFromDiff({
        owner: 'productstudioinc',
        repo: availableName,
        diff: files,
        message: `feat: ${event.data.description}`,
      })
    })

    await step.run('update-project-status', async () => {
      await updateProjectStatus({
        projectId: project.id,
        status: 'creating',
        message: 'Repository setup complete',
      })
    })

    await step.run('check-domain-status', async () => {
      const isVerified = await checkDomainStatus(
        vercelProject.projectId,
        availableName,
      )
      if (!isVerified) {
        throw new Error('Domain verification failed')
      }
    })

    // should add the deployment status check and recommits here but this new git commit system seems to be a lot more reliable
    await step.sleep('wait-for-deployment', 30000)

    // await step.run('capture-screenshot', async () => {
    //   const screenshotUrl = await captureAndStoreMobileScreenshot(
    //     project.id,
    //     event.data.userId,
    //     `https://${availableName}.usewisp.app`,
    //   )

    //   await updateMobileScreenshot(project.id, screenshotUrl)
    // })

    await step.run('update-project-status', async () => {
      await updateProjectStatus({
        projectId: project.id,
        status: 'deployed',
        message: 'Project successfully deployed',
      })
    })
  },
)

export const updateProject = inngest.createFunction(
  {
    id: 'update-project',
  },
  { event: 'project/update' },
  async ({ event, step }) => {
    await checkIfUserExists(event.data.userId)

    const project = await step.run('check-project-ownership', async () => {
      const project = await getProject(event.data.id)
      if (!project || project.userId !== event.data.userId) {
        throw new Error('Project not found or user does not have permission')
      }
      return project
    })

    await step.run('update-project-status', async () => {
      await updateProjectStatus({
        projectId: project.id,
        status: 'deploying',
        message: 'Starting project update',
      })
    })

    const githubContent = await step.run('get-github-content', async () => {
      const repoUrl = `https://github.com/productstudioinc/${project.name}`
      return await getTrimmedContent(repoUrl)
    })

    const { text: implementationPlan } = await step.ai.wrap('generate-implementation-plan', generateText, {
      model: anthropic('claude-3-5-sonnet-latest'),
      system: `You are Wisp, an AI assistant that is an expert at React, Vite, Shadcn, and PWAs.
Your task is to implement user-requested apps based on our template repository:
${githubContent}

Template Structure:
- index.html
- vite.config.ts
- src/App.tsx
- src/index.css

Available ShadCN Components:
- accordion.tsx
- button.tsx
- card.tsx
- checkbox.tsx
- dropdown-menu.tsx
- input.tsx
- label.tsx
- radio-group.tsx
- scroll-area.tsx
- select.tsx
- sonner.tsx
- tabs.tsx
- textarea.tsx
- theme-provider.tsx

Implementation Requirements:

1. File-Specific Rules:
   index.html:
   - ONLY modify title and meta tags in <head>
   
   vite.config.ts:
   - ONLY modify the manifest section
   - DO NOT modify the head section
   
   App.tsx:
   - MUST keep imports: 
     import { RootLayout } from './components/root-layout'
     import { toast } from 'sonner'
   - ONLY modify content within <RootLayout> where "Place app content here" is marked
   - MUST export App as default component

2. Styling Guidelines:
   - Use Tailwind throughout
   - Mobile-first design approach
   - Maintain existing Tailwind classes and variables
   - Can add new styles but cannot remove existing ones

3. Implementation Best Practices:
   - Use localStorage for data persistence
   - Ensure type safety (ignore common TypeScript errors like 'Type 'Timeout' is not assignable to type 'number'')
   - Create comprehensive, production-ready features

Output Format:
<think>
[Your implementation reasoning]
</think>

<files>
<index.html>
[Complete index.html content]
</index.html>

<vite.config.ts>
[Complete vite.config.ts content]
</vite.config.ts>

<src/App.tsx>
[Complete App.tsx content]
</src/App.tsx>
</files>`,
      prompt: `Analyze this feature request and create an implementation plan based on the existing repository content:
    ${event.data.description}

    Consider the overall feature context:
    ${githubContent}`,
    },
    )

    const filesMatch = implementationPlan.match(/<files>([\s\S]*?)<\/files>/)
    const files = filesMatch ? filesMatch[1].trim() : ''

    await step.run('create-commit', async () => {
      await createCommitFromDiff({
        owner: 'productstudioinc',
        repo: project.name,
        diff: files,
        message: `feat: ${event.data.description}`,
      })
    })

    await step.sleep('wait-for-deployment', 30000)

    await step.run('capture-screenshot', async () => {
      const screenshotUrl = await captureAndStoreMobileScreenshot(
        project.id,
        event.data.userId,
        `https://${project.name}.usewisp.app`,
      )

      await updateMobileScreenshot(project.id, screenshotUrl)
    })

    await step.run('update-project-status', async () => {
      await updateProjectStatus({
        projectId: project.id,
        status: 'deployed',
        message: 'Project successfully updated',
      })
    })
  },
)

export const deleteProject = inngest.createFunction(
  {
    id: 'delete-project',
  },
  { event: 'project/delete' },
  async ({ event, step }) => {
    await checkIfUserExists(event.data.userId)

    const project = await step.run('check-project-ownership', async () => {
      const project = await getProject(event.data.id)
      if (!project || project.userId !== event.data.userId) {
        throw new Error('Project not found or user does not have permission')
      }
      return project
    })

    await step.run('update-project-status', async () => {
      await updateProjectStatus({
        projectId: project.id,
        status: 'deploying',
        message: 'Starting project deletion',
      })
    })

    await step.run('delete-vercel-project', async () => {
      await vercel.projects.deleteProject({
        teamId: 'product-studio',
        idOrName: project.vercelProjectId,
      })
    })

    await step.run('delete-github-repo', async () => {
      await octokit.rest.repos.delete({
        owner: 'productstudioinc',
        repo: project.name,
      })
    })

    if (project.dnsRecordId) {
      await step.run('delete-dns-record', async () => {
        await cloudflareClient.delete(
          `/zones/${process.env.CLOUDFLARE_ZONE_ID}/dns_records/${project.dnsRecordId}`,
          {
            headers: {
              'X-Auth-Email': process.env.CLOUDFLARE_EMAIL as string,
              'X-Auth-Key': process.env.CLOUDFLARE_API_KEY as string,
            },
          },
        )
      })
    }

    await step.run('update-project-status', async () => {
      await updateProjectStatus({
        projectId: project.id,
        status: 'deleted',
        message: 'Project successfully deleted',
      })
    })
  },
)
