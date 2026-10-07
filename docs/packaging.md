# Packaging

`npm run package` crée l’application non distribuée dans `out/`. `npm run make` produit les artefacts de la plateforme courante.

Pour une livraison de production complète, utilisez :

```bash
npm run make:prod
```

Cette commande utilise `https://api.independentweb.fr/docsteward` par défaut, refuse une URL non HTTPS ou locale, exécute les contrôles du projet, puis génère les artefacts. Pour cibler une autre API :

```bash
DOCSTEWARD_API_URL=https://api.example.com/docsteward npm run make:prod
```

`make:prod` ne modifie ni la version ni l'historique Git. Il peut être exécuté sur plusieurs OS après avoir extrait le même tag.

## Préparer une release

Renseignez d'abord les notes de la prochaine version dans `version.md`, puis lancez sur le premier OS l'une des commandes suivantes :

```bash
npm run make:prod:patch
npm run make:prod:minor
npm run make:prod:major
```

La commande choisie vérifie que seul `version.md` contient des modifications, met à jour `package.json` et `package-lock.json`, déplace les notes en tête de `changelog.md`, puis exécute tous les contrôles et construit l'artefact local. Après le succès du build, elle crée le commit et le tag annoté `vX.Y.Z`, puis les pousse ensemble et atomiquement vers `origin`.

Si un contrôle ou le build échoue, aucun commit ni tag n'est créé. Les fichiers de version préparés restent modifiés afin de permettre de corriger le problème et de contrôler les changements.

Pour construire le second OS, extrayez ensuite le tag créé sans demander de nouveau versionnement :

```bash
git checkout vX.Y.Z
npm ci
npm run make:prod
```

## macOS

La configuration Forge inclut DMG et ZIP. Apple Silicon est l’architecture native prioritaire ; une build Intel doit être lancée sur une machine ou une CI compatible avec `--arch=x64`. Une distribution publique demande une identité Developer ID, la signature du bundle et des binaires, puis la notarisation Apple. Aucun certificat n’est inclus.

## Windows

Squirrel.Windows produit `DocSteward-Setup.exe`. Le bundle et l'installateur utilisent `assets/icon.ico`, tandis que macOS utilise `assets/icon.icns`. Une distribution publique demande un certificat Authenticode. Un MSI d’entreprise est hors périmètre du MVP et pourra être ajouté avec un maker WiX dédié.

Le serveur compilé et les assets du renderer sont copiés dans les ressources de l’application. Les seuls binaires téléchargés ensuite sont les packages de mise à jour publiés par IndependentWeb.

## Mise à jour automatique

Au démarrage d’une application installée, DocSteward interroge l’endpoint public `GET /docsteward/builds`. Si un artefact plus récent de type `package` existe pour la plateforme courante, une boîte de dialogue native propose la mise à jour. Après validation, le package est téléchargé en arrière-plan, vérifié par sa taille, puis installé par `autoUpdater` au moyen de Squirrel. L’application redémarre automatiquement lorsque la mise à jour est prête.

Publiez le ZIP produit par le maker Forge comme package macOS et le fichier `*-full.nupkg` comme package Windows. Les DMG et `Setup.exe` restent les installateurs présentés sur le site vitrine.

L’auto-update macOS impose une application signée, conformément aux exigences de Squirrel.Mac. Windows doit avoir été installé avec `DocSteward-Setup.exe` afin que `Update.exe` et le mécanisme Squirrel soient disponibles.
