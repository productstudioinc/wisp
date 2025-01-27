import { checkIfUserExists, createProjectInDatabase, findAvailableProjectName } from "@/app/api/services/db/queries";
import { inngest } from "./client";
import { APICallError, generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { NonRetriableError, RetryAfterError } from "inngest";
import octokit from "../services/github";
import { vercel } from "@/app/api/services/vercel";
import { cloudflareClient } from "@/app/api/services/cloudflare";

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




  })
