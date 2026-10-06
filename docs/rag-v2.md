# RAG documentaire et indicateurs

La v2 ajoute une recherche documentaire opt-in par espace de travail. Les documents sources restent en lecture seule. L’index, son manifeste, les consentements et les indicateurs sont enregistrés dans le répertoire de données de DocSteward, jamais dans le dossier documentaire.

## Configuration

La clé OpenAI est associée au compte dans `independentweb-api` et chiffrée dans la base DocSteward. Elle n’est jamais transmise à l’application. Le serveur local utilise le JWT de session auprès du proxy OpenAI d’IndependentWeb ; ce jeton n’est jamais renvoyé au renderer.

Les modèles peuvent être enregistrés dans **Questions & indicateurs → Paramètres IA**. Ce réglage local est prioritaire sur les variables `OPENAI_GENERATION_MODEL` et `OPENAI_EMBEDDING_MODEL`, puis sur les valeurs par défaut `gpt-5-mini` et `text-embedding-3-small`. En développement, DocSteward charge automatiquement `.env.local` à la racine du projet ; `.env.example` sert de modèle et ne contient aucun secret. Un changement de modèle d’embeddings marque l’index existant comme périmé afin qu’il soit reconstruit avant la requête suivante. Le nombre de fragments est limité à 5.

Versions intégrées et vérifiées avec Node 24 / Electron 44 :

- `llamaindex` 0.12.1 ;
- `@llamaindex/openai` 0.4.22, aligné sur le core LlamaIndex de cette version ;
- `@llamaindex/liteparse` 2.15.1 pour extraire localement les PDF, avec OCR Tesseract local ;
- `openai` 7.28.0.

Le code du serveur produit fait environ 10 Mio non compressé. Le runtime natif LiteParse/PDFium ajoute environ 33 Mio pour la plateforme ciblée. Aucun de ces paquets n’est inclus dans le bundle renderer.

## Limites initiales

- 1 000 fichiers compatibles au maximum par espace ;
- texte, Word, feuilles Excel et PDF indexés localement ;
- PDF découpés par page (500 pages maximum par fichier), avec numéro de page conservé dans les citations ;
- OCR français et anglais activé pour les pages scannées, sans envoi du document à un service d’extraction distant ;
- 20 feuilles au maximum par classeur et 500 000 caractères par feuille ;
- 60 000 caractères de contexte au maximum par requête ;
- contrôle léger avant une requête à partir des chemins, tailles et dates de modification, sans
  réextraire les PDF ou fichiers bureautiques ;
- mise à jour différentielle lorsqu’un fichier compatible est ajouté, modifié ou supprimé : seuls
  les fragments concernés sont supprimés ou recalculés ;
- reconstruction complète réservée à la première indexation, à une migration de format ou à un
  changement de modèle d’embeddings ;
- mise à jour manuelle déclenchable depuis la configuration du dossier ;
- index vectoriel conservé en mémoire entre les requêtes d’une même session ;
- actualisation des indicateurs uniquement à la demande.

Les appels OpenAI peuvent entraîner des coûts. Les réponses utilisent `store: false`, un délai maximal de 45 secondes et une seule relance réseau. Les journaux contiennent seulement les volumes, durées, identifiants internes et codes d’erreur, jamais les documents, questions, chemins absolus, clés ou secrets.

## Vérification manuelle

1. Ouvrir un dossier contenant un fichier texte, Word, Excel ou PDF avec une valeur identifiable.
2. Vérifier que le service IA est disponible pour le compte connecté.
3. Lire l’avis de confidentialité, cocher le consentement et activer la fonction pour cet espace.
4. Indexer les documents, puis vérifier l’état **Index prêt**.
5. Poser une question factuelle et ouvrir les sources de la réponse ; pour un PDF, vérifier le numéro de page cité.
6. Épingler un champ structuré, actualiser l’indicateur, puis redémarrer l’application pour vérifier sa persistance.
7. Modifier le document source et relancer une question : l’index doit être reconstruit avant la réponse.
8. Désactiver la fonction ou supprimer l’index et vérifier que les documents sources n’ont pas changé.
