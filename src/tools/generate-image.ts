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

    // Capture every image already on the page BEFORE sending the prompt, so we can
    // tell which image is NEW afterwards. Host-agnostic on purpose: ChatGPT keeps
    // changing the host/structure of generated images.
    const existingImages = await page.evaluate(() => {
      const urls: string[] = [];
      document.querySelectorAll('img').forEach(img => {
        if (img.src && img.src.startsWith('http')) urls.push(img.src);
      });
      return [...new Set(urls)];
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
    log('Prompt submitted. Waiting for image generation...');

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

    // --- Detect a FINISHED generated image ---
    // We no longer use the "Download / Télécharger" button as the "ready" signal:
    // ChatGPT now renders that control before the image is actually generated, which
    // caused false-positive early detection (button found ~5s after submit -> no image
    // yet -> failure). Instead we wait for a genuinely large image (DALL-E output is
    // >=1024px; UI icons / avatars / spinners are tiny or have naturalWidth 0) to
    // appear inside the latest assistant turn and stay STABLE for a few polls.
    // This is host-agnostic and does not depend on a download button.
    let imageUrl: string | null = null;
    const startTime = Date.now();
    let lastSeenUrl: string | null = null;
    let stableCount = 0;
    let lastLogTime = 0;
    const STABLE_REQUIRED = 3; // 3 consecutive polls (~15s) of the same large image

    log('Waiting for a generated image to appear and stabilize...');
    while (Date.now() - startTime < detectionTimeout) {
      // Pick the largest "new" image, preferring ones inside an assistant message.
      const found = await page.evaluate(({ existing }: { existing: string[] }) => {
        const debug: string[] = [];
        const candidates: { src: string; w: number; h: number; inAssistant: boolean }[] = [];

        const consider = (img: HTMLImageElement, inAssistant: boolean) => {
          const src = img.src || '';
          if (!src || !src.startsWith('http')) return;
          if (src.includes('avatar')) return;
          if (candidates.some(c => c.src === src)) return;
          candidates.push({ src, w: img.naturalWidth, h: img.naturalHeight, inAssistant });
        };

        // Images inside assistant turns (the generated image lives here)
        Array.from(document.querySelectorAll('div[data-message-author-role="assistant"]')).forEach(
          msg => msg.querySelectorAll('img').forEach(img => consider(img as HTMLImageElement, true))
        );
        // Whole-page fallback in case the role attribute changes one day
        document.querySelectorAll('img').forEach(img => consider(img as HTMLImageElement, false));

        // A generated image is large; icons / avatars / spinners are small or 0.
        const big = candidates.filter(c => c.w >= 256 && c.h >= 256 && !existing.includes(c.src));
        big.sort((a, b) => b.w * b.h - a.w * a.h);

        debug.push(`${candidates.length} imgs, ${big.length} large&new`);
        big.slice(0, 4).forEach(c =>
          debug.push(`  ${c.w}x${c.h} assistant=${c.inAssistant} ${c.src.slice(0, 70)}`)
        );

        // Prefer an image inside an assistant message, else the largest big image.
        const best = big.find(c => c.inAssistant) || big[0] || null;
        return { url: best ? best.src : null, debug };
      }, { existing: existingImages });

      if (found.debug.length) logDebug(`Image scan: ${found.debug.join(' | ')}`);

      if (found.url) {
        if (found.url === lastSeenUrl) {
          stableCount++;
          if (stableCount >= STABLE_REQUIRED) {
            imageUrl = found.url;
            log(`Image stable - ready: ${imageUrl.substring(0, 80)}...`);
            break;
          }
        } else {
          lastSeenUrl = found.url;
          stableCount = 1;
          logDebug(`New candidate image, stabilizing: ${found.url.substring(0, 70)}...`);
        }
      } else {
        lastSeenUrl = null;
        stableCount = 0;
      }

      // Progress log every 30 seconds
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed - lastLogTime >= 30) {
        log(`Waiting... (${elapsed}s) - candidate: ${lastSeenUrl ? 'yes' : 'none'}, stable: ${stableCount}/${STABLE_REQUIRED}`);
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

    // Small settle wait so the server-side file is final before downloading
    if (imageUrl) {
      await page.waitForTimeout(2000);
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
