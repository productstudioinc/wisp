import { getContent, getTrimmedContent } from '@/lib/services/github';
import { anthropic } from '@ai-sdk/anthropic';
import { deepseek } from '@ai-sdk/deepseek';
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';


export async function GET(request: Request) {
  const featureRequest = 'Add a new feature to the project that allows users to add a new project.';
  const githubContent = await getTrimmedContent("https://github.com/productstudioinc/vite_react_shadcn_pwa")
  const { object: implementationPlan } = await generateObject({
    model: deepseek("deepseek-chat"),
    schema: z.object({
      files: z.array(
        z.object({
          purpose: z.string(),
          filePath: z.string(),
          changeType: z.enum(['create', 'modify', 'delete']),
        }),
      ),
    }),
    system:
      `You are Wisp, an AI assistant that is an expert at React, Vite, Shadcn, and PWAs.
      Your job is to plan the implementation of an app that will be requested by a user.
      This plan should go based off the following github template repository:
      ${githubContent}

      This has the following files:

      index.html
      vite.config.ts
      src/App.tsx
      src/index.css

      The user will provide an app request, and you will need to plan the implementation of that app.
      You will need to consider the overall context of the project when planning the implementation.

      You have rules that you must follow: 

      - Based on the feature request, edit the index.html head and the manifest section of vite.config.ts to reflect the new app being created.
      - Based on the feature request, edit the src/App.tsx file to reflect the new app being created.
      - In the App.tsx, you MUST use the RootLayout.tsx file and import as is - you can only add code inside of the <RootLayout> tag.
      - Based on the feature request, create a styling plan for the app. For all styling, you must keep the tailwind class name imports as well as the varaibles from the original repo. You can edit the colors of the variables or add onto, but not remove any existing tailwind classes.
      - You must use tailwind styling throughout the app.
      
      You will have access to the following ShadCN components:
      accordion.tsx
      button.tsx
      card.tsx
      checkbox.tsx
      dropdown-menu.tsx
      input.tsx
      label.tsx
      radio-group.tsx
      scroll-area.tsx
      select.tsx
      sonner.tsx
      tabs.tsx
      textarea.tsx
      theme-provider.tsx

      You can use these components to implement the feature, but you must follow the rules above.

      Your output will be a list of files that you will edit, and the changes you will make to each file.

      Example:
      {
        files: [
          {
            purpose: 'Add a new feature to the project that allows users to add a new project.',
            filePath: 'src/components/NewProjectForm.tsx',
            changeType: 'create',
          },
        ],
      }
      `,
    prompt: `Analyze this feature request and create an implementation plan:
    ${featureRequest}

    Consider the overall feature context:
    ${githubContent}`,
  });


  const fileChanges = [];
  for (const file of implementationPlan.files) {
    // Each worker is specialized for the type of change
    const workerSystemPrompt = {
      create:
        `You are an expert at implementing new files following best practices and project patterns.
          
          You have rules that you must follow:

          - You can only strictly edit the following files:
          The head of /index.html
          The manifest in vite.config.ts
          The tailwind styling in src/index.css (you MUST keep the tailwind class name imports as well as the varaibles from the original repo. You can edit the colors of the variables or add onto, but not remove any existing tailwind classes)
          The src/App.tsx file
          The src/components/ folder
          - When adding a feature, you should add it to the src/components/ folder.
          - You MUST keep the RootLayout.tsx file and import as is - you can only add code inside of the <RootLayout> tag.
          
          You will have access to the following ShadCN components:
          accordion.tsx
          button.tsx
          card.tsx
          checkbox.tsx
          dropdown-menu.tsx
          input.tsx
          label.tsx
          radio-group.tsx
          scroll-area.tsx
          select.tsx
          sonner.tsx
          tabs.tsx
          textarea.tsx
          theme-provider.tsx

          You should always use these components when implementing a feature, along with shadcn tailwind variables.

          Your response should be a very concise explanation along with a valid git diff of the changes you will make to the file.
          The diff MUST be in the following format:

          diff --git a/path/to/file b/path/to/file
          new file mode 100644
          --- /dev/null
          +++ b/path/to/file
          @@ -0,0 +1,N @@
          +added line 1
          +added line 2
          ...
          `,
      modify:
        `You are an expert at modifying existing code while maintaining consistency and avoiding regressions.
          
          You will be given a feature request, and you will need to modify the code in the file specified to support the feature.

          You have rules that you must follow:

          - You can only strictly edit the following files:
          The head of /index.html
          The manifest in vite.config.ts
          The tailwind styling in src/index.css (you MUST keep the tailwind class name imports as well as the varaibles from the original repo. You can edit the colors of the variables or add onto, but not remove any existing tailwind classes)
          The src/App.tsx file
          The src/components/ folder
          - When adding a feature, you should add it to the src/components/ folder.
          - You MUST keep the RootLayout.tsx file and import as is - you can only add code inside of the <RootLayout> tag.

          
          You will have access to the following ShadCN components:
          accordion.tsx
          button.tsx
          card.tsx
          checkbox.tsx
          dropdown-menu.tsx
          input.tsx
          label.tsx
          radio-group.tsx
          scroll-area.tsx
          select.tsx
          sonner.tsx
          tabs.tsx
          textarea.tsx
          theme-provider.tsx

          You should always use these components when implementing a feature, along with shadcn tailwind variables.

          Your response should be a very concise explanation along with a valid git diff of the changes you will make to the file.
          The diff MUST be in the following format:

          diff --git a/path/to/file b/path/to/file
          index 1234567..89abcdef 100644
          --- a/path/to/file
          +++ b/path/to/file
          @@ -1,3 +1,4 @@
            unchanged line
           -removed line
           +added line
            unchanged line
          `,
      delete:
        `You are an expert at safely removing code while ensuring no breaking changes.
          
          You will be given a feature request, and you will need to remove the code in the file specified that is no longer needed.

          You have rules that you must follow:

          - You can only strictly edit the following files:
          The head of /index.html
          The manifest in vite.config.ts
          The tailwind styling in src/index.css (you MUST keep the tailwind class name imports as well as the varaibles from the original repo. You can edit the colors of the variables or add onto, but not remove any existing tailwind classes)
          The src/App.tsx file
          The src/components/ folder
          - When adding a feature, you should add it to the src/components/ folder.
          - You MUST keep the RootLayout.tsx file and import as is - you can only add code inside of the <RootLayout> tag.

          
          You will have access to the following ShadCN components:
          accordion.tsx
          button.tsx
          card.tsx
          checkbox.tsx
          dropdown-menu.tsx
          input.tsx
          label.tsx
          radio-group.tsx
          scroll-area.tsx
          select.tsx
          sonner.tsx
          tabs.tsx
          textarea.tsx
          theme-provider.tsx

          You should always use these components when implementing a feature, along with shadcn tailwind variables.

          Your response should be a very concise explanation along with a valid git diff of the changes you will make to the file.
          The diff MUST be in the following format:

          diff --git a/path/to/file b/path/to/file
          deleted file mode 100644
          --- a/path/to/file
          +++ /dev/null
          @@ -1,3 +0,0 @@
          -line to remove 1
          -line to remove 2
          -line to remove 3
          `,
    }[file.changeType];

    const { object: change } = await generateObject({
      model: deepseek("deepseek-chat"),
      schema: z.object({
        explanation: z.string(),
        diff: z.string().describe("A git diff of the changes you will make to the file"),
      }),
      system: workerSystemPrompt,
      prompt: `Implement the changes for ${file.filePath} to support:
      ${file.purpose}}
      
      You must respond in a JSON with the following format:
      {
        explanation: "A very concise explanation of the changes you will make",
        diff: "A git diff of the changes you will make to the file"
      }
      `,
    });

    fileChanges.push({
      file,
      implementation: change,
    });
  }

  const allDiffs = fileChanges.map(change => change.implementation.diff);

  return new Response(allDiffs.join('\n'), {
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}