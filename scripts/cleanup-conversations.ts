import { chromium } from 'patchright';
import { CONFIG } from '../src/config.js';

// Keywords that identify image generation conversations (case insensitive)
const IMAGE_CONVERSATION_KEYWORDS = [
  'enluminure',
  'illustration',
  'cnv',
  'image',
];

async function cleanupConversations() {
  console.log('Starting ChatGPT conversation cleanup...');
  console.log(`Using Chrome profile: ${CONFIG.userDataDir}`);
  console.log(`Looking for conversations containing: ${IMAGE_CONVERSATION_KEYWORDS.join(', ')}`);

  const browser = await chromium.launchPersistentContext(CONFIG.userDataDir, {
    headless: false,
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    viewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();

  try {
    console.log('Navigating to ChatGPT...');
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('Page loaded, waiting for history...');
    await page.waitForTimeout(5000);

    // Check if logged in by looking for history
    const historyContainer = await page.$('#history');
    if (!historyContainer) {
      console.log('Not logged in or history not found. Waiting up to 2 minutes...');
      try {
        await page.waitForSelector('#history', { timeout: 120000 });
        console.log('History found!');
      } catch {
        console.error('Could not find history. Please log in first.');
        return;
      }
    }

    console.log('Logged in. Scanning conversations...');

    let deletedCount = 0;
    let totalScanned = 0;
    const maxIterations = 200; // Safety limit

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Get all conversation links in the history
      const conversations = await page.$$('#history a[href^="/c/"]');

      if (conversations.length === 0) {
        console.log('No conversations found in history.');
        break;
      }

      let foundMatchThisIteration = false;

      for (const conv of conversations) {
        // Get the conversation title from the span inside
        const titleSpan = await conv.$('.truncate span');
        const title = titleSpan ? await titleSpan.textContent() : '';
        const titleLower = title?.toLowerCase() || '';

        totalScanned++;

        // Check if this conversation matches our keywords
        const isImageConversation = IMAGE_CONVERSATION_KEYWORDS.some(keyword =>
          titleLower.includes(keyword.toLowerCase())
        );

        if (isImageConversation) {
          console.log(`\nFound: "${title}"`);
          foundMatchThisIteration = true;

          try {
            // Hover to reveal the options button
            await conv.hover();
            await page.waitForTimeout(300);

            // Find and click the options button (three dots)
            const optionsButton = await conv.$('button[data-testid*="options"]');

            if (optionsButton) {
              await optionsButton.click();
              await page.waitForTimeout(300);

              // Wait for menu to appear and click Delete/Supprimer
              const deleteButton = await page.waitForSelector(
                '[role="menuitem"]:has-text("Delete"), [role="menuitem"]:has-text("Supprimer")',
                { timeout: 2000 }
              );

              if (deleteButton) {
                await deleteButton.click();
                await page.waitForTimeout(300);

                // Confirm deletion - look for the confirm button in the dialog
                const confirmButton = await page.waitForSelector(
                  'button.btn-danger, button:has-text("Delete"):visible, button:has-text("Supprimer"):visible',
                  { timeout: 2000 }
                );

                if (confirmButton) {
                  await confirmButton.click();
                  await page.waitForTimeout(500);
                  deletedCount++;
                  console.log(`  ✓ Deleted (${deletedCount} total)`);
                } else {
                  console.log(`  ✗ Confirm button not found`);
                  // Press Escape to close any open dialog
                  await page.keyboard.press('Escape');
                }
              } else {
                console.log(`  ✗ Delete menu item not found`);
                await page.keyboard.press('Escape');
              }
            } else {
              console.log(`  ✗ Options button not found`);
            }
          } catch (err) {
            console.log(`  ✗ Error: ${err}`);
            // Press Escape to close any open menus
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
          }

          // Break to refresh the conversation list after deletion attempt
          break;
        }
      }

      if (!foundMatchThisIteration) {
        console.log('\nNo more matching conversations found.');
        break;
      }

      // Small delay between iterations
      await page.waitForTimeout(200);
    }

    console.log(`\n========== Cleanup Complete ==========`);
    console.log(`Deleted: ${deletedCount} conversations`);
    console.log(`=======================================`);

  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    console.log('\nClosing browser in 3 seconds...');
    await page.waitForTimeout(3000);
    await browser.close();
  }
}

cleanupConversations().catch(console.error);
