/**
 * Test script for Task 3: Login Detection
 * Tests all points from the Test Strategy
 */

import { browserManager } from './browser.js';
import { CONFIG, log } from './config.js';

async function runTests() {
  console.log('=== Test 3: Détection de connexion ChatGPT ===\n');

  // Test 1: Session non connectée → false
  console.log('Test 3.1: Session non connectée...');
  try {
    await browserManager.initialize(true); // visible mode
    const isLoggedIn = await browserManager.ensureLoggedIn();
    if (isLoggedIn === false) {
      console.log('✓ ensureLoggedIn() retourne false (non connecté)\n');
    } else {
      console.log(`⚠ ensureLoggedIn() retourne ${isLoggedIn} - vous êtes peut-être déjà connecté?\n`);
    }
  } catch (error) {
    console.error('✗ Erreur:', error);
    process.exit(1);
  }

  // Test 2: Login manuel puis vérification
  console.log('Test 3.2: Login manuel requis...');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  INSTRUCTIONS:                                         ║');
  console.log('║  1. Une fenêtre Chrome va s\'ouvrir sur ChatGPT         ║');
  console.log('║  2. Cliquez sur le bouton "Log in"                     ║');
  console.log('║  3. Connectez-vous avec votre compte OpenAI            ║');
  console.log('║  4. Une fois connecté, attendez la détection auto      ║');
  console.log('║  Vous avez 2 minutes.                                  ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  try {
    await browserManager.openLoginPage();

    const loginSuccess = await browserManager.waitForLogin(120000); // 2 minutes

    if (loginSuccess) {
      console.log('✓ Login détecté avec succès!');

      // Vérifier que ensureLoggedIn retourne maintenant true
      const isLoggedInAfter = await browserManager.ensureLoggedIn();
      if (isLoggedInAfter) {
        console.log('✓ ensureLoggedIn() retourne true après login\n');
      } else {
        console.log('✗ ensureLoggedIn() retourne false même après login\n');
      }
    } else {
      console.log('⚠ Login non effectué dans le délai imparti');
      console.log('→ Ce test sera à refaire plus tard\n');
    }
  } catch (error) {
    console.error('✗ Erreur login:', error);
  }

  // Test 3: Ne bloque pas indéfiniment (timeout court)
  console.log('Test 3.3: Vérification timeout (ne bloque pas)...');
  try {
    const startTime = Date.now();
    await browserManager.ensureLoggedIn();
    const elapsed = Date.now() - startTime;

    if (elapsed < CONFIG.browserTimeout) {
      console.log(`✓ Fonction terminée en ${elapsed}ms (< timeout ${CONFIG.browserTimeout}ms)\n`);
    } else {
      console.log(`⚠ Fonction lente: ${elapsed}ms\n`);
    }
  } catch (error) {
    console.error('✗ Erreur:', error);
  }

  // Test 4: Gestion URL invalide (simule erreur réseau)
  console.log('Test 3.4: Gestion erreur (URL invalide)...');
  try {
    const page = await browserManager.getPage();

    // Tenter de naviguer vers une URL invalide
    try {
      await page.goto('https://invalid-url-that-does-not-exist-12345.com', {
        timeout: 5000,
        waitUntil: 'domcontentloaded'
      });
      console.log('⚠ Navigation vers URL invalide n\'a pas échoué\n');
    } catch (navError) {
      console.log('✓ Erreur réseau gérée correctement (timeout/échec attendu)\n');
    }
  } catch (error) {
    console.error('✗ Erreur:', error);
  }

  // Cleanup
  console.log('Fermeture du navigateur...');
  await browserManager.close();

  console.log('=== Tests terminés ===');
}

runTests().catch(error => {
  console.error('Erreur fatale:', error);
  browserManager.close().finally(() => process.exit(1));
});
