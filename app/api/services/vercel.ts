import { Vercel } from '@vercel/sdk'

const vercel = new Vercel({
  bearerToken: process.env.VERCEL_BEARER_TOKEN
})

export async function setupVercelProject(repoName: string) {
  try {
    const createResponse = await vercel.projects.createProject({
      teamId: 'product-studio',
      requestBody: {
        name: repoName,
        framework: 'vite',
        gitRepository: {
          repo: `productstudioinc/${repoName}`,
          type: 'github'
        }
      }
    })

    return {
      projectId: createResponse.id,
      deploymentUrl: `https://${repoName}.vercel.app`
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}


export async function addDomainToProject(projectId: string, domainPrefix: string) {
  try {
    const result = await vercel.projects.addProjectDomain({
      idOrName: projectId,
      teamId: 'product-studio',
      requestBody: {
        name: `${domainPrefix}.usewisp.app`,
      }
    })
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}

export async function checkDomainStatus(projectId: string, domainPrefix: string) {
  try {
    const result = await vercel.projects.verifyProjectDomain({
      idOrName: projectId,
      teamId: 'product-studio',
      domain: `${domainPrefix}.usewisp.app`,
    })

    return result.verified
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}

export async function deleteProject(projectId: string) {
  try {
    await vercel.projects.deleteProject({
      idOrName: projectId,
      teamId: 'product-studio',
    })
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}