import { browserManager } from '../browser.js';
import { CONFIG, log, logError, logDebug, logWarn } from '../config.js';
import { AuthenticationError, ImageGenerationError, RateLimitError, TimeoutError } from '../errors.js';
import { Page } from 'patchright';
import fs from 'fs';
import path from 'path';

interface RateLimitInfo {
  isLimited: boolean;
  message?: string;
  retryAfter?: number;
}

async function checkRateLimit(page: Page): Promise<RateLimitInfo> {
  try {
    const rateLimitStatus = await page.evaluate(() => {
      const pageText = document.body.innerText.toLowerCase();

      // Check for rate limit messages
      const rateLimitPhrases = [
        "you've reached the limit",
        "you have reached your limit",
        "please wait",
        "rate limit",
        "too many requests",
        "try again later",
        "usage cap",
        "limit reached",
      ];

      for (const phrase of rateLimitPhrases) {
        if (pageText.includes(phrase)) {
          return { isLimited: true, message: phrase };
        }
      }

      // Check for error messages in specific elements
      const errorElements = Array.from(document.querySelectorAll('.error-message, [role="alert"], .text-red-500'));
      for (const el of errorElements) {
        const text = el.textContent?.toLowerCase() || '';
        for (const phrase of rateLimitPhrases) {
          if (text.includes(phrase)) {
            return { isLimited: true, message: text };
          }
        }
      }

      return { isLimited: false };
    });

    if (rateLimitStatus.isLimited) {
      return {
        isLimited: true,
        message: rateLimitStatus.message,
        retryAfter: 60000, // Default 1 minute
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

    // Re-minimize after navigation
    await browserManager.minimizeWindow();

    // Build the DALL-E prompt
    const dallePrompt = `Generate an image: ${prompt}. Size: ${size}`;
    log(`Sending prompt to ChatGPT...`);

    // Find and fill the textarea
    const textareaSelector = 'textarea[id="prompt-textarea"], div[id="prompt-textarea"], div[contenteditable="true"]';
    const textarea = await page.waitForSelector(textareaSelector, { timeout: 10000 });

    if (!textarea) {
      return { success: false, error: 'Could not find chat textarea' };
    }

    // Type the prompt
    await textarea.click();
    await page.keyboard.type(dallePrompt, { delay: 10 });

    // Submit the prompt
    await page.keyboard.press('Enter');
    log('Prompt submitted. Waiting for image generation (up to 2 minutes)...');

    // Wait a moment then check for rate limits
    await page.waitForTimeout(3000);
    const rateLimitCheck = await checkRateLimit(page);
    if (rateLimitCheck.isLimited) {
      const rateLimitError = new RateLimitError(
        rateLimitCheck.message || 'Rate limit reached',
        rateLimitCheck.retryAfter
      );
      logWarn(`Rate limited: ${rateLimitError.message}`);
      return {
        success: false,
        error: `${rateLimitError.message}. Retry after ${(rateLimitError.retryAfter || 60000) / 1000} seconds.`,
      };
    }

    // Wait for image to appear in the response
    const imageSelectors = [
      'img[alt*="Generated"]',
      'img[src*="oaidalleapi"]',
      'img[src*="dalle"]',
      'div[data-testid="image-container"] img',
      'img.rounded-lg',
      // Generic fallback: any large image in the response area
      'div[data-message-author-role="assistant"] img[width]',
    ];

    let imageUrl: string | null = null;
    let imageElement: any = null;

    // Poll for image with timeout
    const startTime = Date.now();
    while (Date.now() - startTime < CONFIG.imageGenerationTimeout) {
      // First, wait for DALL-E to finish "thinking" - look for the stop button to disappear
      const isGenerating = await page.$('button[aria-label="Stop generating"]');
      if (isGenerating) {
        log('DALL-E is still generating...');
        await page.waitForTimeout(3000);
        continue;
      }

      // Now look for the generated image
      for (const selector of imageSelectors) {
        try {
          const img = await page.$(selector);
          if (img) {
            const src = await img.getAttribute('src');
            if (src && (src.includes('oaidalleapi') || src.includes('estuary') || src.includes('file_')) && !src.includes('avatar')) {
              // Found a candidate - wait for it to be fully loaded
              const isLoaded = await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalHeight > 0);
              if (isLoaded) {
                imageUrl = src;
                imageElement = img;
                logDebug(`Image fully loaded: ${src.substring(0, 80)}...`);
                break;
              }
            }
          }
        } catch {
          // Ignore errors and continue checking
        }
      }

      if (imageUrl) break;
      await page.waitForTimeout(2000);
    }

    // Wait for image to fully render (DALL-E renders progressively)
    if (imageUrl) {
      log('Waiting for image to fully render (15 seconds)...');
      await page.waitForTimeout(15000);

      // Re-fetch the image URL in case it changed during rendering
      for (const selector of imageSelectors) {
        try {
          const img = await page.$(selector);
          if (img) {
            const newSrc = await img.getAttribute('src');
            if (newSrc && newSrc !== imageUrl && (newSrc.includes('estuary') || newSrc.includes('file_'))) {
              logDebug(`Image URL updated: ${newSrc.substring(0, 80)}...`);
              imageUrl = newSrc;
            }
          }
        } catch {
          // Ignore
        }
      }
    }

    if (!imageUrl) {
      // Try one more approach: get all images and find the DALL-E one
      const allImages = await page.evaluate(() => {
        const imgs = document.querySelectorAll('img');
        const sources: string[] = [];
        imgs.forEach(img => {
          if (img.src && img.width > 200) {
            sources.push(img.src);
          }
        });
        return sources;
      });

      // Find the most likely DALL-E image
      for (const src of allImages) {
        if (src.includes('dalle') || src.includes('oaidalleapi') || src.includes('openai')) {
          imageUrl = src;
          break;
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
    return { success: true, imagePath: outputPath };

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError('Image generation failed:', message);
    return { success: false, error: message };
  }
}

