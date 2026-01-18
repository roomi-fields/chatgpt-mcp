import { browserManager } from '../browser.js';
import { CONFIG, log, logError, logDebug, logWarn } from '../config.js';
import { AuthenticationError, ImageGenerationError, RateLimitError, TimeoutError } from '../errors.js';
import { Page } from 'patchright';
import fs from 'fs';
import path from 'path';

interface RateLimitInfo {
  isLimited: boolean;
  message?: string;
  retryAfter?: number; // in milliseconds
  waitTimeText?: string; // human readable wait time (e.g., "22 minutes")
}

async function checkRateLimit(page: Page): Promise<RateLimitInfo> {
  try {
    const rateLimitStatus = await page.evaluate(() => {
      const pageText = document.body.innerText;
      const pageTextLower = pageText.toLowerCase();

      // Check for rate limit messages
      const rateLimitPhrases = [
        "you've reached the limit",
        "you have reached your limit",
        "generating images too quickly",
        "too quickly",
        "please wait",
        "rate limit",
        "too many requests",
        "try again later",
        "usage cap",
        "limit reached",
        "vous avez atteint",
        "veuillez patienter",
        "attendez",
        "générez des images trop rapidement",
        "trop rapidement",
      ];

      let foundMessage: string | null = null;
      for (const phrase of rateLimitPhrases) {
        if (pageTextLower.includes(phrase)) {
          foundMessage = phrase;
          break;
        }
      }

      if (!foundMessage) {
        // Check for error messages in specific elements
        const errorElements = Array.from(document.querySelectorAll('.error-message, [role="alert"], .text-red-500'));
        for (const el of errorElements) {
          const text = el.textContent?.toLowerCase() || '';
          for (const phrase of rateLimitPhrases) {
            if (text.includes(phrase)) {
              foundMessage = el.textContent || phrase;
              break;
            }
          }
          if (foundMessage) break;
        }
      }

      // Check ChatGPT assistant messages (most reliable for rate limit messages)
      if (!foundMessage) {
        const assistantMessages = Array.from(document.querySelectorAll('div[data-message-author-role="assistant"]'));
        for (const el of assistantMessages) {
          const text = el.textContent?.toLowerCase() || '';
          for (const phrase of rateLimitPhrases) {
            if (text.includes(phrase)) {
              foundMessage = el.textContent || phrase;
              break;
            }
          }
          if (foundMessage) break;
        }
      }

      if (!foundMessage) {
        return { isLimited: false };
      }

      // Try to extract wait time from the full page text
      // Patterns: "22 minutes", "5 min", "1 hour", "30 seconds", etc.
      const timePatterns = [
        /(\d+)\s*(minute|minutes|min|mins)/i,
        /(\d+)\s*(hour|hours|heure|heures|hr|hrs)/i,
        /(\d+)\s*(second|seconds|sec|secs|seconde|secondes)/i,
      ];

      let waitTimeText: string | null = null;
      let waitTimeMs: number | null = null;

      for (const pattern of timePatterns) {
        const match = pageText.match(pattern);
        if (match) {
          const value = parseInt(match[1], 10);
          const unit = match[2].toLowerCase();
          waitTimeText = `${value} ${match[2]}`;

          if (unit.startsWith('min')) {
            waitTimeMs = value * 60 * 1000;
          } else if (unit.startsWith('hour') || unit.startsWith('heure') || unit.startsWith('hr')) {
            waitTimeMs = value * 60 * 60 * 1000;
          } else if (unit.startsWith('sec')) {
            waitTimeMs = value * 1000;
          }
          break;
        }
      }

      return {
        isLimited: true,
        message: foundMessage,
        waitTimeText,
        waitTimeMs,
      };
    });

    if (rateLimitStatus.isLimited) {
      return {
        isLimited: true,
        message: rateLimitStatus.message,
        retryAfter: rateLimitStatus.waitTimeMs || 60000,
        waitTimeText: rateLimitStatus.waitTimeText || undefined,
      };
    }

    return { isLimited: false };
  } catch {
    return { isLimited: false };
  }
}

export type ImageSize = '1024x1024' | '1792x1024' | '1024x1792';

export interface GenerateImageOptions {
  prompt: string;
  outputPath: string;
  size?: ImageSize;
}

export interface GenerateImageResult {
  success: boolean;
  imagePath?: string;
  error?: string;
  warning?: string;
}

export async function generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
  const { prompt, outputPath, size = '1024x1024' } = options;

  log(`Generating image: "${prompt.substring(0, 50)}..." (size: ${size})`);

  try {
    // Ensure browser is initialized (visible mode for session) and logged in
    if (!browserManager.isInitialized()) {
      await browserManager.initialize(true); // visible mode
    }
    const isLoggedIn = await browserManager.ensureLoggedIn();

    if (!isLoggedIn) {
      const authError = new AuthenticationError('Not logged in to ChatGPT. Run login first.');
      return { success: false, error: authError.message };
    }

    // Navigate to new conversation
    const page = await browserManager.newConversation();
    await page.waitForTimeout(2000);

    // Build the DALL-E prompt
    const dallePrompt = `Generate an image: ${prompt}.\nSize: ${size}`;
    log(`Sending prompt to ChatGPT...`);

    // Find and fill the textarea
    const textareaSelector = 'textarea[id="prompt-textarea"], div[id="prompt-textarea"], div[contenteditable="true"]';
    const textarea = await page.waitForSelector(textareaSelector, { timeout: 10000 });

    if (!textarea) {
      return { success: false, error: 'Could not find chat textarea' };
    }

    // Capture existing large images BEFORE sending prompt (only in assistant messages)
    const existingImages = await page.evaluate(() => {
      const assistantMsgs = document.querySelectorAll('div[data-message-author-role="assistant"]');
      const urls: string[] = [];
      assistantMsgs.forEach(msg => {
        const imgs = msg.querySelectorAll('img');
        imgs.forEach(img => {
          // Only track large images (DALL-E images are 200+ px, icons are 40-64px)
          if (img.src && (img.src.includes('estuary') || img.src.includes('oaidalleapi')) && img.width >= 200 && img.height >= 200) {
            urls.push(img.src);
          }
        });
      });
      return urls;
    });
    logDebug(`Existing images before prompt: ${existingImages.length}`);

    // Insert the prompt via clipboard (fast) - preserves newlines
    await textarea.click();
    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, dallePrompt);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(500); // Let the paste complete

    // Submit the prompt
    await page.keyboard.press('Enter');
    log('Prompt submitted. Waiting for image generation (up to 2 minutes)...');

    // Wait a moment then check for rate limits (just log warning, don't fail - image may still generate)
    await page.waitForTimeout(5000);
    let rateLimitWarning: string | undefined;
    let detectionTimeout = 600000; // 10 minutes default, may be extended if rate limited
    const initialRateLimitCheck = await checkRateLimit(page);
    if (initialRateLimitCheck.isLimited) {
      const waitInfo = initialRateLimitCheck.waitTimeText
        ? `Wait time: ${initialRateLimitCheck.waitTimeText}`
        : 'Wait time unknown';
      rateLimitWarning = `Rate limit detected: "${initialRateLimitCheck.message}". ${waitInfo}. Image may still be generated...`;
      logWarn(rateLimitWarning);

      // Add rate limit wait time to existing timeout
      if (initialRateLimitCheck.retryAfter) {
        detectionTimeout += initialRateLimitCheck.retryAfter;
        log(`Timeout extended to ${Math.round(detectionTimeout / 60000)} minutes (added ${Math.round(initialRateLimitCheck.retryAfter / 60000)} min for rate limit)`);
      }
    }

    // Download button selector - appears when image is fully generated
    const downloadButtonSelectors = [
      'button[aria-label="Télécharger cette image"]',
      'button[aria-label="Download this image"]',
      'button[aria-label*="download" i]',
      'button[aria-label*="télécharger" i]',
    ];

    // Wait for image to appear in the response (only in assistant messages)
    const imageSelectors = [
      'div[data-message-author-role="assistant"] img[src*="estuary/content"]',
      'div[data-message-author-role="assistant"] img[src*="oaidalleapi"]',
      'div[data-message-author-role="assistant"] img[src*="dalle"]',
      'div[data-message-author-role="assistant"] img[alt*="Generated"]',
      'div[data-message-author-role="assistant"] div[data-testid="image-container"] img',
      'div[data-message-author-role="assistant"] img.rounded-lg',
      'div[data-message-author-role="assistant"] img[width]',
    ];

    let imageUrl: string | null = null;
    let imageElement: any = null;

    // Poll for download button (most reliable) or track URLs as fallback
    const startTime = Date.now();
    let downloadButtonFound = false;

    // For fallback: track URL changes
    let lastUrlSet = new Set<string>();
    let stableCount = 0;
    let newestUrl: string | null = null;
    let lastLogTime = 0;

    log('Waiting for download button or stable image URLs...');
    while (Date.now() - startTime < detectionTimeout) {
      // Check for download button first - this is the most reliable signal
      for (const selector of downloadButtonSelectors) {
        try {
          const btn = await page.$(selector);
          if (btn) {
            log('Download button detected - image is ready!');
            downloadButtonFound = true;
            break;
          }
        } catch {
          // Ignore
        }
      }

      if (downloadButtonFound) {
        // Find the image URL now that we know it's ready (only large images)
        const foundUrl = await page.evaluate(({ selectors, existing }: { selectors: string[], existing: string[] }) => {
          for (const selector of selectors) {
            const imgs = Array.from(document.querySelectorAll(selector));
            for (const img of imgs) {
              const imgEl = img as HTMLImageElement;
              const src = imgEl.src;
              // Only consider large images (DALL-E images are 200+ px, icons are 40-64px)
              if (src && (src.includes('estuary') || src.includes('oaidalleapi')) &&
                  !src.includes('avatar') && imgEl.width >= 200 && imgEl.height >= 200) {
                if (!existing.includes(src)) {
                  return src;
                }
              }
            }
          }
          return null;
        }, { selectors: imageSelectors, existing: existingImages });

        if (foundUrl) {
          imageUrl = foundUrl;
          log(`Image URL: ${foundUrl.substring(0, 80)}...`);
        }
        break;
      }

      // Fallback: track URL changes (for cases with multiple images / no download button)
      // Only look at large images inside assistant messages to avoid picking up avatars/icons
      const allUrls = await page.evaluate(() => {
        const assistantMsgs = document.querySelectorAll('div[data-message-author-role="assistant"]');
        const urls: string[] = [];
        assistantMsgs.forEach(msg => {
          const imgs = msg.querySelectorAll('img');
          imgs.forEach(img => {
            // DALL-E images are at least 256px displayed, icons are much smaller (40-64px)
            if (img.src && img.src.includes('estuary/content') && img.width >= 200 && img.height >= 200) {
              urls.push(img.src);
            }
          });
        });
        return urls;
      });
      const newUrls = allUrls.filter(url => !existingImages.includes(url));
      const currentUrlSet = new Set(newUrls);

      // Check if URLs have changed
      const setsEqual = (a: Set<string>, b: Set<string>) => {
        if (a.size !== b.size) return false;
        for (const item of a) {
          if (!b.has(item)) return false;
        }
        return true;
      };

      if (!setsEqual(lastUrlSet, currentUrlSet)) {
        // URLs changed - find newest
        const addedUrls = [...currentUrlSet].filter(url => !lastUrlSet.has(url));
        if (addedUrls.length > 0) {
          newestUrl = addedUrls[addedUrls.length - 1];
          logDebug(`New URL appeared: ${newestUrl.substring(0, 60)}...`);
        }
        stableCount = 0;
        lastUrlSet = currentUrlSet;
      } else if (currentUrlSet.size > 0) {
        stableCount++;
        // After 5 minutes of stability without download button, use fallback
        if (stableCount >= 60) { // 60 * 5s = 300s = 5 minutes
          log(`No download button but URLs stable for 5 minutes - using fallback`);
          if (newestUrl) {
            imageUrl = newestUrl;
            log(`Using newest URL: ${imageUrl.substring(0, 80)}...`);
          }
          break;
        }
      }

      // Log progress every 30 seconds
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed - lastLogTime >= 30) {
        log(`Waiting... (${elapsed}s) - ${currentUrlSet.size} URLs, stable: ${stableCount}/60`);
        lastLogTime = elapsed;
      }

      // Re-check for rate limit on every iteration until detected
      if (!rateLimitWarning) {
        const laterRateLimitCheck = await checkRateLimit(page);
        if (laterRateLimitCheck.isLimited) {
          const waitInfo = laterRateLimitCheck.waitTimeText
            ? `Wait time: ${laterRateLimitCheck.waitTimeText}`
            : 'Wait time unknown';
          rateLimitWarning = `Rate limit detected: "${laterRateLimitCheck.message}". ${waitInfo}. Image may still be generated...`;
          logWarn(rateLimitWarning);

          // Add rate limit wait time to existing timeout
          if (laterRateLimitCheck.retryAfter) {
            detectionTimeout += laterRateLimitCheck.retryAfter;
            log(`Timeout extended to ${Math.round(detectionTimeout / 60000)} minutes (added ${Math.round(laterRateLimitCheck.retryAfter / 60000)} min for rate limit)`);
          }
        }
      }

      await page.waitForTimeout(5000);
    }

    // If download button was found, image is ready - just a short wait
    if (downloadButtonFound && imageUrl) {
      log('Download button found - waiting 2s for final render...');
      await page.waitForTimeout(2000);
    }

    if (!imageUrl) {
      // Try one more approach: get all large images in assistant messages
      const allImages = await page.evaluate(() => {
        const assistantMsgs = document.querySelectorAll('div[data-message-author-role="assistant"]');
        const sources: string[] = [];
        assistantMsgs.forEach(msg => {
          const imgs = msg.querySelectorAll('img');
          imgs.forEach(img => {
            if (img.src && img.width > 200) {
              sources.push(img.src);
            }
          });
        });
        return sources;
      });

      // Find the most likely DALL-E image
      for (const src of allImages) {
        if (src.includes('dalle') || src.includes('oaidalleapi') || src.includes('estuary')) {
          if (!existingImages.includes(src)) {
            imageUrl = src;
            break;
          }
        }
      }
    }

    if (!imageUrl) {
      const timeoutError = new TimeoutError('Image generation timeout or image not found in response');
      return { success: false, error: timeoutError.message };
    }

    // Download image using browser's API request (includes auth cookies)
    log(`Downloading image to ${outputPath}...`);

    // Ensure output directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Use the browser context's request API to download with cookies
    const context = page.context();
    const response = await context.request.get(imageUrl);

    if (!response.ok()) {
      throw new ImageGenerationError(`Failed to download image: HTTP ${response.status()}`);
    }

    // Get the image as a buffer and write to file
    const imageBuffer = await response.body();
    fs.writeFileSync(outputPath, imageBuffer);

    log(`Image saved successfully: ${outputPath}`);

    // Delete the conversation after successful download
    try {
      log('Deleting conversation...');

      // Find the active/current conversation in the history sidebar
      // The current conversation usually has a distinct style or is the first one
      const activeConversation = await page.$('#history a[href^="/c/"].bg-token-sidebar-surface-secondary, #history a[href^="/c/"]:first-child');
      if (activeConversation) {
        await activeConversation.hover();
        await page.waitForTimeout(300);

        // Click the options menu (three dots)
        const optionsButton = await activeConversation.$('button[data-testid*="options"]');
        if (optionsButton) {
          await optionsButton.click();
          await page.waitForTimeout(300);

          // Click Delete option
          const deleteButton = await page.waitForSelector(
            '[role="menuitem"]:has-text("Delete"), [role="menuitem"]:has-text("Supprimer")',
            { timeout: 2000 }
          );
          if (deleteButton) {
            await deleteButton.click();
            await page.waitForTimeout(300);

            // Confirm deletion
            const confirmButton = await page.waitForSelector(
              'button.btn-danger, button:has-text("Delete"):visible, button:has-text("Supprimer"):visible',
              { timeout: 2000 }
            );
            if (confirmButton) {
              await confirmButton.click();
              await page.waitForTimeout(500);
              log('Conversation deleted successfully');
            }
          }
        }
      } else {
        logWarn('Could not find active conversation to delete');
      }
    } catch (deleteError) {
      logWarn(`Could not delete conversation: ${deleteError}`);
      // Don't fail the whole operation if deletion fails
    }

    return { success: true, imagePath: outputPath, warning: rateLimitWarning };

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError('Image generation failed:', message);
    return { success: false, error: message };
  }
}

