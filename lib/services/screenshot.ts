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
    const executablePath = await chromium.executablePath();

    browser = await playwright.chromium.launch({
      executablePath,
      headless: true
    });

    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      colorScheme: 'dark',
      serviceWorkers: 'allow',
      permissions: ['notifications'],
      javaScriptEnabled: true,
      bypassCSP: true,
    });

    page = await context.newPage();

    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'standalone', {
        get: () => true,
      });
      window.matchMedia = (query: string): MediaQueryList => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        onchange: null,
        addListener: () => { },
        removeListener: () => { },
        addEventListener: () => { },
        removeEventListener: () => { },
        dispatchEvent: () => true
      });
    });

    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('Taking screenshot of:', url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const screenshot = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      fullPage: false
    });

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
  } catch (error) {
    console.error('Screenshot capture error:', error);
    throw error;
  } finally {
    if (page) await page?.close().catch(console.error);
    if (context) await context?.close().catch(console.error);
    if (browser) await browser?.close().catch(console.error);
  }
} 