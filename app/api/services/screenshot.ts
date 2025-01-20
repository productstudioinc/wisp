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
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    colorScheme: 'dark',
    serviceWorkers: 'allow',
    permissions: ['notifications'],
    javaScriptEnabled: true,
    bypassCSP: true,
  });

  try {
    const page = await context.newPage();

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

    console.log('Waiting 25 seconds for deployment to stabilize...')
    await new Promise(resolve => setTimeout(resolve, 25000))

    console.log('Taking screenshot of:', url)
    await page.goto(url, { waitUntil: 'networkidle' });
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
  } finally {
    await browser.close();
  }
} 