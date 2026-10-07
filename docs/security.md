# Sécurité

## Limites de confiance

- Le renderer est sandboxé, sans Node.js, avec isolation de contexte.
- Le preload n’expose que quatre actions typées et aucun objet Electron générique.
- Chaque appel IPC vérifie l’origine du frame.
- Toutes les ressources HTTP exigent un secret aléatoire de session.
- Les API métier locales exigent également une connexion à un compte DocSteward activé.
- `Host` et `Origin` sont comparés à l’origine loopback exacte.
- Les permissions, fenêtres et navigations externes sont refusées.

## Fichiers

Le client envoie un `workspaceId` et un chemin relatif. Les chemins absolus, UNC, préfixes de lecteur, segments `..`, antislashs et octets NUL sont rejetés. Chaque composant existant est inspecté avec `lstat` et les liens symboliques sont refusés. Les lectures sont UTF-8 et limitées à 5 Mio.

Les écritures utilisent un fichier temporaire dans le même dossier, `fsync`, une seconde vérification du hash puis `rename`. Un hash périmé renvoie `FS_CONFLICT` sans modifier la cible.

## Journaux

Les journaux ne contiennent ni secret, ni contenu, ni chemin absolu. Une rotation simple intervient à 1 Mo. Les erreurs retournent un identifiant de corrélation.

## Service distant

`DOCSTEWARD_API_URL` est une URL publique et ne contient aucun secret. Le processus principal Electron y échange les identifiants contre un JWT dédié à DocSteward. Ni le JWT ni les identifiants ne sont exposés au renderer. La clé OpenAI reste chiffrée côté `independentweb-api` ; seuls les extraits nécessaires aux fonctions IA transitent par IndependentWeb puis OpenAI.

Le jeton et les informations du compte sont conservés dans `auth-session.enc`, sous `userData`, chiffrés par `safeStorage` (DPAPI sous Windows, trousseau système sous macOS). Aucun mot de passe n’est sauvegardé. Le processus principal restaure la session avant de démarrer le serveur local, vérifie l’URL du service et l’expiration du JWT, puis recharge les dossiers du compte. Un fichier invalide ou une session expirée est supprimé ; la déconnexion supprime également ce fichier. Aucun renouvellement de jeton n’est effectué : les appels distants restent soumis à la validation du service.

## Limites connues

Le modèle protège l’application contre un site local ou distant opportuniste, pas contre un autre processus déjà capable de lire la mémoire du compte utilisateur. La robustesse de `rename` lors du remplacement d’un fichier existant dépend des garanties du système de fichiers hôte.
