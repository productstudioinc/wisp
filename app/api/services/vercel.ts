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

export async function checkDeploymentStatus(projectId: string) {
  try {
    const deployment = await vercel.deployments.getDeployments({
      projectId: projectId,
      teamId: 'product-studio',
      limit: 1,
    })

    const deploymentLogs = await vercel.deployments.getDeploymentEvents({
      idOrUrl: deployment.deployments[0].url,
      teamId: 'product-studio',
      direction: 'backward',
      limit: 5
    })

    console.log(deploymentLogs)

    return {
      state: deployment.deployments[0].readyState,
      logs: deploymentLogs
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}