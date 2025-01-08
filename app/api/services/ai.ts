import { z } from 'zod'
import { generateObject, generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import type { Octokit } from '@octokit/rest'
import { fetchFileContent } from './github'

const fileChangeSchema = z.object({
  changes: z.array(z.object({
    path: z.string().describe('The path to the file relative to the repository root'),
    changes: z.array(
      z.discriminatedUnion('type', [
        z.object({
          type: z.literal('add'),
          start: z.number().describe('The line number where to add the content (1-indexed)'),
          content: z.string().describe('The content to add')
        }),
        z.object({
          type: z.literal('remove'),
          start: z.number().describe('The line number where to start removing (1-indexed)'),
          end: z.number().describe('The line number where to end removing (inclusive)')
        }),
        z.object({
          type: z.literal('replace'),
          start: z.number().describe('The line number where to start replacing (1-indexed)'),
          end: z.number().describe('The line number where to end replacing (inclusive)'),
          content: z.string().describe('The new content to replace with')
        })
      ])
    ),
    description: z.string().describe('A brief description of what changed in this file')
  }))
})

export async function generateImplementationPlan(repoContent: string, prompt: string): Promise<string> {
  const { text: plan } = await generateText({
    model: openai('gpt-4o'),
    prompt: `Given this repository content:\n\n${repoContent}\n\nImplement the following feature: ${prompt}\n\nFirst, create a detailed plan for implementing this feature.`,
    system: `You are an expert react and pwa developer named Wisp

    Your job is to take a simple idea from a user and use that idea to create an app based on a template for a functional PWA app.

    The main files you should be editing are:

    pwa-assets.config.ts
    vite.config.ts for the app manifest

    And all the files under the src directory

    Before implementing, think thoroughly about the steps you need to take.

    Start by thinking of the styling - in the context of the prompt, how should the app look?

    Then think of the actual implementation. You can only make frontend/react changes since this is a vite app.

    Make sure everything is typesafe.

    You can NEVER install dependencies, you can only edit code`,
  })

  return plan
}

export async function generateCodeChanges(plan: string, repoContent: string) {
  const { object } = await generateObject({
    model: openai('gpt-4o'),
    schema: fileChangeSchema,
    prompt: `Using this implementation plan:\n\n${plan}\n\nAnd this repository content:\n\n${repoContent}\n\n
Generate the necessary file changes to implement this feature. For each file that needs to be modified or created:

1. For each change in a file, specify:
   - The type of change (add/remove/replace)
   - The line number where the change starts
   - For replace/remove: the line number where it ends
   - For add/replace: the new content to add

2. For new files:
   - Use a single 'add' change starting at line 1
   - Include the complete file content

3. For modifications:
   - Break down your changes into specific regions
   - Include enough context in the content
   - Use line numbers from the original file

Example of changes to an existing file:
{
  "path": "src/App.tsx",
  "changes": [
    {
      "type": "replace",
      "start": 5,
      "end": 7,
      "content": "function App() {\\n  const [count, setCount] = useState(0);\\n  return <div>{count}</div>;\\n}"
    },
    {
      "type": "add",
      "start": 3,
      "content": "import { useState } from 'react';\\n"
    }
  ],
  "description": "Added counter state to App component"
}

Example of a new file:
{
  "path": "src/styles.css",
  "changes": [
    {
      "type": "add",
      "start": 1,
      "content": ".container {\\n  display: flex;\\n  padding: 1rem;\\n}"
    }
  ],
  "description": "Created styles for container layout"
}

Only include files that need to be modified or created. Break down your changes into specific regions rather than rewriting entire files.`,
  })

  return object
}

export async function applyChangesToFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  changes: z.infer<typeof fileChangeSchema>['changes']
) {
  const patchChanges = await Promise.all(changes.map(async file => {
    let currentContent = ''
    try {
      const content = await fetchFileContent(octokit, owner, repo, file.path)
      currentContent = content
    } catch {
      currentContent = ''
    }

    let newContent = currentContent
    const lines = newContent.split('\n')

    const sortedChanges = [...file.changes].sort((a, b) => b.start - a.start)

    for (const change of sortedChanges) {
      if (change.type === 'add') {
        lines.splice(change.start - 1, 0, ...change.content.split('\n'))
      } else if (change.type === 'remove') {
        lines.splice(change.start - 1, change.end - change.start + 1)
      } else if (change.type === 'replace') {
        lines.splice(change.start - 1, change.end - change.start + 1, ...change.content.split('\n'))
      }
    }
    newContent = lines.join('\n')

    return {
      path: file.path,
      content: newContent,
      description: file.description
    }
  }))

  return patchChanges
}

export async function generateDeploymentErrorFix(repoContent: string, error: string) {
  const { object } = await generateObject({
    model: openai('gpt-4o'),
    schema: fileChangeSchema,
    prompt: `Fix the following deployment error in this repository:\n\nError: ${error}\n\nRepository content:\n${repoContent}\n\n
Generate the necessary fixes to resolve this deployment error. Focus ONLY on changes that would fix the error.
Be precise and minimal in your changes. Do not add features or make unrelated modifications.

Example of fixing a build error:
If the error is "Module not found: Can't resolve 'react'", you would fix the import statement or add the missing dependency.

Only include files that need to be modified to fix the error. Break down your changes into specific regions rather than rewriting entire files.`,
  })

  return object
} 