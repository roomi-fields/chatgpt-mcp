/**
 * Test script for Task 4: Image Generation
 */

import { generateImage } from './tools/generate-image.js';
import { browserManager } from './browser.js';
import { CONFIG } from './config.js';
import fs from 'fs';
import path from 'path';

const TEST_OUTPUT_DIR = '/tmp/chatgpt-mcp-test';

async function runTests() {
  console.log('=== Test 4: Génération d\'image DALL-E ===\n');

  // Create test output directory
  if (!fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
  }

  // Initialize browser in visible mode to use saved session
  console.log('Initialisation du navigateur...');
  await browserManager.initialize(true); // visible mode

  // Test 1: Simple prompt with default size
  console.log('Test 4.1: Génération simple (1024x1024)...');
  console.log('→ Prompt: "A cute orange cat sitting on a book"');
  console.log('→ Cela va prendre 30-60 secondes...\n');

  const result1 = await generateImage({
    prompt: 'A cute orange cat sitting on a book',
    outputPath: path.join(TEST_OUTPUT_DIR, 'test-cat.png'),
  });

  if (result1.success) {
    console.log(`✓ Image générée: ${result1.imagePath}`);
    const stats = fs.statSync(result1.imagePath!);
    console.log(`✓ Taille du fichier: ${(stats.size / 1024).toFixed(1)} KB`);
    console.log('→ Pause de 5 secondes pour voir le résultat...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  } else {
    console.log(`✗ Échec: ${result1.error}\n`);
  }

  // Test 2: Different size (landscape)
  console.log('Test 4.2: Taille paysage (1792x1024)...');
  console.log('→ Prompt: "A mountain landscape at sunset"');
  console.log('→ Cela va prendre 30-60 secondes...\n');

  const result2 = await generateImage({
    prompt: 'A mountain landscape at sunset',
    outputPath: path.join(TEST_OUTPUT_DIR, 'test-landscape.png'),
    size: '1792x1024',
  });

  if (result2.success) {
    console.log(`✓ Image générée: ${result2.imagePath}`);
    const stats = fs.statSync(result2.imagePath!);
    console.log(`✓ Taille du fichier: ${(stats.size / 1024).toFixed(1)} KB`);
    console.log('→ Pause de 5 secondes pour voir le résultat...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  } else {
    console.log(`✗ Échec: ${result2.error}\n`);
  }

  // Summary
  console.log('=== Résumé ===');
  console.log(`Test 1 (simple): ${result1.success ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Test 2 (paysage): ${result2.success ? '✓ PASS' : '✗ FAIL'}`);

  if (result1.success || result2.success) {
    console.log(`\nImages sauvegardées dans: ${TEST_OUTPUT_DIR}`);
  }

  // Cleanup
  console.log('\nFermeture du navigateur...');
  await browserManager.close();

  console.log('=== Tests terminés ===');
}

runTests().catch(async (error) => {
  console.error('Erreur fatale:', error);
  await browserManager.close();
  process.exit(1);
});
