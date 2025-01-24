import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { HTTPMethods } from '@upstash/qstash'
import { WorkflowAbort, type WorkflowContext } from '@upstash/workflow'

export const createWorkflowOpenAI = (context: WorkflowContext) => {
	return createOpenAI({
		compatibility: 'strict',
		fetch: async (input, init) => {
			try {
				// Prepare headers from init.headers
				const headers = init?.headers
					? Object.fromEntries(new Headers(init.headers).entries())
					: {}

				// Prepare body from init.body
				const body = init?.body ? JSON.parse(init.body as string) : undefined

				// Make network call
				const responseInfo = await context.call('openai-call-step', {
					url: input.toString(),
					method: init?.method as HTTPMethods,
					headers,
					body,
				})

				// Construct headers for the response
				const responseHeaders = new Headers(
					Object.entries(responseInfo.header).reduce(
						(acc, [key, values]) => {
							acc[key] = values.join(', ')
							return acc
						},
						{} as Record<string, string>,
					),
				)

				// Return the constructed response
				return new Response(JSON.stringify(responseInfo.body), {
					status: responseInfo.status,
					headers: responseHeaders,
				})
			} catch (error) {
				if (error instanceof WorkflowAbort) {
					throw error
				}
				console.error('Error in fetch implementation:', error)
				throw error // Rethrow error for further handling
			}
		},
	})
}

export const createWorkflowAnthropic = (context: WorkflowContext) => {
	return createAnthropic({
		fetch: async (input, init) => {
			try {
				// Prepare headers from init.headers
				const headers = init?.headers
					? Object.fromEntries(new Headers(init.headers).entries())
					: {}

				// Prepare body from init.body
				const body = init?.body ? JSON.parse(init.body as string) : undefined

				// Make network call
				const responseInfo = await context.call('anthropic-call-step', {
					url: input.toString(),
					method: init?.method as HTTPMethods,
					headers,
					body,
				})

				// Construct headers for the response
				const responseHeaders = new Headers(
					Object.entries(responseInfo.header).reduce(
						(acc, [key, values]) => {
							acc[key] = values.join(', ')
							return acc
						},
						{} as Record<string, string>,
					),
				)

				// Return the constructed response
				return new Response(JSON.stringify(responseInfo.body), {
					status: responseInfo.status,
					headers: responseHeaders,
				})
			} catch (error) {
				if (error instanceof WorkflowAbort) {
					throw error
				}
				console.error('Error in fetch implementation:', error)
				throw error // Rethrow error for further handling
			}
		},
	})
}
