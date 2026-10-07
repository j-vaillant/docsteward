# DocSteward v2

DocSteward est une application desktop authentifiée pour parcourir et prévisualiser en lecture seule les documents d’un dossier explicitement autorisé. Electron lance un serveur Fastify isolé sur `127.0.0.1` et un port éphémère. Toutes les ressources locales exigent à la fois une session utilisateur DocSteward et un secret de session injecté par Electron.

La v2 ajoute une recherche documentaire RAG et des indicateurs épinglés, activés explicitement par espace de travail. Consultez [la documentation RAG](docs/rag-v2.md) pour la confidentialité, la configuration et les limites.

## Prérequis de développement

- macOS ou Windows ;
- Node.js 24 LTS et npm 11 ;
- une instance d’`independentweb-api` configurée pour DocSteward.

L’application empaquetée embarque Electron et ne demande pas à l’utilisateur d’installer Node.js.

## Démarrage

```bash
npm install
npm run dev
```

Copiez `.env.example` vers `.env.local` puis adaptez `DOCSTEWARD_API_URL`. La clé OpenAI est
associée au compte dans `independentweb-api` et ne quitte jamais ce service. Dans l’application,
les modèles se règlent dans **Questions & indicateurs → Paramètres IA**.

Pour une application empaquetée, fournissez `DOCSTEWARD_API_URL` pendant `npm run package` ou
`npm run make` : Vite intègre cette URL publique dans le processus principal. Une variable
d’environnement présente au lancement reste prioritaire.

Au premier lancement, connectez-vous avec un compte DocSteward activé, puis choisissez un dossier avec le dialogue natif. Les extensions prises en charge sont `.txt`, `.md`, `.json`, `.yaml`, `.yml`, `.js`, `.jsx`, `.ts`, `.tsx`, `.css` et `.html`, dans la limite de 5 Mio par fichier.

La connexion est conservée entre les lancements grâce au chiffrement système d’Electron. Le mot de passe n’est jamais enregistré. La déconnexion efface la session sauvegardée ; un JWT expiré ou un changement de service demande une nouvelle connexion. Si le chiffrement système est indisponible, la connexion reste limitée au lancement en cours.

## Contrôles

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e
```

## Packaging local

```bash
npm run package
npm run make
```

Sur macOS, Forge produit une application et un DMG/ZIP non signés. Sur Windows, Forge produit un installateur Squirrel `.exe`. La signature et la notarisation demandent des certificats externes et ne sont pas réalisées par cette v0.

## Architecture

- `apps/desktop` : cycle de vie Electron, fenêtre sandboxée, dialogue natif et persistance ;
- `apps/server` : serveur HTTP local, authentification et API fichiers ;
- `apps/renderer` : interface React ;
- `packages/contracts` : schémas Zod et types partagés ;
- `packages/filesystem-policy` : confinement, validation, lecture et écriture atomique ;
- `tests` : unitaires, intégration et Electron E2E.

Voir aussi [l’architecture](docs/architecture.md), le [modèle de sécurité](docs/security.md) et le [guide de packaging](docs/packaging.md).
