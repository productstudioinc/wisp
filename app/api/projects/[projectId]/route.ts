import { inngest } from "@/lib/inngest/client"
import { getProject } from "@/lib/db/queries"
import { z } from "zod"
import { zfd } from "zod-form-data"

const updateProjectSchema = zfd.formData({
  description: zfd.text(),
})

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params
    const project = await getProject(projectId)
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
        id: projectId,
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params
    const project = await getProject(projectId)
    if (!project) {
      return Response.json(
        { error: "Project not found" },
        { status: 404 }
      )
    }

    await inngest.send({
      name: "project/delete",
      data: {
        id: projectId,
        userId: project.userId,
      }
    })

    return new Response(null, { status: 200 })
  } catch (error) {
    console.error('Error deleting project:', error)
    return Response.json(
      { error: "Failed to delete project" },
      { status: 400 }
    )
  }
} 