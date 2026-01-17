/**
 * Test image generation in minimized mode
 */

import { generateImage } from './tools/generate-image.js';
import { browserManager } from './browser.js';
import { log } from './config.js';

async function test() {
  console.log('=== Test génération image en mode MINIMISÉ ===\n');

  const outputPath = '/mnt/d/Claude/chatgpt-mcp/test-images/test-minimized-gen.png';

  console.log('Initialisation du navigateur (mode minimisé)...');

  // Initialize without forceVisible to trigger minimization
  await browserManager.initialize(false);

  // Check login
  const isLoggedIn = await browserManager.ensureLoggedIn();
  if (!isLoggedIn) {
    console.log('❌ Non connecté - lancez d\'abord: npm start -- --login');
    await browserManager.close();
    return;
  }

  console.log('✓ Connecté à ChatGPT');
  console.log('\nGénération d\'une image simple...');
  console.log('Prompt: "A simple blue cube on white background"\n');

  const result = await generateImage({
    prompt: 'A simple blue cube on white background, minimalist',
    outputPath,
  });

  if (result.success) {
    console.log(`\n✅ Image sauvegardée: ${result.imagePath}`);
    console.log('Vérifiez: D:\\Claude\\chatgpt-mcp\\test-images\\test-minimized-gen.png');
  } else {
    console.log(`\n❌ Échec: ${result.error}`);
  }

  console.log('\nFermeture...');
  await browserManager.close();
  console.log('Test terminé.');
}

test().catch(async (e) => {
  console.error('Erreur:', e);
  await browserManager.close();
  process.exit(1);
});
