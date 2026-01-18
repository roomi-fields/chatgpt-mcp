import { chromium, Browser, BrowserContext, Page } from 'patchright';
import { CONFIG, log, logError, logDebug, logWarn } from './config.js';
import { BrowserError, AuthenticationError } from './errors.js';
import fs from 'fs';

class BrowserSingleton {
  private static instance: BrowserSingleton;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private initialized: boolean = false;

  private constructor() {}

  static getInstance(): BrowserSingleton {
    if (!BrowserSingleton.instance) {
      BrowserSingleton.instance = new BrowserSingleton();
    }
    return BrowserSingleton.instance;
  }

  async initialize(forceVisible: boolean = false): Promise<void> {
    if (this.initialized && this.context) {
      log('Browser already initialized');
      return;
    }

    // Never use true headless - Cloudflare blocks it
    // Use visible mode but minimize when not doing login
    const headless = false;
    log(`Initializing browser (visible mode, will minimize: ${!forceVisible})`);

    // Ensure userDataDir exists
    if (!fs.existsSync(CONFIG.userDataDir)) {
      fs.mkdirSync(CONFIG.userDataDir, { recursive: true });
    }

    // Launch persistent context with system Chrome to avoid bot detection
    this.context = await chromium.launchPersistentContext(CONFIG.userDataDir, {
      headless,
      channel: 'chrome',  // Use system Chrome instead of bundled Chromium
      timeout: CONFIG.browserTimeout,
      viewport: { width: 1280, height: 600 },
      colorScheme: 'dark',  // Force dark mode
    });

    // Get existing page or create new one
    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

    this.initialized = true;
    log('Browser initialized successfully');
  }

  async minimizeWindow(): Promise<void> {
    if (!this.page || !this.context) return;

    try {
      const cdpSession = await this.context.newCDPSession(this.page);
      const { windowId } = await cdpSession.send('Browser.getWindowForTarget');
      await cdpSession.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'minimized' }
      });
      logDebug('Browser window minimized');
    } catch (e) {
      logWarn('Could not minimize window:', e);
    }
  }

  async restoreWindow(): Promise<void> {
    if (!this.page || !this.context) return;

    try {
      const cdpSession = await this.context.newCDPSession(this.page);
      const { windowId } = await cdpSession.send('Browser.getWindowForTarget');
      await cdpSession.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'normal' }
      });
      await this.page.waitForTimeout(500); // Let window restore
      logDebug('Browser window restored');
    } catch (e) {
      logWarn('Could not restore window:', e);
    }
  }

  async ensureLoggedIn(): Promise<boolean> {
    if (!this.page) {
      throw new BrowserError('Browser not initialized. Call initialize() first.');
    }

    try {
      // Navigate to ChatGPT
      await this.page.goto(CONFIG.chatgptUrl, {
        waitUntil: 'networkidle',
        timeout: CONFIG.browserTimeout
      });

      // Wait for the page to stabilize
      await this.page.waitForTimeout(2000);

      // Check URL for auth pages first
      const currentUrl = this.page.url();
      if (currentUrl.includes('auth.openai.com') || currentUrl.includes('/auth/login')) {
        log('User is NOT logged in - redirected to auth page');
        return false;
      }

      // Use page.evaluate for robust detection
      const loginState = await this.page.evaluate(() => {
        // Selectors for logged-in state (chat textarea)
        const textareaSelectors = [
          'textarea[id="prompt-textarea"]',
          'div[id="prompt-textarea"]',
          'textarea[data-id="root"]',
          'div[contenteditable="true"][id="prompt-textarea"]',
        ];

        const hasTextarea = textareaSelectors.some(sel => document.querySelector(sel));

        // Check for login buttons by text content
        let hasLoginButton = false;
        const buttons = document.querySelectorAll('button, a');
        buttons.forEach(btn => {
          const text = btn.textContent?.toLowerCase() || '';
          if (text.includes('log in') || text.includes('sign up') || text.includes('se connecter')) {
            hasLoginButton = true;
          }
        });

        // Also check for specific selectors
        if (document.querySelector('button[data-testid="login-button"]') ||
            document.querySelector('a[href*="/auth/login"]') ||
            document.querySelector('[data-testid="welcome-login-button"]')) {
          hasLoginButton = true;
        }

        return { hasTextarea, hasLoginButton };
      });

      if (loginState.hasTextarea && !loginState.hasLoginButton) {
        log('User is logged in to ChatGPT');
        return true;
      }

      if (loginState.hasLoginButton) {
        log('User is NOT logged in - login button detected');
        return false;
      }

      // Additional check: look for user menu or avatar (logged-in indicator)
      const hasUserMenu = await this.page.$('[data-testid="profile-button"], img[alt*="User"], button[aria-label*="profile"]');
      if (hasUserMenu) {
        log('User is logged in (user menu detected)');
        return true;
      }

      logWarn('Login status unclear, assuming not logged in');
      return false;
    } catch (error) {
      logError('Error checking login status:', error);
      return false;
    }
  }

  async openLoginPage(): Promise<void> {
    log('Opening login page for manual authentication...');

    // Re-initialize in visible mode if currently headless
    if (this.context && CONFIG.headless) {
      await this.close();
    }

    await this.initialize(true); // Force visible mode

    if (!this.page) {
      throw new BrowserError('Failed to create page for login');
    }

    // Navigate to ChatGPT
    await this.page.goto(CONFIG.chatgptUrl, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.browserTimeout
    });

    log('Browser opened. Please log in manually.');
    log('The session will be saved automatically after login.');
  }

  async waitForLogin(timeout: number = 300000): Promise<boolean> {
    if (!this.page) {
      throw new BrowserError('Browser not initialized');
    }

    log(`Waiting for manual login (timeout: ${timeout / 1000}s)...`);
    log('→ Cliquez sur "Log in" puis connectez-vous avec votre compte');

    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      // Check login status WITHOUT navigating (just check current page)
      const isLoggedIn = await this.checkLoginStatus();
      if (isLoggedIn) {
        log('Login successful!');
        return true;
      }
      await this.page.waitForTimeout(3000);
    }

    logError('Login timeout - user did not log in within the time limit');
    return false;
  }

  private async checkLoginStatus(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    try {
      // Check current page state WITHOUT navigating
      const currentUrl = this.page.url();

      // If on auth page, not logged in yet
      if (currentUrl.includes('auth.openai.com') || currentUrl.includes('/auth/login')) {
        return false;
      }

      // Check for textarea (logged in indicator)
      const loginState = await this.page.evaluate(() => {
        const textareaSelectors = [
          'textarea[id="prompt-textarea"]',
          'div[id="prompt-textarea"]',
          'div[contenteditable="true"][id="prompt-textarea"]',
        ];
        const hasTextarea = textareaSelectors.some(sel => document.querySelector(sel));
        return { hasTextarea };
      });

      return loginState.hasTextarea;
    } catch {
      return false;
    }
  }

  async getPage(): Promise<Page> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.page) {
      if (!this.context) {
        throw new BrowserError('Browser context not available');
      }
      this.page = await this.context.newPage();
    }

    return this.page;
  }

  async newConversation(): Promise<Page> {
    const page = await this.getPage();

    // Navigate to new chat
    await page.goto(`${CONFIG.chatgptUrl}/?model=gpt-4`, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.browserTimeout,
    });

    // Wait for the page to be ready
    await page.waitForTimeout(1000);

    return page;
  }

  isInitialized(): boolean {
    return this.initialized && this.context !== null;
  }

  async close(): Promise<void> {
    log('Closing browser...');

    if (this.page) {
      try {
        await this.page.close();
      } catch {
        // Page might already be closed
      }
      this.page = null;
    }

    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // Context might already be closed
      }
      this.context = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Browser might already be closed
      }
      this.browser = null;
    }

    this.initialized = false;
    log('Browser closed');
  }
}

export const browserManager = BrowserSingleton.getInstance();
