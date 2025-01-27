import { checkIfUserExists, createProjectInDatabase, findAvailableProjectName } from "@/app/api/services/db/queries";
import { inngest } from "./client";
import { APICallError, generateObject, generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { NonRetriableError, RetryAfterError } from "inngest";
import octokit from "../services/github";
import { vercel } from "@/app/api/services/vercel";
import { cloudflareClient } from "@/app/api/services/cloudflare";
import { getContent } from "@/app/api/services/github";
import { fileChangeSchema, implementationSystemPrompt } from "@/app/api/services/ai";

export const createProject = inngest.createFunction(
  { id: "create-project" },
  { event: "project/create" },
  async ({ event, step }) => {
    await checkIfUserExists(event.data.userId)

    const formattedName = event.data.name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const availableName = await step.run("find-available-name", async () => {
      const availableName = await findAvailableProjectName(formattedName)
      return availableName
    })

    let questionsContext = ''
    if (event.data.questions) {
      try {
        const questions = JSON.parse(event.data.questions)
        questionsContext = `\n\nAdditional context from questions:\n${Object.entries(questions)
          .map(([question, answer]) => `${question}: ${answer}`)
          .join('\n')
          }`
      } catch (e) {
        console.error('Failed to parse questions:', e)
      }
    }

    const { text } = await step.ai.wrap("generate-description", generateText, {
      model: anthropic('claude-3-5-sonnet-latest'),
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

      Response format: Just return the concise description, nothing else.`
    }).catch((error) => {
      if (APICallError.isInstance(error) && error.responseHeaders) {
        const rateLimitReset = error.responseHeaders['anthropic-ratelimit-tokens-reset']
        if (rateLimitReset) {
          const resetTime = new Date(Number.parseInt(rateLimitReset) * 1000)
          throw new RetryAfterError(
            "Hit Anthropic rate limit",
            resetTime
          )
        }
      }
      throw error
    })

    await step.sleep('wait-for-template-creation', 3000)

    const vercelProject = await step.run("setup-vercel-project", async () => {
      const createResponse = await vercel.projects.createProject({
        teamId: 'product-studio',
        requestBody: {
          name: availableName,
          framework: 'vite',
          gitRepository: {
            repo: `productstudioinc/${availableName}`,
            type: 'github'
          }
        }
      })

      return {
        projectId: createResponse.id,
        deploymentUrl: `https://${availableName}.vercel.app`
      }
    })

    await step.run("add-domain-to-project", async () => {
      await vercel.projects.addProjectDomain({
        idOrName: vercelProject.projectId,
        teamId: 'product-studio',
        requestBody: {
          name: `${availableName}.usewisp.app`
        }
      })
    })

    const dnsRecord = await step.run("create-dns-record", async () => {
      const result = await cloudflareClient.dns.records.create({
        type: 'CNAME',
        name: availableName,
        zone_id: process.env.CLOUDFLARE_ZONE_ID as string,
        proxied: false,
        content: 'cname.vercel-dns.com.'
      })

      return result.id
    })

    const githubContent = await step.run("get-github-content", async () => {
      const repoContent = await getContent(`https://github.com/productstudioinc/${availableName}`)

      return repoContent
    })

    const { text: plan } = await step.ai.wrap("generate-code-plan", generateText, {
      model: anthropic('claude-3-5-sonnet-latest'),
      prompt: `You are wisp, an expert AI assistant and exceptional senior software developer with vast knowledge in React, Vite, and Progressive Web Apps (PWAs). Your goal is to develop an interactive, fun, and fully functional PWA based on a user's prompt. You excel in mobile-first design and creative CSS implementations.

        First, review the content of the template repository:

        <repository_content>
        ${githubContent}
        </repository_content>

        Now, consider the user's app idea:

        <user_app_idea>
        ${prompt}
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
    })

    const { object: implementation } = await step.ai.wrap("generate-code-changes", generateObject, {
      model: anthropic('claude-3-5-sonnet-latest'),
      prompt: `Using this implementation plan:\n\n${plan}\n\nAnd this repository content:\n\n${githubContent}\n\nGenerate the specific code changes needed to implement this app. You must give the FULL file content, not just the changes.`,
      system: implementationSystemPrompt(),
      schema: fileChangeSchema
    })

  })
