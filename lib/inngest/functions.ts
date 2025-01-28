import {
	checkIfUserExists,
	createProjectInDatabase,
	findAvailableProjectName,
	updateProjectStatus,
} from '@/app/api/services/db/queries'
import { inngest } from './client'
import {
	APICallError,
	CoreTool,
	generateObject,
	generateText,
	StepResult,
	tool,
} from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { NonRetriableError, RetryAfterError } from 'inngest'
import { openai } from '@ai-sdk/openai'
import octokit from '../services/github'
import { checkDomainStatus, vercel } from '@/app/api/services/vercel'
import { cloudflareClient } from '@/app/api/services/cloudflare'
import {
	createCommitWithFiles,
	createFromTemplate,
	getContent,
} from '@/app/api/services/github'
import {
	fileChangeSchema,
	implementationSystemPrompt,
} from '@/app/api/services/ai'
import { openai as vercelOpenAI } from '@ai-sdk/openai'
import type { z } from 'zod'
import { groq } from '@ai-sdk/groq'

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

		const { steps } = (await step.ai.wrap(
			'generate-code-changes',
			generateText,
			{
				model: anthropic('claude-3-5-sonnet-latest'),
				prompt: `Based on the implementation plan and repository content, generate the necessary file changes to implement the PWA. I'll provide an example of the expected output format:

Implementation plan:
${implementationPlan}

Repository content:
${githubContent}

Follow these requirements exactly:
1. Keep all components in App.tsx
2. Maintain PWA and Toaster logic
3. Use mobile-first design with Tailwind
4. Ensure type safety
5. Use only existing dependencies
6. Include complete file contents
7. Follow the example format precisely
MAKE SURE to keep all the original tailwind variables and classes in the src/index.css file. You can modify them but do NOT remove them.

Generate your implementation now, following the exact structure shown in the example.`,
				system: implementationSystemPrompt(),
				tools: {
					generateImplementationObject: tool({
						description:
							'A JSON representation of the file changes needed to implement the app.',
						parameters: fileChangeSchema,
					}),
				},
				maxSteps: 2,
				experimental_activeTools: ['generateImplementationObject'],
			},
		)) as unknown as {
			steps: Array<StepResult<Record<string, CoreTool>>>
		}

		const implementationObject = steps[0].toolCalls[0].args as z.infer<
			typeof fileChangeSchema
		>

		console.log(implementationObject)

		const patchFiles = implementationObject.changes.map((change) => ({
			path: change.path,
			content: change.content,
		}))

		await step.run('create-commit', async () => {
			await createCommitWithFiles(
				octokit,
				'productstudioinc',
				availableName,
				'main',
				patchFiles,
				`feat: ${event.data.description}`,
			)
		})

		await step.run('update-project-status', async () => {
			await updateProjectStatus({
				projectId: project.id,
				status: 'creating',
				message: 'Repository setup complete',
			})
		})

		return

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
	},
)
