import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { CONFIG, log, logError, logDebug } from './config.js';
import { browserManager } from './browser.js';
import { generateImage } from './tools/generate-image.js';
import { ChatGPTError } from './errors.js';

const app = express();
app.use(cors());
app.use(express.json());

// Logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  logDebug(`${req.method} ${req.path}`);
  next();
});

// GET /health - Server status
app.get('/health', async (req, res) => {
  try {
    const browserReady = browserManager.isInitialized();
    let loggedIn = false;

    if (browserReady) {
      loggedIn = await browserManager.ensureLoggedIn().catch(() => false);
    }

    res.json({
      status: 'ok',
      loggedIn,
      browserReady,
    });
  } catch (error) {
    res.json({
      status: 'ok',
      loggedIn: false,
      browserReady: false,
    });
  }
});

// POST /generate-image - Generate an image
app.post('/generate-image', async (req: Request, res: Response) => {
  const { prompt, outputPath, size } = req.body;

  if (!prompt || !outputPath) {
    res.status(400).json({
      success: false,
      error: 'prompt and outputPath are required',
      code: 'VALIDATION_ERROR'
    });
    return;
  }

  try {
    log(`Generating image: "${prompt.substring(0, 50)}..."`);
    const result = await generateImage({ prompt, outputPath, size });
    res.json(result);
  } catch (error) {
    logError('Image generation failed:', error);
    if (error instanceof ChatGPTError) {
      res.status(500).json({
        success: false,
        error: error.message,
        code: error.code
      });
    } else {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: message, code: 'UNKNOWN_ERROR' });
    }
  }
});

// GET /login - Open browser for manual login
app.get('/login', async (req: Request, res: Response) => {
  try {
    await browserManager.openLoginPage();
    res.json({
      success: true,
      message: 'Login page opened. Please login manually in the browser window.'
    });
  } catch (error) {
    logError('Failed to open login page:', error);
    if (error instanceof ChatGPTError) {
      res.status(500).json({
        success: false,
        error: error.message,
        code: error.code
      });
    } else {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: `Failed to open login page: ${message}`,
        code: 'UNKNOWN_ERROR'
      });
    }
  }
});

// Graceful shutdown
async function shutdown() {
  log('Shutting down...');
  await browserManager.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
async function start() {
  // Check CLI arguments
  if (process.argv.includes('--login')) {
    log('Opening login page...');
    await browserManager.openLoginPage();
    log('Please login manually. Press Ctrl+C when done.');

    // Wait for login
    const success = await browserManager.waitForLogin(300000); // 5 minutes
    if (success) {
      log('Login successful! Session saved.');
    } else {
      logError('Login timeout.');
    }
    await browserManager.close();
    return;
  }

  // Initialize browser (minimized mode - visible but hidden)
  log('Initializing browser...');
  await browserManager.initialize(false); // minimized mode

  // Check login status
  const isLoggedIn = await browserManager.ensureLoggedIn();
  if (!isLoggedIn) {
    log('Not logged in. Run with --login first, or call GET /login');
  } else {
    log('Logged in to ChatGPT');
  }

  // Start HTTP server
  app.listen(CONFIG.port, CONFIG.host, () => {
    log(`Server running at http://${CONFIG.host}:${CONFIG.port}`);
    log('Endpoints:');
    log('  GET  /health         - Check server and login status');
    log('  POST /generate-image - Generate an image { prompt, outputPath, size? }');
    log('  GET  /login          - Open browser for manual login');
  });
}

start().catch((error) => {
  logError('Failed to start server:', error);
  process.exit(1);
});
