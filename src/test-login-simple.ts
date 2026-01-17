/**
 * Test simple de login - sans rechargement
 */

import { chromium } from 'patchright';
import { CONFIG, log } from './config.js';
import fs from 'fs';

async function testLogin() {
  console.log('=== Test Login Simple ===\n');

  // Créer le dossier du profil si nécessaire
  if (!fs.existsSync(CONFIG.userDataDir)) {
    fs.mkdirSync(CONFIG.userDataDir, { recursive: true });
  }

  console.log('Lancement du navigateur (Chrome système)...');
  const context = await chromium.launchPersistentContext(CONFIG.userDataDir, {
    headless: false,
    channel: 'chrome',  // Utilise Chrome installé sur le système
    viewport: { width: 1280, height: 800 },
  });

  const page = context.pages()[0] || await context.newPage();

  console.log('Navigation vers ChatGPT...');
  await page.goto('https://chatgpt.com', { waitUntil: 'networkidle' });

  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  Le navigateur est ouvert sur ChatGPT.                 ║');
  console.log('║                                                        ║');
  console.log('║  1. Cliquez sur "Log in"                               ║');
  console.log('║  2. Connectez-vous avec votre compte                   ║');
  console.log('║  3. Une fois sur l\'interface de chat, revenez ici      ║');
  console.log('║                                                        ║');
  console.log('║  La fenêtre NE SE RECHARGERA PAS.                      ║');
  console.log('║  Timeout: 3 minutes                                    ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // Attendre que l'utilisateur se connecte (sans recharger la page)
  const timeout = 180000; // 3 minutes
  const startTime = Date.now();
  let isLoggedIn = false;

  while (Date.now() - startTime < timeout) {
    try {
      // Vérification complète: textarea présent ET pas de bouton login
      const status = await page.evaluate(() => {
        // Chercher le textarea de chat
        const textarea = document.querySelector('textarea[id="prompt-textarea"]') ||
                         document.querySelector('div[id="prompt-textarea"]') ||
                         document.querySelector('div[contenteditable="true"][data-placeholder]');

        // Chercher les boutons de login (indique qu'on n'est PAS connecté)
        const loginButtons = document.querySelectorAll('button, a');
        let hasLoginButton = false;
        loginButtons.forEach(btn => {
          const text = btn.textContent?.toLowerCase() || '';
          if (text.includes('log in') || text.includes('sign up') || text.includes('se connecter')) {
            hasLoginButton = true;
          }
        });

        // Chercher un indicateur de compte connecté (avatar, menu profil)
        const profileIndicator = document.querySelector('[data-testid="profile-button"]') ||
                                  document.querySelector('img[alt*="User"]') ||
                                  document.querySelector('button[aria-label*="profile"]') ||
                                  document.querySelector('button[aria-haspopup="menu"]');

        return {
          hasTextarea: !!textarea,
          hasLoginButton,
          hasProfileIndicator: !!profileIndicator,
          url: window.location.href
        };
      });

      console.log(`Check: textarea=${status.hasTextarea}, loginBtn=${status.hasLoginButton}, profile=${status.hasProfileIndicator}`);

      // Connecté si: (textarea OU indicateur profil) ET pas de bouton login ET pas sur page auth
      const onAuthPage = status.url.includes('auth.openai.com') || status.url.includes('/auth/');
      if ((status.hasTextarea || status.hasProfileIndicator) && !status.hasLoginButton && !onAuthPage) {
        console.log('✓ Connexion détectée!');
        isLoggedIn = true;
        break;
      }
    } catch (err) {
      // Ignore errors during check (page might be navigating)
    }
    await page.waitForTimeout(2000);
  }

  if (isLoggedIn) {
    console.log('\n✓ SUCCESS: Vous êtes connecté à ChatGPT!');
    console.log('✓ La session est sauvegardée dans:', CONFIG.userDataDir);
  } else {
    console.log('\n✗ TIMEOUT: Connexion non détectée après 3 minutes');
  }

  console.log('\nFermeture dans 5 secondes...');
  await page.waitForTimeout(5000);
  await context.close();

  console.log('=== Test terminé ===');
}

testLogin().catch(error => {
  console.error('Erreur:', error);
  process.exit(1);
});
