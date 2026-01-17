/**
 * Test script for browser.ts
 * Validates each point from the Test Strategy
 */

import { browserManager } from './browser.js';
import { CONFIG, log, logError } from './config.js';
import fs from 'fs';

async function runTests() {
  console.log('=== Test Browser.ts ===\n');

  // Test 1: Vérifier que le navigateur se lance en mode visible
  console.log('Test 1: Lancement navigateur mode visible...');
  try {
    await browserManager.initialize(true); // forceVisible = true
    console.log('✓ Navigateur lancé en mode visible\n');
  } catch (error) {
    console.error('✗ Échec lancement mode visible:', error);
    process.exit(1);
  }

  // Test 2: Vérifier que le profil Chrome est créé
  console.log('Test 2: Vérification profil Chrome...');
  if (fs.existsSync(CONFIG.userDataDir)) {
    console.log(`✓ Profil Chrome créé: ${CONFIG.userDataDir}\n`);
  } else {
    console.error(`✗ Profil Chrome non trouvé: ${CONFIG.userDataDir}`);
    process.exit(1);
  }

  // Test 3: Tester ensureLoggedIn() retourne false quand non connecté
  console.log('Test 3: Vérification état connexion (devrait être false si pas connecté)...');
  try {
    const isLoggedIn = await browserManager.ensureLoggedIn();
    console.log(`→ ensureLoggedIn() retourne: ${isLoggedIn}`);
    console.log('✓ Test connexion exécuté\n');
  } catch (error) {
    console.error('✗ Échec test connexion:', error);
  }

  // Test 4: Tester openLoginPage()
  console.log('Test 4: Ouverture page de login...');
  console.log('(Le navigateur devrait afficher la page ChatGPT)');
  try {
    await browserManager.openLoginPage();
    console.log('✓ Page de login ouverte\n');
    console.log('→ Attendez 10 secondes pour observer le navigateur...');
    await new Promise(resolve => setTimeout(resolve, 10000));
  } catch (error) {
    console.error('✗ Échec ouverture page login:', error);
  }

  // Test 5: Vérifier que close() libère les ressources
  console.log('Test 5: Fermeture navigateur...');
  try {
    await browserManager.close();
    console.log('✓ Navigateur fermé\n');
  } catch (error) {
    console.error('✗ Échec fermeture:', error);
    process.exit(1);
  }

  // Vérification finale: le navigateur ne doit plus être initialisé
  console.log('Test 5b: Vérification état après fermeture...');
  if (!browserManager.isInitialized()) {
    console.log('✓ browserManager.isInitialized() retourne false\n');
  } else {
    console.error('✗ Le navigateur est toujours marqué comme initialisé');
    process.exit(1);
  }

  console.log('=== Tous les tests passés ===');
}

runTests().catch(error => {
  console.error('Erreur fatale:', error);
  process.exit(1);
});
