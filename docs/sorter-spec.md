# Le Sorter — spécification du POC

Statut : proposition révisée prête à valider  
Périmètre : renderer, contrats partagés, serveur local, indexation et tests  
Mode : organisation virtuelle en lecture seule, interprétation assistée par OpenAI

## 1. Résumé

Le Sorter permet à l'utilisateur de décrire en français l'organisation qu'il souhaite donner aux documents d'un dossier. DocSteward transforme cette intention en règles puis en un mapping entre l'arborescence physique du disque et une arborescence virtuelle.

L'arborescence physique n'est jamais modifiée. Aucun fichier ni dossier n'est créé, renommé, déplacé ou supprimé. La bibliothèque affiche un unique arbre virtuel par espace de travail et conserve le chemin physique comme information de provenance.

À l'initialisation, l'arbre virtuel est strictement isomorphe à l'arbre physique : chaque fichier possède le même chemin visible que sur le disque. L'utilisateur décrit ensuite une organisation, inspecte l'arbre proposé, puis active le mapping. À chaque réindexation, DocSteward rejoue les règles sur l'inventaire physique courant et remplace l'arbre virtuel en mémoire.

Le POC persiste les règles, le mapping et l'arbre virtuel actif dans les données privées de l'application. Au redémarrage, chaque espace de travail retrouve son organisation ; si son contenu physique a changé, l'arbre est présenté comme obsolète jusqu'à sa réindexation.

## 2. Proposition produit

Le Sorter n'est pas un gestionnaire de fichiers. C'est une **vue éditoriale temporaire** du fonds documentaire.

Cette séparation garantit que :

- le disque reste intact et utilisable par toutes les autres applications ;
- l'organisation peut être recalculée ou abandonnée sans rollback ;
- la bibliothèque reste strictement en lecture seule ;
- l'utilisateur peut explorer une nouvelle organisation sans risque matériel.

Le mot **déplacer** désigne uniquement un changement de position dans l'arbre virtuel. L'interface ne doit jamais laisser entendre qu'un fichier a été déplacé sur le disque.

## 3. Périmètre du POC

### Inclus

- Une consigne libre décrivant l'organisation souhaitée.
- Un seul arbre virtuel par espace de travail.
- Une seule proposition en cours à la fois.
- Un aperçu complet avant activation.
- Un mapping exhaustif entre chaque document physique et son chemin virtuel.
- Le rejeu des règles à chaque réindexation.
- La persistance locale de l'organisation active après redémarrage.
- Le retour immédiat à l'arbre physique.
- L'ouverture des documents réels depuis leur position virtuelle.
- Le consentement explicite avant tout envoi à OpenAI.

### Hors périmètre

- Toute écriture dans l'espace de travail.
- Création, déplacement, renommage, copie ou suppression physique.
- Historique, versions ou restauration d'anciens arbres.
- Plusieurs arbres virtuels pour un même espace de travail.
- Glisser-déposer ou édition manuelle de l'arbre.
- Partage, export ou synchronisation d'une organisation.
- Surveillance continue du système de fichiers.
- Support des liens symboliques.

## 4. Modèle conceptuel

Le POC distingue trois objets.

### 4.1 Arbre physique

L'arbre physique est la source de vérité du disque. Il est découvert en lecture seule à partir du workspace autorisé. Chaque entrée possède un chemin relatif, des métadonnées et une empreinte. Aucun chemin absolu n'est exposé au renderer.

### 4.2 Règles de classement

Les règles décrivent l'organisation demandée. Elles contiennent :

- la consigne originale ;
- une reformulation structurée et lisible ;
- une liste ordonnée de règles ;
- une stratégie de repli pour les documents non classés.

Les règles et le mapping actif sont enregistrés dans les données locales de DocSteward. Ils sont rechargés au démarrage, remplacés lorsqu'une nouvelle proposition est activée et supprimés lors du retour à l'organisation d'origine.

### 4.3 Mapping et arbre virtuel

Le mapping relie chaque document physique indexé à un chemin virtuel :

```text
documentId + physicalRelativePath -> virtualPath
```

Les dossiers virtuels sont dérivés des segments de `virtualPath`. Ils n'existent pas sur le disque.

Le mapping actif et l'arbre qui en découle sont conservés en mémoire et persistés dans les données locales de l'application. Leur remplacement est atomique : le renderer voit soit l'ancien arbre complet, soit le nouveau, jamais un état intermédiaire.

## 5. Invariants

1. **Le disque est immuable.** Le Sorter ne demande jamais un accès `read-write`.
2. **Un dossier, un arbre virtuel.** Un workspace ne peut avoir qu'un mapping actif.
3. **Un document, une position virtuelle.** Chaque fichier indexé apparaît exactement une fois.
4. **Aucun document ne disparaît.** Un document non classé conserve son chemin physique dans l'arbre virtuel et porte l'état `à classer`.
5. **Le premier arbre est identitaire.** Sans règles actives, `virtualPath === physicalRelativePath`.
6. **Le modèle propose, le serveur valide.** Toute sortie d'OpenAI est traitée comme une donnée non fiable.
7. **La réindexation publie un arbre complet.** Un échec conserve l'arbre actif et le marque obsolète.
8. **Le retour à l'origine est immédiat.** Désactiver le Sorter régénère localement le mapping identitaire.
9. **Le redémarrage conserve l'organisation.** L'organisation virtuelle active est restaurée depuis les données locales de l'application.

## 6. Parcours utilisateur

Le Sorter devient une vue principale au même niveau que Questions et Indicateurs. Le file tree demeure visible et reflète toujours l'arbre virtuel actif.

### 6.1 État initial

Lorsqu'un espace de travail est ouvert :

- l'arbre virtuel reproduit exactement la structure physique ;
- son en-tête indique discrètement **« Organisation d'origine »** ;
- l'inspecteur affiche le chemin relatif sur le disque ;
- la vue Sorter propose **« Créer une organisation virtuelle »**.

L'utilisateur peut employer DocSteward normalement sans connaître le concept de mapping.

### 6.2 Décrire l'organisation

La vue présente :

- l'espace de travail actif et le nombre de documents indexables ;
- une zone de texte **« Comment souhaitez-vous organiser vos documents ? »** ;
- quelques exemples courts, sans préremplir le champ ;
- la notice de confidentialité correspondant au consentement IA ;
- l'action principale **« Préparer l'organisation »**.

Exemple de consigne :

> Classe les factures par année et fournisseur. Regroupe les contrats par client. Laisse les autres documents dans leur dossier actuel.

Le bouton est désactivé si la consigne contient moins de 10 caractères, si aucune clé OpenAI valide n'est configurée ou si le consentement IA n'est pas actif pour cet espace.

Le consentement précise que les noms, chemins relatifs, métadonnées et extraits nécessaires peuvent être transmis à OpenAI pour construire et rejouer l'organisation. Il affirme explicitement que les fichiers et dossiers sur le disque ne seront jamais modifiés.

### 6.3 Génération

Trois phases sont visibles :

1. **Inventaire local** ;
2. **Interprétation des règles** ;
3. **Construction de l'arbre virtuel**.

La consigne devient temporairement non modifiable. L'utilisateur peut annuler. Une erreur rend la consigne à nouveau modifiable et ne remplace pas l'arbre actif.

### 6.4 Prévisualisation

La composition conserve la structure en trois parties du produit :

- **marge gauche :** consigne, règles proposées et résumé ;
- **surface centrale :** nouvel arbre virtuel ;
- **marge droite :** détail du nœud sélectionné, chemins physique et virtuel, justification.

Les différences sont formulées comme des effets d'affichage :

- **Classé ailleurs** si le groupe virtuel diffère ;
- **Nom d'affichage adapté** si le nom virtuel diffère ;
- **Identique à l'origine** si le chemin reste inchangé ;
- **À classer** si aucune règle n'a fourni de destination.

Les dossiers virtuels sont appelés **groupes**, jamais « dossiers à créer ».

Le résumé indique :

- nombre de groupes virtuels ;
- nombre de documents reclassés ;
- nombre de noms d'affichage adaptés ;
- nombre de documents inchangés ;
- nombre de documents à classer ;
- nombre de blocages.

Actions disponibles :

- **Modifier la consigne** ;
- **Recalculer la proposition** ;
- **Utiliser cette organisation** si aucun blocage n'existe.

### 6.5 Activation

La validation est informative, pas destructive :

> Cette organisation remplacera l'arborescence affichée dans DocSteward, y compris après un redémarrage. Vos fichiers et dossiers resteront exactement à leur emplacement actuel sur le disque. Les règles seront rejouées lors des prochaines réindexations.

L'action principale est **« Utiliser cette organisation »**. L'action secondaire est **« Revenir à l'aperçu »**.

Après activation :

- le mapping proposé remplace atomiquement le mapping actif ;
- le file tree bascule immédiatement vers l'organisation virtuelle ;
- le nombre de documents et l’éventuel état de réindexation restent visibles au-dessus de l’arborescence ;
- un message confirme **« Organisation activée — aucun fichier déplacé »**.

### 6.6 Utilisation quotidienne

Le chemin virtuel devient la navigation principale dans DocSteward. La sélection d'un document résout son `documentId` vers son chemin physique courant avant de demander l'aperçu au serveur.

L'inspecteur distingue :

- **Dans DocSteward** : chemin virtuel ;
- **Sur le disque** : chemin relatif physique ;
- **Classement** : règle ou justification appliquée.

Une action **« Voir l'organisation d'origine »** affiche temporairement l'arbre physique sans supprimer les règles actives.

### 6.7 Remplacer ou désactiver

La vue Sorter permet soit de préparer une nouvelle organisation, soit de revenir à l'organisation d'origine.

Activer une nouvelle proposition remplace l'unique arbre virtuel courant. Aucun historique n'est conservé.

Le retour à l'origine affiche :

> DocSteward affichera de nouveau l'organisation réelle du disque. Aucun fichier ne sera modifié.

Après confirmation, les règles et le mapping personnalisés sont supprimés de la mémoire et du stockage local, puis l'arbre identitaire est reconstruit localement.

## 7. Réindexation et rejeu

La réindexation orchestre l'inventaire physique, l'index RAG et l'arbre virtuel.

### 7.1 Pipeline

1. Scanner l'arbre physique en lecture seule.
2. Construire le manifest avec chemins relatifs, empreintes et métadonnées.
3. Réconcilier les documents avec leurs identifiants de session.
4. Extraire et indexer les contenus pris en charge.
5. Si des règles sont actives, les rejouer sur l'inventaire courant.
6. Appliquer localement le repli identitaire aux documents non classés.
7. Valider l'exhaustivité et l'unicité du mapping.
8. Remplacer atomiquement le mapping en mémoire et dans le stockage local.
9. Notifier le renderer et rafraîchir le file tree sans perdre la sélection si le document existe toujours.

Sans règles actives, le serveur produit localement un mapping identitaire et ne fait aucun appel OpenAI pour le Sorter.

### 7.2 Évolution du dossier physique

- **Nouveau fichier :** les règles sont appliquées ; sans résultat, il conserve son chemin physique et devient `à classer`.
- **Fichier supprimé :** il disparaît du nouvel arbre.
- **Fichier renommé ou déplacé hors de DocSteward :** il est réconcilié par son empreinte lorsque cela reste non ambigu, sinon traité comme nouveau.
- **Contenu modifié :** il est réindexé et peut recevoir une nouvelle destination virtuelle.
- **Échec de classification :** l'arbre actif reste visible, passe à l'état `obsolète` et propose **« Réessayer »**.

### 7.3 Stabilité

Le rejeu reçoit la destination virtuelle précédente comme contexte. À règles et document inchangés, le fournisseur doit conserver la destination précédente. Les appels utilisent une sortie JSON stricte et des paramètres favorisant la stabilité.

Cette stabilité n'est pas une garantie mathématique. Après chaque réindexation, l'interface signale donc combien de documents ont changé de position virtuelle.

## 8. Données envoyées à OpenAI

Pour chaque document, le serveur peut utiliser :

- un identifiant opaque ;
- le chemin physique relatif ;
- le nom, l'extension, la taille et la date de modification ;
- une empreinte SHA-256 conservée localement ;
- des métadonnées et un extrait borné ;
- la destination virtuelle précédente.

OpenAI reçoit uniquement les éléments autorisés par le consentement. Aucun chemin absolu, secret, journal ou contenu intégral par défaut n'est transmis.

Limites du POC :

- maximum 200 documents ;
- maximum 2 000 caractères d'extrait par document ;
- maximum 2 Mio de texte cumulé ;
- au-delà, génération bloquée sans échantillonnage silencieux.

La réponse du modèle référence les documents uniquement par `documentId`. Les chemins virtuels finaux sont normalisés et validés localement.

Les fichiers texte dépassant 2 Mio et les PDF/Word/Excel dépassant 20 Mio participent
au classement uniquement par leurs métadonnées. Les plafonds d’extraction sont
100 pages par PDF, 10 feuilles par classeur et 100 000 caractères par feuille ; un
dépassement empêche l’utilisation du contenu du fichier pour le classement.

## 9. Contrats partagés

```ts
type VirtualTreeStatus =
  | 'identity'
  | 'generating'
  | 'preview'
  | 'active'
  | 'reindexing'
  | 'stale'
  | 'error';

type VirtualRule = {
  id: string;
  order: number;
  title: string;
  description: string;
  targetPattern: string;
  fallback: boolean;
};

type VirtualMappingEntry = {
  documentId: string;
  physicalRelativePath: string;
  physicalSha256: string;
  virtualPath: string;
  status: 'mapped' | 'identity' | 'unclassified';
  ruleId?: string;
  reason?: string;
};

type VirtualTree = {
  schemaVersion: 1;
  workspaceId: string;
  status: VirtualTreeStatus;
  instruction: string | null;
  rules: VirtualRule[];
  inventoryFingerprint: string;
  generatedAt: string;
  entries: VirtualMappingEntry[];
  summary: {
    documents: number;
    groups: number;
    mapped: number;
    identity: number;
    unclassified: number;
  };
};
```

Il n'existe ni `treeId`, ni historique, ni numéro de révision dans le POC : `workspaceId` identifie l'unique arbre virtuel actif.

## 10. API locale

### `GET /api/virtual-tree`

Entrée : `workspaceId`, mode `active` ou `physical`.  
Retourne l'unique arbre actif. Le mode `physical` produit une vue identitaire temporaire.

### `POST /api/virtual-tree/preview`

Entrée : `workspaceId`, `instruction`.  
Génère une proposition en mémoire sans remplacer l'arbre actif. Une seconde demande annule ou remplace la proposition précédente.

### `GET /api/virtual-tree/preview`

Entrée : `workspaceId`.  
Retourne la proposition courante, sa progression, ses règles, ses blocages et son résumé.

### `DELETE /api/virtual-tree/preview`

Abandonne la proposition courante sans affecter l'arbre actif.

### `POST /api/virtual-tree/activate`

Entrée : `workspaceId`, `inventoryFingerprint`.  
Revalide puis remplace atomiquement l'unique arbre actif par la proposition. L'appel est idempotent pour une même proposition.

### `POST /api/virtual-tree/reindex`

Entrée : `workspaceId`.  
Rejoue les règles sur l'inventaire courant et persiste le nouvel arbre. Le flux d'indexation documentaire existant peut appeler cette orchestration directement.

### `DELETE /api/virtual-tree`

Entrée : `workspaceId`.  
Supprime règles, proposition et mapping personnalisés de la mémoire et du stockage local, puis restaure l'arbre identitaire.

Toutes les routes utilisent l'authentification locale existante, vérifient `Host` et `Origin` et retournent les enveloppes `ApiSuccess` / `ApiFailure` existantes.

## 11. Validation locale

Avant de publier un mapping, le serveur vérifie :

- que chaque `documentId` appartient au workspace et apparaît exactement une fois ;
- qu'aucun document inventé par le modèle n'est introduit ;
- que tous les documents physiques éligibles possèdent une entrée ;
- que chaque chemin virtuel est relatif, normalisé et borné ;
- qu'aucun segment vide, `.`, `..`, antislash ou octet NUL n'est accepté ;
- que les segments sont normalisés en Unicode NFC ;
- que deux documents n'occupent pas le même chemin virtuel ;
- que la profondeur, le nombre de groupes et la longueur des libellés restent utilisables ;
- que les chemins physiques du mapping proviennent toujours de l'inventaire local.

Les chemins virtuels restent portables entre macOS et Windows. Les collisions sont vérifiées sans tenir compte de la casse. Une collision bloque l'aperçu ou place les documents concernés dans `à classer` lors d'une réindexation automatique.

## 12. Cohérence avec le RAG et la bibliothèque

- Le manifest physique reste la source de vérité de l'index documentaire.
- Les citations et aperçus utilisent `documentId`, résolu côté serveur vers le chemin physique courant.
- Les réponses affichent de préférence le chemin virtuel, avec la provenance physique dans les détails.
- Une réindexation réussie rejoue les règles avant de publier l'état `ready`.
- Une erreur de rejeu n'invalide pas l'index documentaire ; seul l'arbre virtuel passe à `stale`.
- Changer l'organisation virtuelle ne reconstruit pas les embeddings.
- Fermer le serveur ou l'application efface règles, proposition et mapping virtuel personnalisés.

## 13. Erreurs publiques

- `VIRTUAL_TREE_CONSENT_REQUIRED`
- `VIRTUAL_TREE_LIMIT_EXCEEDED`
- `VIRTUAL_TREE_MODEL_UNAVAILABLE`
- `VIRTUAL_TREE_RESPONSE_INVALID`
- `VIRTUAL_TREE_PREVIEW_NOT_FOUND`
- `VIRTUAL_TREE_PREVIEW_STALE`
- `VIRTUAL_TREE_MAPPING_INCOMPLETE`
- `VIRTUAL_TREE_PATH_INVALID`
- `VIRTUAL_TREE_COLLISION`
- `VIRTUAL_TREE_REINDEX_FAILED`

Chaque erreur propose une action de récupération et un identifiant de corrélation. Aucun chemin absolu n'est exposé.

## 14. Accessibilité

- Le file tree suit les conventions clavier `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home` et `End`.
- Le focus et la sélection sont conservés par `documentId` lors du remplacement de l'arbre.
- Les changements de phase utilisent une région `aria-live` non intrusive.
- Les statuts ne reposent jamais uniquement sur la couleur.
- Les chemins physique et virtuel portent des libellés explicites.
- Les noms tronqués restent accessibles en entier.
- À largeur compacte, le détail devient un panneau secondaire et l'arbre reste prioritaire.

## 15. Tests requis

### Unitaires

- génération du mapping identitaire ;
- validation et normalisation des chemins virtuels ;
- collisions sensibles et insensibles à la casse ;
- exhaustivité et unicité du mapping ;
- stratégie de repli `à classer` ;
- calcul des résumés et empreintes ;
- réconciliation des documents après modification physique externe ;
- remplacement atomique de l'arbre en mémoire et dans le stockage local.

### Intégration serveur

- génération avec un fournisseur OpenAI simulé ;
- rejet d'un `documentId` inconnu ou d'un mapping incomplet ;
- activation sans écriture dans le workspace ;
- conservation de l'arbre actif pendant la génération ;
- rejeu après ajout, suppression, renommage et modification externes ;
- conservation du dernier arbre après échec du modèle ;
- retour exact à l'arbre physique ;
- restauration de l'organisation après redémarrage du serveur ;
- absence de chemins absolus, contenus et consignes dans les logs.

### End-to-end Electron

- arbre initial identique au disque ;
- consentement, consigne, génération, aperçu et activation ;
- file tree virtuel après activation ;
- ouverture du bon fichier physique depuis son chemin virtuel ;
- affichage conjoint des chemins virtuel et physique ;
- réindexation et intégration d'un nouveau document ;
- arbre obsolète après un échec de rejeu ;
- consultation temporaire de l'organisation d'origine ;
- retour à l'origine sans changement sur le disque ;
- restauration de l'organisation au redémarrage ;
- navigation clavier et conservation de la sélection.

Les tests automatisés n'utilisent jamais une vraie clé OpenAI ni un appel réseau. Ils vérifient l'intégrité du workspace avant et après chaque scénario.

## 16. Critères d'acceptation

Le POC est accepté lorsque :

1. un workspace affiche initialement un arbre virtuel identique à son arbre physique ;
2. un workspace ne peut avoir qu'un seul arbre virtuel actif ;
3. l'utilisateur peut décrire une organisation et obtenir un aperçu sans modification du disque ;
4. chaque document physique éligible apparaît exactement une fois ;
5. la validation remplace le file tree de manière atomique ;
6. l'interface affirme clairement qu'aucun fichier n'a été déplacé ou renommé ;
7. ouvrir un fichier virtuel résout toujours le bon fichier physique ;
8. une réindexation rejoue les règles sur les documents ajoutés ou modifiés ;
9. un document non classé reste visible avec son chemin physique comme repli ;
10. un échec conserve l'arbre actif et le signale comme obsolète ;
11. revenir à l'origine restaure immédiatement l'arbre physique ;
12. redémarrer l'application restaure l'organisation personnalisée ;
13. le workspace reste strictement en lecture seule ;
14. OpenAI ne reçoit aucun chemin absolu et le renderer ne reçoit jamais la clé API ;
15. les tests prouvent qu'aucune route du Sorter n'écrit dans le workspace.

## 17. Après le POC

- historique et versions d'une organisation ;
- plusieurs organisations enregistrées ;
- édition manuelle et glisser-déposer ;
- tags transverses et présence d'un document dans plusieurs branches ;
- export, partage ou synchronisation ;
- moteur de règles entièrement local ;
- rejeu incrémental optimisé ;
- validation manuelle des changements après chaque réindexation.
