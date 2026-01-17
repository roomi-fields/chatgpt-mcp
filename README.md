# ChatGPT MCP - DALL-E Image Generation Server

Serveur HTTP pour la generation automatisee d'images DALL-E via l'interface web ChatGPT.

## Prerequis

- Node.js >= 18
- Google Chrome installe sur le systeme
- Compte ChatGPT Plus (acces DALL-E)

## Installation

```bash
npm install
npm run build
```

## Configuration

Variables d'environnement optionnelles:

| Variable | Description | Defaut |
|----------|-------------|--------|
| `PORT` | Port du serveur HTTP | `3100` |
| `HOST` | Adresse d'ecoute | `0.0.0.0` |
| `HEADLESS` | Mode headless (`true`/`false`) | `true` |
| `DEBUG` | Active les logs debug | `false` |
| `LOG_LEVEL` | Niveau de log (`debug`, `info`, `warn`, `error`) | `info` |

## Utilisation

### 1. Premiere connexion

```bash
npm start -- --login
```

Un navigateur Chrome s'ouvre. Connectez-vous manuellement a ChatGPT, puis attendez la confirmation dans le terminal. La session est sauvegardee automatiquement.

### 2. Demarrer le serveur

```bash
npm start
```

Le serveur demarre sur `http://localhost:3100`.

## API Endpoints

### GET /health

Verifie l'etat du serveur et de la connexion ChatGPT.

```bash
curl http://localhost:3100/health
```

Reponse:
```json
{
  "status": "ok",
  "loggedIn": true,
  "browserReady": true
}
```

### POST /generate-image

Genere une image DALL-E.

```bash
curl -X POST http://localhost:3100/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cat wearing a top hat in a steampunk style",
    "outputPath": "/path/to/output.png",
    "size": "1024x1024"
  }'
```

Parametres:
| Parametre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `prompt` | string | Oui | Description de l'image a generer |
| `outputPath` | string | Oui | Chemin absolu pour sauvegarder l'image |
| `size` | string | Non | Taille: `1024x1024`, `1792x1024`, `1024x1792` |

Reponse succes:
```json
{
  "success": true,
  "imagePath": "/path/to/output.png"
}
```

Reponse erreur:
```json
{
  "success": false,
  "error": "Rate limited: too many requests",
  "code": "RATE_LIMIT_ERROR"
}
```

### GET /login

Ouvre le navigateur pour une connexion manuelle.

```bash
curl http://localhost:3100/login
```

## Codes d'erreur

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Parametres manquants ou invalides |
| `AUTH_ERROR` | Non connecte a ChatGPT |
| `BROWSER_ERROR` | Erreur du navigateur |
| `IMAGE_GEN_ERROR` | Echec de generation ou telechargement |
| `RATE_LIMIT_ERROR` | Limite d'utilisation atteinte |
| `TIMEOUT_ERROR` | Timeout de generation |

## Depannage

### La session a expire

Relancez la connexion:
```bash
npm start -- --login
```

### Mode debug

Pour voir tous les logs:
```bash
DEBUG=true npm start
```

### Le navigateur ne se lance pas

Verifiez que Chrome est installe:
```bash
which google-chrome || which chrome
```

### Images floues

Le serveur attend 15 secondes apres detection de l'image pour permettre le rendu complet de DALL-E.

## Architecture

```
src/
  index.ts          # Serveur Express HTTP
  browser.ts        # Singleton de gestion du navigateur
  config.ts         # Configuration et logging
  errors.ts         # Types d'erreurs personnalises
  tools/
    generate-image.ts  # Logique de generation d'image
```

## Limitations

- Necessite un compte ChatGPT Plus actif
- Une seule generation a la fois
- La session peut expirer apres une longue inactivite
- Detecte par Cloudflare si utilise avec Chromium (utilise Chrome du systeme)

## Licence

MIT
