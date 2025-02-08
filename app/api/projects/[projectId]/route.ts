import { inngest } from "@/lib/inngest/client"
import { getProject } from "@/lib/db/queries"
import { z } from "zod"
import { zfd } from "zod-form-data"

const updateProjectSchema = zfd.formData({
  description: zfd.text(),
})

export async function PUT(
  request: Request,
  { params }: { params: { projectId: string } }
) {
  try {
    const project = await getProject(params.projectId)
    if (!project) {
      return Response.json(
        { error: "Project not found" },
        { status: 404 }
      )
    }

    const formData = await request.formData()
    const result = updateProjectSchema.parse(formData)

    await inngest.send({
      name: "project/update",
      data: {
        id: params.projectId,
        name: project.name,
        description: result.description,
        userId: project.userId,
      }
    })

    return new Response(null, { status: 200 })
  } catch (error) {
    console.error('Error updating project:', error)
    return Response.json(
      { error: error instanceof z.ZodError ? error.errors : "Failed to update project" },
      { status: 400 }
    )
  }
} 