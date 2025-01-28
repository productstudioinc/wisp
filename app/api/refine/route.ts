import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

export async function POST(request: Request) {
  const body = await request.json();

  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: z.object({
      questions: z.string().array(),
      imageSuggestions: z.string(),
    }),
    prompt: `You are an AI assistant specialized in product development, particularly in helping users generate ideas for personalized apps. Your task is to analyze an app concept and provide tailored questions and image suggestions to help refine the app idea.

Here's the app concept you need to work with:

App Name: ${body.name}
App Description: ${body.description}

Your goal is to generate:
1. A list of 3-5 questions that will help personalize the app that are concise and not overly specific.
2. A single string of suggestions for images that users could provide to enhance the app's development.

Before providing your final output, in <app_analysis> tags:

1. Break down the app concept into key features and potential target audience.
2. Brainstorm a list of 8-10 potential questions related to personalizing the app.
3. Narrow down the list to the 3-5 most effective questions that are tailored but not overly specific.
4. Consider different aspects of the app that could benefit from visual elements and list potential image categories.

Make sure to focus on creating questions that are tailored towards creating a personalized app without being so specific that they limit the app's potential.

<app_analysis>
[Your analysis of the app concept, breakdown of features, target audience, question brainstorming, question selection, and image suggestion consideration goes here.]
</app_analysis>

After your analysis, please provide your final output in the following format:

<output>
Questions:
1. [Question 1]
2. [Question 2]
3. [Question 3]
(Add more if necessary, up to 5 questions)

Image Suggestions: [A single string of suggestions for types of images to upload]
</output>

Remember, the questions should be designed to gather information that will help personalize the app without being so specific that they limit the app's potential or make it impossible to generate. The image suggestions should be general enough to apply to various users while still being relevant to the app concept.`,
  })

  return Response.json(object)
}