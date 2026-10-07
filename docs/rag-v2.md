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

## Limites du produit

- 300 fichiers compatibles au maximum par espace, sélectionnés dans l’ordre de parcours ;
- 2 Mio par fichier texte et 20 Mio par PDF, Word ou Excel ; les images ne contribuent que leurs métadonnées et ne sont pas soumises à ce plafond binaire ;
- 3 millions de caractères de texte extrait au total, métadonnées d’images comprises ; un fichier qui ferait dépasser ce total est exclu entièrement, les fichiers suivants sont encore examinés ;
- texte, Word, feuilles Excel et PDF indexés localement ;
- textes en UTF-8, UTF-16 avec BOM ou Windows-1252, sans modification du fichier source ;
- images JPEG, PNG, GIF, WebP et BMP prévisualisables, indexées uniquement par nom,
  chemin relatif, format, taille et date de modification : aucune lecture du contenu
  visuel pour l’indexation, aucun OCR ni extraction EXIF ;
- PDF découpés par page (100 pages maximum par fichier), avec numéro de page conservé dans les citations ; un PDF plus long est exclu entièrement ;
- OCR français et anglais activé pour les pages scannées, sans envoi du document à un service d’extraction distant ;
- 10 feuilles au maximum par classeur et 100 000 caractères par feuille ; un dépassement exclut le classeur entier ;
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

Les réponses s’appuient sur cinq extraits au maximum. Les recherches peuvent manquer
des informations ; les totaux et comparaisons sur tout le dossier ne sont pas garantis
exhaustifs. Les sources des réponses et indicateurs doivent être vérifiées.

Les fichiers exclus restent visibles dans l’arborescence et un bandeau dans l’aperçu
précise le dépassement de taille ou rappelle la raison du dernier rapport d’indexation.
Les limites d’aperçu restent distinctes : 5 Mio pour le texte et 50 Mio pour les autres
formats. Au-delà, la fiche reste accessible avec un message d’aperçu indisponible.
L’aperçu Excel affiche les dix premières feuilles, 200 lignes et 50 colonnes.
Le menu **Aide → Limites du produit** rappelle ces plafonds et limites fonctionnelles.
Ils ne garantissent pas de durée de traitement : celle-ci dépend des documents,
du poste et du service IA.

Les appels OpenAI peuvent entraîner des coûts. Les réponses utilisent `store: false`, un délai maximal de 45 secondes et une seule relance réseau. Les journaux contiennent seulement les volumes, durées, identifiants internes et codes d’erreur, jamais les documents, questions, chemins absolus, clés ou secrets.

## Suivi, reprise et rapport

L’indexation affiche le recensement, l’extraction (OCR compris), les embeddings et
l’enregistrement, avec le fichier en cours, les compteurs et la durée. Le suivi
est actualisé chaque seconde pendant le traitement. L’interruption attend la fin
de l’opération en cours ; elle ne termine pas brutalement un parseur ou un appel réseau.

Le traitement conserve au maximum dix fichiers extraits par lot et commence un
nouveau lot après deux millions de caractères (un seul document peut dépasser ce
seuil). Chaque lot validé possède une génération de stockage et un point de reprise
persistant. Après une erreur ou un redémarrage, le bouton « Reprendre l’indexation »
réutilise ces lots si le corpus et le modèle sont inchangés. Sinon, le travail est
replanifié à partir de l’index publié. Le lot interrompu est recalculé.

L’ancien index reste publié jusqu’à la validation de la nouvelle génération et de
son manifeste. Les générations précédentes sont nettoyées après enregistrement.
Les magasins de documents, vecteurs et références sont chargés sans sauvegarde
automatique pendant le lot. Après calcul réussi, chacun est écrit une seule fois,
puis le point de reprise est validé. La phase « Enregistrement » couvre ces écritures.
Cette protection utilise encore le stockage JSON LlamaIndex et des copies locales :
elle exige temporairement davantage d’espace disque et ne remplace pas un futur
stockage transactionnel. Les vecteurs restent chargés en mémoire par LlamaIndex.

Le rapport local persiste après fermeture. Il contient la durée (interruptions
comprises), le nombre total de fichiers recensés, la liste des fichiers indexés et
toutes les exclusions avec leur code et leur raison : format non compatible,
plafond de 300 documents, fichier trop gros, dépassement de pages, de feuilles ou de texte, accès refusé, fichier disparu,
absence de texte ou extraction impossible. Il est disponible dans la configuration
du dossier et téléchargeable en texte. Les fichiers hors limites sont indiqués
comme non indexés avec une raison explicite, sans indexation partielle de leur contenu.
La qualité de l’OCR et l’extraction des formats bureautiques peuvent néanmoins perdre
des informations, notamment la mise en page ou les éléments non textuels.
Une erreur de parcours d’un dossier interrompt l’inventaire ; aucun rapport complet
n’est alors produit. Les chemins relatifs figurent dans ce rapport local, jamais
dans les journaux de suivi.

Les fichiers temporaires et de récupération (`~$*`, `.tmp`, `.asd`), sauvegardes
(`.bak`, `.backup`, suffixe `~`) et fichiers techniques (`.lnk`, `.bat`, `.cmd`,
`.joboptions`, `.dot`, `.dotx`, `.dotm`, `Thumbs.db`, `desktop.ini`, `.DS_Store`)
sont ignorés dès la lecture des dossiers. Ils ne figurent ni dans l’arborescence,
ni dans les compteurs, ni dans le rapport et ne consomment pas le plafond de fichiers.
Les documents sources restent présents sur disque. EPUB et ODT restent recensés
comme formats non pris en charge.

La politique d’indexation est versionnée. La première mise à jour d’un ancien index
reconstruit les textes et vecteurs pour appliquer les nouveaux plafonds. Les mises
à jour suivantes conservent le volume extrait des fichiers inchangés et réessaient
les fichiers exclus par le plafond global lorsque le corpus change.
Un point de reprise établi sous l’ancienne politique est replanifié depuis l’index publié.

## Vérification manuelle

1. Ouvrir un dossier contenant un fichier texte, Word, Excel ou PDF avec une valeur identifiable.
2. Vérifier que le service IA est disponible pour le compte connecté.
3. Lire l’avis de confidentialité, cocher le consentement et activer la fonction pour cet espace.
4. Indexer les documents, puis vérifier l’état **Index prêt**.
5. Poser une question factuelle et ouvrir les sources de la réponse ; pour un PDF, vérifier le numéro de page cité.
6. Épingler un champ structuré, actualiser l’indicateur, puis redémarrer l’application pour vérifier sa persistance.
7. Modifier le document source et relancer une question : l’index doit être reconstruit avant la réponse.
8. Désactiver la fonction ou supprimer l’index et vérifier que les documents sources n’ont pas changé.
