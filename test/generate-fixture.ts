import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

async function generateSampleTrace() {
  const outputDir = path.resolve(process.cwd(), 'test/fixtures');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const tracePath = path.join(outputDir, 'sample-failure.zip');
  if (fs.existsSync(tracePath)) {
    fs.unlinkSync(tracePath);
  }

  console.log('🚀 Launching headless browser to record authentic Playwright trace...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // Start tracing: record screenshots, snapshots, and sources
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });

  const page = await context.newPage();

  // Route HTML page
  await page.route('https://checkout.envestnet.com/**', async (route) => {
    if (route.request().url().includes('/api/checkout/process')) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error: Payment Gateway Down', code: 'GATEWAY_500' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Payment Portal Test Fixture</title>
          <style>
            body { font-family: sans-serif; padding: 20px; }
            .btn-submit { background: #0070f3; color: white; padding: 10px 20px; border: none; cursor: pointer; }
          </style>
        </head>
        <body>
          <h1>Checkout Flow Verification</h1>
          <form id="checkout-form">
            <label for="user-email">Email Address</label>
            <input id="user-email" type="email" value="pranav@example.com" />
            
            <div class="actions">
              <button id="real-submit-btn" class="btn-submit" type="button" data-testid="checkout-submit-btn">
                Confirm & Pay
              </button>
            </div>
          </form>

          <script>
            console.log("App initialized successfully.");
            document.getElementById('real-submit-btn').addEventListener('click', async () => {
              console.error("Initiating checkout request to /api/checkout/process...");
              try {
                const res = await fetch('https://checkout.envestnet.com/api/checkout/process', { method: 'POST' });
                if (!res.ok) {
                  console.error("Payment API returned HTTP " + res.status);
                }
              } catch (e) {
                console.error("Network exception during checkout: " + e.message);
              }
            });
          </script>
        </body>
        </html>
      `,
    });
  });

  // Navigate to mock URL
  await page.goto('https://checkout.envestnet.com/');

  // Perform successful action
  await page.fill('#user-email', 'tester@envestnet.com');
  
  // Click real button to trigger network 500 request
  await page.click('#real-submit-btn');
  // Wait briefly for network request to be captured
  await page.waitForTimeout(600);

  // Intentional failure: wait for non-existent locator with short timeout
  console.log('Triggering intentional locator timeout failure...');
  try {
    await page.click('button#non-existent-pay-button', { timeout: 2000 });
  } catch (err: any) {
    console.log('Caught expected test failure:', err.message?.split('\n')[0]);
  }

  // Stop tracing and save archive
  console.log('Saving trace archive to:', tracePath);
  await context.tracing.stop({ path: tracePath });
  await browser.close();

  console.log('✅ Generated sample trace fixture at:', tracePath);
  console.log('File size:', fs.statSync(tracePath).size, 'bytes');
}

generateSampleTrace().catch((err) => {
  console.error('Fixture generation failed:', err);
  process.exit(1);
});
