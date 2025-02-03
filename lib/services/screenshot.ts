import { supabase } from './supabase';
import chromium from "@sparticuz/chromium";
import playwright from "playwright-core";

export async function captureAndStoreMobileScreenshot(
  projectId: string,
  userId: string,
  url: string
): Promise<string> {
  let browser: playwright.Browser | undefined;
  let context: playwright.BrowserContext | undefined;
  let page: playwright.Page | undefined;

  try {
    // Configure Chrome specifically for AWS Lambda
    const executablePath = await chromium.executablePath();

    browser = await playwright.chromium.launch({
      executablePath,
      args: chromium.args,
      headless: true,
    });

    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      colorScheme: 'dark',
      serviceWorkers: 'block', // Block service workers to prevent hanging
      javaScriptEnabled: true,
      bypassCSP: true,
    });

    page = await context.newPage();

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 15000
    });

    // Take screenshot immediately after load
    const screenshot = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      fullPage: false
    });

    const fileName = `${userId}/${projectId}/screenshot.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('project-screenshots')
      .upload(fileName, screenshot, {
        contentType: 'image/jpeg',
        upsert: true
      });

    if (uploadError) {
      console.error('Screenshot upload error:', uploadError);
      throw uploadError;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('project-screenshots')
      .getPublicUrl(fileName);

    return publicUrl;
  } catch (error) {
    console.error('Screenshot capture error:', error);
    throw error;
  } finally {
    // Clean up resources immediately
    try {
      if (page) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    }
  }
} 