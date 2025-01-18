import { chromium } from 'playwright';
import { supabase } from './supabase';

export async function captureAndStoreMobileScreenshot(
  projectId: string,
  userId: string,
  url: string
): Promise<string> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });

  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const screenshot = await page.screenshot({ type: 'jpeg', quality: 80 });

    const fileName = `${userId}/${projectId}/screenshot.jpg`;
    const { error } = await supabase.storage
      .from('project-screenshots')
      .upload(fileName, screenshot, {
        contentType: 'image/jpeg',
        upsert: true
      });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('project-screenshots')
      .getPublicUrl(fileName);

    return publicUrl;
  } finally {
    await browser.close();
  }
} 