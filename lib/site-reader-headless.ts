/**
 * Optional headless-browser reader for JS-rendered sites (Next.js,
 * React SPA, Vue, etc). Uses Playwright if it's installed. We dynamic-import
 * so the base project doesn't require the ~200MB browser binary just to run.
 *
 * Enable with:
 *   npm install playwright
 *   npx playwright install chromium
 *
 * Then in .env:
 *   USE_HEADLESS_SITE_READER=1
 *
 * Without those, lib/site-reader.ts's simpler fetch-based reader is used.
 */

export async function readWebsiteHeadless(url: string): Promise<{
  url: string;
  title: string;
  description: string;
  text: string;
  jsRendered: boolean;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let playwright: any;
  try {
    // @ts-expect-error — optional peer dep; install `playwright` to enable
    playwright = await import("playwright");
  } catch {
    throw new Error(
      "Playwright isn't installed. `npm install playwright && npx playwright install chromium` — or leave USE_HEADLESS_SITE_READER unset to use the fetch-based reader.",
    );
  }

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Adwise/0.1",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });
    // Give late-binding scripts a beat to settle (product grids, lazy
    // hero text, etc). Tunable — 1500ms catches most.
    await page.waitForTimeout(1500);

    const title = (await page.title()) || "";
    const description =
      (await page
        .locator('meta[name="description"]')
        .first()
        .getAttribute("content")
        .catch(() => null)) ||
      (await page
        .locator('meta[property="og:description"]')
        .first()
        .getAttribute("content")
        .catch(() => null)) ||
      "";

    const text = await page.evaluate(() => {
      const root = document.body;
      const script = root.querySelectorAll("script, style, noscript");
      script.forEach((e) => e.remove());
      return (root.innerText || "").replace(/\n{3,}/g, "\n\n");
    });

    return {
      url: page.url(),
      title: title.slice(0, 200),
      description: description.slice(0, 500),
      text: text.slice(0, 20_000),
      jsRendered: true, // We know — we just rendered it.
    };
  } finally {
    await browser.close();
  }
}
