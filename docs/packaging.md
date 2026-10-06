# Packaging

`npm run package` crée l’application non distribuée dans `out/`. `npm run make` produit les artefacts de la plateforme courante.

## macOS

La configuration Forge inclut DMG et ZIP. Apple Silicon est l’architecture native prioritaire ; une build Intel doit être lancée sur une machine ou une CI compatible avec `--arch=x64`. Une distribution publique demande une identité Developer ID, la signature du bundle et des binaires, puis la notarisation Apple. Aucun certificat n’est inclus.

## Windows

Squirrel.Windows produit `DocSteward-Setup.exe`. Une distribution publique demande un certificat Authenticode. Un MSI d’entreprise est hors périmètre du MVP et pourra être ajouté avec un maker WiX dédié.

Le serveur compilé et les assets du renderer sont copiés dans les ressources de l’application. Aucun code exécutable n’est téléchargé au premier lancement.
