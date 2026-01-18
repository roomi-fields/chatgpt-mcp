/**
 * Test to find the download button selector
 */

import { browserManager } from './browser.js';
import { log } from './config.js';

async function test() {
  console.log('=== Test détection bouton download ===\n');

  await browserManager.initialize(false);

  const isLoggedIn = await browserManager.ensureLoggedIn();
  if (!isLoggedIn) {
    console.log('❌ Non connecté');
    await browserManager.close();
    return;
  }

  const page = await browserManager.getPage();

  // Navigate to ChatGPT and wait for user to generate an image manually
  console.log('Naviguez vers une conversation avec une image générée...');
  console.log('Puis appuyez sur Entrée ici pour analyser le DOM\n');

  // Wait for user input
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });

  console.log('Analyse du DOM...\n');

  // Look for potential download buttons
  const buttons = await page.evaluate(() => {
    const results: { selector: string; html: string; ariaLabel?: string; title?: string }[] = [];

    // Look for buttons/links near images
    const allButtons = document.querySelectorAll('button, a');
    allButtons.forEach((btn, i) => {
      const html = btn.outerHTML.substring(0, 200);
      const ariaLabel = btn.getAttribute('aria-label');
      const title = btn.getAttribute('title');

      // Look for download-related attributes
      if (
        ariaLabel?.toLowerCase().includes('download') ||
        ariaLabel?.toLowerCase().includes('télécharger') ||
        title?.toLowerCase().includes('download') ||
        html.includes('download') ||
        html.includes('Download')
      ) {
        results.push({
          selector: `button/a[${i}]`,
          html,
          ariaLabel: ariaLabel || undefined,
          title: title || undefined
        });
      }
    });

    // Also look for SVG icons that might be download buttons
    const svgs = document.querySelectorAll('svg');
    svgs.forEach((svg, i) => {
      const parent = svg.parentElement;
      if (parent && (parent.tagName === 'BUTTON' || parent.tagName === 'A')) {
        const ariaLabel = parent.getAttribute('aria-label');
        const title = parent.getAttribute('title');
        if (
          ariaLabel?.toLowerCase().includes('download') ||
          title?.toLowerCase().includes('download')
        ) {
          results.push({
            selector: `svg-parent[${i}]`,
            html: parent.outerHTML.substring(0, 300),
            ariaLabel: ariaLabel || undefined,
            title: title || undefined
          });
        }
      }
    });

    return results;
  });

  console.log('Boutons trouvés avec "download":');
  console.log(JSON.stringify(buttons, null, 2));

  // Also look for any button near the generated image
  const imageButtons = await page.evaluate(() => {
    const imgs = document.querySelectorAll('img[src*="estuary"]');
    const results: string[] = [];

    imgs.forEach(img => {
      // Find parent container
      let parent = img.parentElement;
      for (let i = 0; i < 5 && parent; i++) {
        const buttons = parent.querySelectorAll('button, a');
        buttons.forEach(btn => {
          results.push(btn.outerHTML.substring(0, 200));
        });
        parent = parent.parentElement;
      }
    });

    return [...new Set(results)]; // Unique
  });

  console.log('\nBoutons près des images estuary:');
  imageButtons.forEach((html, i) => console.log(`[${i}] ${html}\n`));

  await browserManager.close();
  console.log('Test terminé.');
}

test().catch(console.error);
