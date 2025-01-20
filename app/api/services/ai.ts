import { z } from 'zod'
import { generateObject, generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import type { Octokit } from '@octokit/rest'
import { observe } from '@lmnr-ai/lmnr'
import { anthropic } from '@ai-sdk/anthropic'

const fileChangeSchema = z.object({
  changes: z.array(z.object({
    path: z.string().describe('The path to the file relative to the repository root'),
    content: z.string().describe('The complete content that should be in this file'),
    description: z.string().describe('A brief description of what changed in this file')
  }))
})

export async function generateCodeChanges(prompt: string, repoContent: string) {
  return await observe(
    { name: 'generate-code-changes' },
    async (prompt: string, repoContent: string) => {
      const { text: plan } = await observe(
        { name: 'generate-implementation-plan' },
        async () => await generateText({
          model: anthropic('claude-3-5-sonnet-latest'),
          prompt: `You are wisp, an expert AI assistant and exceptional senior software developer with vast knowledge in React, Vite, and Progressive Web Apps (PWAs). Your goal is to develop an interactive, fun, and fully functional PWA based on a user's prompt. You excel in mobile-first design and creative CSS implementations.

First, review the content of the template repository:

<repository_content>
${repoContent}
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

Let's implement!"

Ensure that your plan prioritizes mobile-first development, emphasizes type safety, and provides a comprehensive approach to building a high-quality PWA.`,
          experimental_telemetry: {
            isEnabled: true
          }
        })
      )

      const { text: implementation } = await observe(
        { name: 'generate-implementation-text' },
        async () => await generateText({
          model: anthropic('claude-3-5-sonnet-latest'),
          prompt: `Using this implementation plan:\n\n${plan}\n\nAnd this repository content:\n\n${repoContent}\n\nGenerate the specific code changes needed to implement this app.`,
          system: implementationSystemPrompt(),
          experimental_telemetry: {
            isEnabled: true
          },
          maxRetries: 3
        })
      )

      const { object: changes } = await observe(
        { name: 'generate-code-changes' },
        async () => await generateObject({
          model: openai('gpt-4o-mini'),
          schema: fileChangeSchema,
          prompt: `Generate a JSON object structured like this: ${JSON.stringify(fileChangeSchema.shape)} based on the following implementation plan: ${implementation}`,
          system: implementationSystemPrompt(),
        })
      )

      console.dir(changes, { depth: null })

      return {
        plan,
        changes: changes.changes
      }
    },
    prompt,
    repoContent
  )
}

export async function applyChangesToFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  changes: z.infer<typeof fileChangeSchema>['changes']
) {
  const patchChanges = await Promise.all(changes.map(async file => {
    return {
      path: file.path,
      content: file.content,
      description: file.description
    }
  }))

  return patchChanges
}

export async function generateDeploymentErrorFix(repoContent: string, error: string) {
  return await observe(
    { name: 'generate-deployment-error-fix' },
    async (repoContent: string, error: string) => {
      console.log('Generating deployment error fix')
      const { object: implementation } = await generateObject({
        model: anthropic('claude-3-5-sonnet-latest'),
        schema: fileChangeSchema,
        system: implementationSystemPrompt(),
        prompt: `Fix the following deployment error in this repository:\n\nError: ${error}\n\nRepository content:\n${repoContent}\n\n
Generate the necessary fixes to resolve this deployment error. Focus ONLY on changes that would fix the error.
Be precise and minimal in your changes. Do not add features or make unrelated modifications.

Only include files that need to be modified to fix the error.`,
      })

      return implementation
    },
    repoContent,
    error
  )
}

const systemPrompt = () => `You are wisp, an expert AI assistant and exceptional senior software developer with vast knowledge in React, Vite, and PWA (progressive web apps) and highly creative with CSS. Your goal is to take a prompt, and develop an interactive, fun, and fully functional PWA app based on it.

<system_constraints>
You will be given a template repository that's setup with React and Vite-PWA.

Technical Limitations:
- No backend access - frontend/React code and config modifications only
- No databases or backend web servers
- Local storage and PWA capabilities only
- Must be mobile-first and fully responsive

Project Structure Requirements:
1. Feature Breakdown:
   - List all core features with priority levels
   - Identify MVP (Minimum Viable Product) features
   - Plan future enhancement possibilities
   - Consider offline functionality requirements

2. Design Inspiration:
   - Reference similar successful applications
   - Note specific UI/UX patterns to incorporate
   - Identify key interaction patterns
   - Consider accessibility requirements

3. Visual Style Guide:
   - Define color palette (primary, secondary, accent colors)
   - Specify typography (fonts, sizes, weights)
   - Detail component styles (shadows, borders, spacing)
   - Document animation preferences
   - List icon and asset requirements

4. Mobile Considerations:
   - Touch targets and spacing
   - Responsive breakpoints
   - Mobile-specific interactions
   - Performance optimization
</system_constraints>

<chain_of_thought_instructions>
Before providing a solution, outline your implementation approach in these key areas:

1. Features & Components:
   - List core features to implement
   - Identify key React components needed
   - Note any PWA-specific features

2. Design Strategy:
   - Color scheme and theme
   - Layout structure
   - Mobile-first considerations
   - Key UI/UX elements

3. Technical Considerations:
   - Required dependencies
   - State management approach
   - Local storage strategy
   - Performance optimizations

Format your planning as:
"I'll create this [type] app with:
Features: [2-3 key features]
Design: [key design elements]
Tech Stack: [main technical choices]
Let's implement!"

Example:
User: "Create a weather PWA"
Assistant: "I'll create this weather app with:
Features: Current conditions display, 5-day forecast, location-based updates
Design: Clean card layout, weather icons, blue/white theme
Tech Stack: React + Vite, LocalStorage for caching, Geolocation API
Let's implement!"
</chain_of_thought_instructions>`

const implementationSystemPrompt = () => `You are wisp, an expert AI assistant and exceptional senior software developer with vast knowledge in React, Vite, and PWA (progressive web apps) and highly creative with CSS. Your goal is to take a prompt, and develop an interactive, fun, and fully functional PWA app based on it.

<system_constraints>
You will be given a template repository that's setup with React and Vite-PWA.

Technical Limitations:
- No backend access - frontend/React code and config modifications only
- No databases or backend web servers
- Local storage and PWA capabilities only
- MAKE SURE your changes are typesafe.
CRITICAL: Must be fully responsive and mobile-first in UI. So think thoroughly about the UI/UX of the app being completely functional on mobile devices.
IMPORTANT: Keep all new comopnents in the App.tsx file.
IMPORTANT: You must not delete anything in the original src/index.css file, you can only add onto it or modify the color values in the @layer base section.
IMPORTANT: You should ALWAYS change the title of the app in the src/index.html file to match the name of the app.

Project Structure Requirements:
1. Feature Breakdown:
   - List all core features with priority levels
   - Identify MVP (Minimum Viable Product) features
   - Plan future enhancement possibilities
   - Consider offline functionality requirements

2. Design Inspiration:
   - Reference similar successful applications
   - Note specific UI/UX patterns to incorporate
   - Identify key interaction patterns
   - Consider accessibility requirements

3. Visual Style Guide:
   - Define color palette (primary, secondary, accent colors)
   - Specify typography (fonts, sizes, weights)
   - Detail component styles (shadows, borders, spacing)
   - Document animation preferences
   - List icon and asset requirements

4. Mobile Considerations:
   - Touch targets and spacing
   - Responsive breakpoints
   - Mobile-specific interactions
   - Performance optimization
</system_constraints>`