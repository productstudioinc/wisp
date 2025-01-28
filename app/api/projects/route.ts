import { inngest } from "@/lib/inngest/client"
import { z } from "zod"
import { zfd } from "zod-form-data"

const projectSchema = zfd.formData({
  name: zfd.text(),
  description: zfd.text(),
  userId: zfd.text(),
  additionalInfo: zfd.text(z.string().optional()),
  private: zfd.checkbox(),
  icon: zfd.file(z.instanceof(File).optional()),
  images: zfd.repeatableOfType(zfd.file())
})

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const result = projectSchema.parse(formData)

    await inngest.send({
      name: "project/create",
      data: {
        name: result.name,
        description: result.description,
        userId: result.userId,
        additionalInfo: result.additionalInfo,
        private: result.private,
        ...(result.icon && { icon: new Blob([result.icon]) }),
        ...(result.images.length > 0 && {
          images: result.images.map(img => new Blob([img]))
        })
      }
    })

    return new Response(null, { status: 200 })
  } catch (error) {
    console.error('Error creating project:', error)
    return Response.json(
      { error: error instanceof z.ZodError ? error.errors : "Failed to create project" },
      { status: 400 }
    )
  }
}