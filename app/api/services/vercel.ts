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


    if (!deployment.deployments.length) {
      return { state: 'NO_DEPLOYMENTS' }
    }

    const state = deployment.deployments[0].readyState

    if (state === 'ERROR') {
      const deploymentUrl = deployment.deployments[0].url
      await new Promise(resolve => setTimeout(resolve, 3000))
      const response = await fetch(
        `https://api.vercel.com/v3/deployments/${deploymentUrl}/events?builds=1&direction=backward&follow=0&limit=20`,
        {
          headers: {
            Authorization: `Bearer ${process.env.VERCEL_BEARER_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      )

      const deploymentLogs = (await response.json()) as Array<{
        text: string;
        type: string;
        created: number;
        date: number;
        deploymentId: string;
        id: string;
        serial: string;
        info: {
          type: string;
          name: string;
          entrypoint: string;
        };
        level?: 'error';
      }>

      const formattedLogs = deploymentLogs
        .reverse()
        .filter(log => log.level === 'error')
        .map(log => log.text)
        .filter(text => text)

      return { state, logs: formattedLogs }
    }

    return { state }
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}