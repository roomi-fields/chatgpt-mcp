/**
 * Test headless mode
 */

import { chromium } from 'patchright';
import { CONFIG, log, logError } from './config.js';
import fs from 'fs';

async function testHeadless() {
  console.log('=== Test Mode Headless ===\n');

  // Ensure userDataDir exists
  if (!fs.existsSync(CONFIG.userDataDir)) {
    fs.mkdirSync(CONFIG.userDataDir, { recursive: true });
  }

  console.log('Lancement Chrome, chargement, puis MINIMISATION...');

  const context = await chromium.launchPersistentContext(CONFIG.userDataDir, {
    headless: false,
    channel: 'chrome',
    timeout: CONFIG.browserTimeout,
    viewport: { width: 1280, height: 800 },
  });

  const page = context.pages()[0] || await context.newPage();

  console.log('Navigation vers ChatGPT...');

  try {
    await page.goto(CONFIG.chatgptUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForTimeout(2000);

    // Minimiser la fenêtre via CDP après chargement
    console.log('Minimisation de la fenêtre...');
    try {
      const cdpSession = await context.newCDPSession(page);
      const { windowId } = await cdpSession.send('Browser.getWindowForTarget');
      await cdpSession.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'minimized' }
      });
      console.log('Fenêtre minimisée!');
    } catch (e) {
      console.log('Echec minimisation:', e);
    }

    await page.waitForTimeout(1000);

    const currentUrl = page.url();
    console.log(`URL actuelle: ${currentUrl}`);

    // Check for Cloudflare challenge
    const pageContent = await page.content();
    const hasCloudflare = pageContent.includes('cf-challenge') ||
                          pageContent.includes('Cloudflare') ||
                          pageContent.includes('Just a moment');

    if (hasCloudflare) {
      console.log('\n❌ CLOUDFLARE DETECTE - Le mode headless est bloqué');
      await page.screenshot({ path: '/mnt/d/Claude/chatgpt-mcp/test-images/minimized-cloudflare.png' });
      console.log('Screenshot sauvegardé: test-images/minimized-cloudflare.png');
    } else {
      // Check login status
      const loginState = await page.evaluate(() => {
        const textareaSelectors = [
          'textarea[id="prompt-textarea"]',
          'div[id="prompt-textarea"]',
          'div[contenteditable="true"][id="prompt-textarea"]',
        ];
        const hasTextarea = textareaSelectors.some(sel => document.querySelector(sel));

        const hasLoginButton = !!document.querySelector('button[data-testid="login-button"]') ||
                               !!document.querySelector('a[href*="/auth/login"]');

        return { hasTextarea, hasLoginButton };
      });

      if (loginState.hasTextarea && !loginState.hasLoginButton) {
        console.log('\n✅ MODE HEADLESS FONCTIONNE!');
        console.log('   - Pas de Cloudflare');
        console.log('   - Utilisateur connecté');
        await page.screenshot({ path: '/mnt/d/Claude/chatgpt-mcp/test-images/minimized-success.png' });
        console.log('Screenshot sauvegardé: test-images/minimized-success.png');
      } else if (loginState.hasLoginButton) {
        console.log('\n⚠️  Mode headless fonctionne mais non connecté');
        console.log('   - Pas de Cloudflare');
        console.log('   - Session expirée ou jamais connecté');
        await page.screenshot({ path: '/mnt/d/Claude/chatgpt-mcp/test-images/headless-not-logged.png' });
      } else {
        console.log('\n⚠️  État incertain');
        await page.screenshot({ path: '/mnt/d/Claude/chatgpt-mcp/test-images/headless-unknown.png' });
        console.log('Screenshot sauvegardé pour analyse');
      }
    }

  } catch (error) {
    console.log(`\n❌ ERREUR: ${error}`);
    await page.screenshot({ path: '/mnt/d/Claude/chatgpt-mcp/test-images/headless-error.png' }).catch(() => {});
  }

  console.log('\nFermeture...');
  await context.close();
  console.log('Test terminé.');
}

testHeadless().catch(console.error);
