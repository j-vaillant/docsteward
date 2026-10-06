# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Electron, React, Vite, Fastify, TypeScript strict, Zod, Vitest et Playwright, imposés par la spécification produit.

## Users

Une personne qui travaille régulièrement avec un dossier local de documents hétérogènes et veut les parcourir et les consulter sans confier ses fichiers entiers à un service distant ni risquer de les modifier.

## Product Purpose

DocSteward fournit une bibliothèque desktop locale pour ouvrir un dossier explicitement autorisé, parcourir ses documents et les prévisualiser en lecture seule. Le succès du socle reste une boucle simple et fiable : choisir un dossier, sélectionner un fichier et le consulter immédiatement dans la vue principale. Une extension facultative permet ensuite d’interroger les documents autorisés, de relier les réponses à leurs sources et d’épingler des valeurs structurées comme indicateurs actualisables.

## Positioning

Le produit associe une expérience desktop traditionnelle à un serveur local isolé et authentifié, sans runtime, shell ni accès générique au système de fichiers. La consultation documentaire reste entièrement locale ; la recherche assistée est une capacité séparée, volontaire et configurée par espace, qui transmet uniquement les extraits nécessaires à OpenAI après consentement explicite.

## Operating Context

L'application est installée sur macOS ou Windows et exige un compte DocSteward activé par IndependentWeb. Son shell, son serveur sur loopback, ses index et ses dossiers autorisés fonctionnent sur la machine de l'utilisateur, avec une seule instance et des accès accordés par le sélecteur natif. Les documents pris en charge sont les PDF, les fichiers Word (`.doc`, `.docx`), les classeurs Excel (`.xls`, `.xlsx`) et les fichiers texte UTF-8. La prévisualisation est strictement non destructive. Les fonctions IA transmettent les seuls extraits nécessaires à IndependentWeb, qui relaie les appels vers OpenAI sans conserver les contenus par défaut.

## Capabilities and Constraints

- Sélection native et persistance de dossiers autorisés.
- Liste et prévisualisation en lecture seule des PDF, documents Word, classeurs Excel et fichiers texte autorisés.
- Empreinte SHA-256 affichée comme information d’intégrité.
- Aucun chemin absolu exposé au renderer.
- Recherche documentaire facultative par espace : accès IA fourni par le compte, consentement explicite, index local stocké hors du dossier source, réponses citées et indicateurs épinglables puis actualisables.
- Les fichiers sources restent en lecture seule. La recherche assistée peut transmettre à OpenAI les seuls extraits nécessaires aux embeddings et aux réponses ; cette transmission et les coûts possibles doivent être expliqués avant activation puis rester visibles dans la vue concernée.
- Aucun lien symbolique, aucune écriture dans les documents, création de document, shell, plugin, agent autonome ni accès générique au système de fichiers.
- Authentification de toutes les ressources locales par secret de session et politique CSP stricte.

## Brand Commitments

Le nom produit est DocSteward. Hypothèse à confirmer : la voix est calme, précise et protectrice, sans jargon inutile ni promesse marketing.

## Evidence on Hand

La spécification technique fournie reste la source de vérité du socle. L'implémentation de la vue Questions & indicateurs et ses captures approuvées établissent l'extension facultative de recherche assistée. Aucun logo, police de marque, contenu commercial, témoignage ou benchmark n'a été fourni et ne doit être inventé.

## Product Principles

- Local par construction.
- Autorisation explicite et minimale.
- La consultation ne peut jamais modifier le document source.
- Toute capacité distante est facultative, limitée à l’espace choisi et précédée d’un consentement compréhensible.
- Une réponse assistée reste vérifiable grâce à ses citations ; un indicateur conserve sa dernière valeur fiable si son actualisation échoue.
- Les états système sont compréhensibles et récupérables.
- L'outil s'efface devant le document.

## Accessibility & Inclusion

L'interface doit être entièrement utilisable au clavier, respecter les préférences de mouvement réduit, fournir des focus visibles et des contrastes conformes WCAG AA.
