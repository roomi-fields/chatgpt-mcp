import { chromium } from 'patchright';
import { CONFIG } from '../src/config.js';
import fs from 'fs';
import path from 'path';

const CONVERSATIONS = [
  { url: 'https://chatgpt.com/c/696d3576-801c-8329-a66d-0f152442d9b6', name: 'enluminure-1' },
  { url: 'https://chatgpt.com/c/696d4b90-a578-8325-91de-ef73a8649375', name: 'enluminure-2' },
];

const OUTPUT_DIR = '/mnt/d/Claude/chatgpt-mcp/recovered-images';

async function fetchImages() {
  console.log('Fetching images from ChatGPT conversations...');
  console.log(`Output directory: ${OUTPUT_DIR}\n`);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser = await chromium.launchPersistentContext(CONFIG.userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 600 },
    colorScheme: 'dark',
  });

  const page = await browser.newPage();

  try {
    for (const conv of CONVERSATIONS) {
      console.log(`\n=== Processing: ${conv.name} ===`);
      console.log(`URL: ${conv.url}`);

      await page.goto(conv.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);

      // Scroll through the entire conversation to trigger lazy loading
      console.log('  Scrolling to load images...');
      const scrollContainer = await page.$('main') || page;

      // Scroll down in increments
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(500);
      }

      // Wait for images to load
      await page.waitForTimeout(3000);

      // Scroll back to top
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(2000);

      // Find all estuary images in the conversation
      const debugInfo = await page.evaluate(() => {
        const info: string[] = [];

        // Check for image containers
        const imageContainers = document.querySelectorAll('div[id^="image-"], .group\\/imagegen-image');
        info.push(`Image containers (div[id^="image-"], .group/imagegen-image): ${imageContainers.length}`);
        imageContainers.forEach((container, i) => {
          const imgs = container.querySelectorAll('img');
          imgs.forEach(img => {
            const opacity = getComputedStyle(img).opacity;
            info.push(`  Container ${i}: ${img.src.substring(0, 60)}... (opacity: ${opacity})`);
          });
        });

        // Check assistant messages
        const assistantMsgs = document.querySelectorAll('div[data-message-author-role="assistant"]');
        info.push(`Assistant messages: ${assistantMsgs.length}`);
        assistantMsgs.forEach((msg, i) => {
          const imgs = msg.querySelectorAll('img');
          if (imgs.length > 0) {
            imgs.forEach(img => {
              const imgEl = img as HTMLImageElement;
              const rect = imgEl.getBoundingClientRect();
              info.push(`  Msg ${i}: ${imgEl.src.substring(0, 50)}... (${Math.round(rect.width)}x${Math.round(rect.height)})`);
            });
          }
        });

        // Check all estuary images
        const estuaryImgs = document.querySelectorAll('img[src*="estuary"]');
        info.push(`All estuary images: ${estuaryImgs.length}`);
        estuaryImgs.forEach((img, i) => {
          const imgEl = img as HTMLImageElement;
          const rect = imgEl.getBoundingClientRect();
          const opacity = getComputedStyle(imgEl).opacity;
          info.push(`  ${i}: ${imgEl.src.substring(0, 50)}... (${Math.round(rect.width)}x${Math.round(rect.height)}, opacity: ${opacity})`);
        });

        return info;
      });
      debugInfo.forEach(info => console.log(`  ${info}`));

      const images = await page.evaluate(() => {
        const urls: string[] = [];

        // Look for images in the new ChatGPT image generation UI (same as MCP)
        const imageContainers = document.querySelectorAll('div[id^="image-"], .group\\/imagegen-image');
        imageContainers.forEach(container => {
          const imgs = container.querySelectorAll('img');
          imgs.forEach(img => {
            if (img.src && img.src.includes('estuary')) {
              const opacity = getComputedStyle(img).opacity;
              // Only include visible images (opacity > 0.01)
              if (opacity !== '0' && opacity !== '0.01') {
                urls.push(img.src);
              }
            }
          });
        });

        // Also check assistant messages as fallback
        if (urls.length === 0) {
          const assistantMsgs = document.querySelectorAll('div[data-message-author-role="assistant"]');
          assistantMsgs.forEach(msg => {
            const imgs = msg.querySelectorAll('img');
            imgs.forEach(img => {
              if (img.src && img.src.includes('estuary')) {
                // Check that this image is reasonably sized (not an icon)
                const rect = img.getBoundingClientRect();
                if (rect.width >= 200 && rect.height >= 200) {
                  urls.push(img.src);
                }
              }
            });
          });
        }

        return [...new Set(urls)];
      });

      console.log(`Found ${images.length} image(s)`);

      // Download each image
      for (let i = 0; i < images.length; i++) {
        const imageUrl = images[i];
        const filename = `${conv.name}-${i + 1}.png`;
        const outputPath = path.join(OUTPUT_DIR, filename);

        console.log(`  Downloading: ${filename}`);

        try {
          const context = page.context();
          const response = await context.request.get(imageUrl);

          if (response.ok()) {
            const buffer = await response.body();
            fs.writeFileSync(outputPath, buffer);
            console.log(`  ✓ Saved: ${outputPath}`);
          } else {
            console.log(`  ✗ Failed: HTTP ${response.status()}`);
          }
        } catch (err) {
          console.log(`  ✗ Error: ${err}`);
        }
      }
    }

    console.log('\n=== Done ===');
    console.log(`Images saved to: ${OUTPUT_DIR}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    console.log('\nClosing browser in 3 seconds...');
    await page.waitForTimeout(3000);
    await browser.close();
  }
}

fetchImages().catch(console.error);
