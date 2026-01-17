/**
 * Quick test for download fix
 */

import { generateImage } from './tools/generate-image.js';
import { browserManager } from './browser.js';

async function test() {
  console.log('=== Test téléchargement corrigé ===\n');

  const outputPath = '/mnt/d/Claude/chatgpt-mcp/test-images/test-download-fix2.png';

  console.log('Génération d\'une image simple...');
  console.log('Prompt: "A red apple on a white background"\n');

  const result = await generateImage({
    prompt: 'A red apple on a white background, simple, clean',
    outputPath,
  });

  if (result.success) {
    console.log(`\n✓ Image sauvegardée: ${result.imagePath}`);
    console.log('Vérifiez: D:\\Claude\\chatgpt-mcp\\test-images\\test-download-fix.png');
  } else {
    console.log(`\n✗ Échec: ${result.error}`);
  }

  console.log('\nFermeture dans 5 secondes...');
  await new Promise(r => setTimeout(r, 5000));
  await browserManager.close();
}

test().catch(async (e) => {
  console.error('Erreur:', e);
  await browserManager.close();
  process.exit(1);
});
