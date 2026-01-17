/**
 * Test batch image generation - multiple images in series
 * Browser stays open, each image uses a new conversation
 */

import { generateImage } from './tools/generate-image.js';
import { browserManager } from './browser.js';
import { log } from './config.js';

const prompts = [
  'A red apple on a white background, simple, clean',
  'A yellow banana on a white background, simple, clean',
  'A green pear on a white background, simple, clean',
];

async function testBatch() {
  console.log('=== Test génération en SÉRIE (batch) ===\n');
  console.log(`Nombre d'images à générer: ${prompts.length}\n`);

  // Initialize browser once (minimized)
  console.log('Initialisation du navigateur (une seule fois)...');
  await browserManager.initialize(false);

  const isLoggedIn = await browserManager.ensureLoggedIn();
  if (!isLoggedIn) {
    console.log('❌ Non connecté - lancez d\'abord: npm start -- --login');
    await browserManager.close();
    return;
  }

  console.log('✓ Connecté à ChatGPT\n');
  console.log('─'.repeat(50));

  const results: { prompt: string; success: boolean; path?: string; error?: string; duration: number }[] = [];

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const outputPath = `/mnt/d/Claude/chatgpt-mcp/test-images/batch-${i + 1}.png`;

    console.log(`\n[${i + 1}/${prompts.length}] Génération...`);
    console.log(`Prompt: "${prompt}"`);

    const startTime = Date.now();
    const result = await generateImage({ prompt, outputPath });
    const duration = Math.round((Date.now() - startTime) / 1000);

    if (result.success) {
      console.log(`✅ Succès en ${duration}s → ${outputPath}`);
      results.push({ prompt, success: true, path: outputPath, duration });
    } else {
      console.log(`❌ Échec: ${result.error}`);
      results.push({ prompt, success: false, error: result.error, duration });
    }

    // Petite pause entre les générations
    if (i < prompts.length - 1) {
      console.log('Pause 2s avant la prochaine génération...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log('\n=== RÉSUMÉ ===\n');

  const successful = results.filter(r => r.success).length;
  console.log(`Réussis: ${successful}/${prompts.length}`);
  console.log(`Temps total: ${results.reduce((sum, r) => sum + r.duration, 0)}s\n`);

  results.forEach((r, i) => {
    const status = r.success ? '✅' : '❌';
    console.log(`${status} [${i + 1}] ${r.prompt.substring(0, 30)}... (${r.duration}s)`);
  });

  console.log('\nFermeture du navigateur...');
  await browserManager.close();
  console.log('Test terminé.');
}

testBatch().catch(async (e) => {
  console.error('Erreur:', e);
  await browserManager.close();
  process.exit(1);
});
