import {
  checkIfUserExists,
  createProjectInDatabase,
  findAvailableProjectName,
  updateMobileScreenshot,
  updateProjectStatus,
} from '@/app/api/services/db/queries'
import { inngest } from './client'
import {
  APICallError,
  generateText,
} from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { RetryAfterError } from 'inngest'
import octokit, { createCommitFromDiff } from '../services/github'
import { checkDomainStatus, vercel } from '@/app/api/services/vercel'
import { cloudflareClient } from '@/app/api/services/cloudflare'
import { getContent } from '@/app/api/services/github'
import { groq } from '@ai-sdk/groq'
import { parsePatch, applyPatch } from 'diff'
import { captureAndStoreMobileScreenshot } from '@/app/api/services/screenshot'

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

    const project = await step.run('create-project-in-database', async () => {
      return await createProjectInDatabase({
        userId: event.data.userId,
        name: availableName,
        description: event.data.description,
        displayName: event.data.name,
        projectId: '',
        private: event.data.private,
      })
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

    const { text } = await step.ai
      .wrap('generate-description', generateText, {
        model: groq('llama3-8b-8192'),
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

    const githubContent = await step.run('get-github-content', async () => {
      return await getContent(repoUrl)
    })

    const { text: implementationPlan } = await step.ai.wrap(
      'generate-code-plan',
      generateText,
      {
        model: anthropic('claude-3-5-sonnet-latest'),
        prompt: `You are wisp, an expert AI assistant and exceptional senior software developer with vast knowledge in React, Vite, and Progressive Web Apps (PWAs). Your goal is to develop an interactive, fun, and fully functional PWA based on a user's prompt. You excel in mobile-first design and creative CSS implementations.

        First, review the content of the template repository:

        <repository_content>
        ${githubContent}
        </repository_content>

        Now, consider the user's app idea:

        <user_app_idea>
        ${event.data.description}
        </user_app_idea>

        Before providing your implementation plan, wrap your analysis inside <analysis> tags, considering the following key areas:

        1. Features & Components:
          - List core features to implement (minimum 5)
          - Prioritize features based on user needs and PWA best practices
          - Identify key React components needed (minimum 3)
          - Note PWA-specific features (minimum 2)

        2. Design Strategy:
          - Propose a color scheme and theme
          - Outline the layout structure
          - Detail mobile-first considerations
          - Describe key UI/UX elements
          - Brainstorm creative UI/UX ideas specific to the app concept

        3. Technical Considerations:
          - List required dependencies
          - Explain your state management approach
          - Detail your local storage strategy
          - Describe performance optimizations
          - Outline your approach to ensuring type safety

        4. Mobile-First PWA Development:
          - Describe touch-friendly interface elements
          - Explain responsive design strategies
          - Detail offline functionality
          - Outline PWA-specific optimizations

        5. Challenges and Solutions:
          - Identify potential technical or design challenges
          - Propose solutions or mitigation strategies for each challenge

        After your thorough analysis, provide a detailed implementation plan using the following format:

        "I'll create this [type] PWA with:

        Features:
        1. [Feature 1]
        2. [Feature 2]
        3. [Feature 3]
        4. [Feature 4]
        5. [Feature 5]

        Design:
        - Color Scheme: [color palette]
        - Layout: [layout description]
        - Mobile-First Elements: [key mobile design considerations]
        - UI/UX Highlights: [notable UI/UX features]

        Tech Stack:
        - Framework: React + Vite
        - State Management: [chosen approach]
        - Data Persistence: [storage strategy]
        - Performance Optimizations: [key optimizations]
        - Type Safety Measures: [approach to ensure type safety]

        Mobile PWA Enhancements:
        - Touch Interface: [touch-friendly features]
        - Responsive Design: [responsive strategies]
        - Offline Capabilities: [offline functionality]
        - PWA Optimizations: [PWA-specific enhancements]

        Implementation Steps:
        1. [Step 1]
        2. [Step 2]
        3. [Step 3]
        ...

        Let's implement!
      `,
      },
    )

    const { text: gnuDiff } = (await step.ai.wrap(
      'generate-code-changes',
      generateText,
      {
        model: anthropic('claude-3-5-sonnet-latest'),
        prompt: `Based on the implementation plan and repository content, generate a GNU diff that will implement these changes.

<implementation_plan>
${implementationPlan}
</implementation_plan>

<repository_content>
${githubContent.replace(/^---/gm, '###')}
</repository_content>

Requirements:
1. Keep all components in App.tsx
2. Keep the PWA logic in the App.tsx
3. Use mobile-first design with Tailwind
4. Ensure type safety
5. Use only existing dependencies
6. Include complete file contents
7. Keep all original tailwind variables and classes in src/index.css

CRITICAL: You MUST keep the isPWA and Toaster logic in the App.tsx

When generating diffs for React components:
1. Always include the full JSX context (parent elements)
2. Include proper indentation in the diff
3. Make sure opening and closing tags are in the same hunk
4. Include imports at the top of the file
5. Preserve existing component structure

You should ONLY respond with the diff, nothing else, in this format. Don't include any comments, newline markers, etc:

<gnu_diff>
diff --git a/src/App.tsx b/src/App.tsx
index 1234567..89abcdef 100644
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1,7 +1,8 @@
 import React from 'react'
 import { useState } from 'react'
+import { Tabs, TabsContent } from './components/ui/tabs'
 
-export function App() {
+export default function App() {
   return (
     <div className="container mx-auto p-4">
-      <h1>Hello World</h1>
+      <Tabs defaultValue="tab1">
+        <TabsContent value="tab1">
+          <h1>Hello World</h1>
+        </TabsContent>
+      </Tabs>
     </div>
   )
 }
</gnu_diff>

Important rules for valid GNU diffs:
1. Each file change must start with "diff --git a/path b/path"
2. Include the index line with hex hashes
3. Include --- and +++ lines with a/ and b/ prefixes
4. Each hunk must start with @@ and show correct line numbers
5. Use - for removals, + for additions, space for context
6. Include 3 lines of context around changes
7. Ensure proper indentation is preserved
8. Make sure all JSX tags are properly closed
9. Keep complete component structure intact
10. No trailing whitespace at end of lines`,
      },
    ))

    const diff = gnuDiff
      .split('<gnu_diff>')[1]
      ?.split('</gnu_diff>')[0]
      ?.trim() || ''

    await step.run('create-commit', async () => {
      await createCommitFromDiff({
        owner: 'productstudioinc',
        repo: availableName,
        diff,
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
      const isVerified = await checkDomainStatus(vercelProject.projectId, availableName)
      if (!isVerified) {
        throw new Error('Domain verification failed')
      }
    })

    // should add the deployment status check and recommits here but this new git commit system seems to be a lot more reliable
    await step.sleep('wait-for-deployment', 30000)

    await step.run('capture-screenshot', async () => {
      const screenshotUrl = await captureAndStoreMobileScreenshot(
        project.id,
        event.data.userId,
        `https://${availableName}.usewisp.app`,
      )

      await updateMobileScreenshot(project.id, screenshotUrl)
    })

    await step.run('update-project-status', async () => {
      await updateProjectStatus({
        projectId: project.id,
        status: 'deployed',
        message: 'Project successfully deployed',
      })
    })
  },
)
