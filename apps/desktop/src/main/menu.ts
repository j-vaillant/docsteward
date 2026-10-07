import { app, dialog, Menu, type MenuItemConstructorOptions } from 'electron';
import { PRODUCT_LIMITS } from '@docsteward/contracts';

export function installApplicationMenu(): void {
  const isMac = process.platform === 'darwin';
  const about: MenuItemConstructorOptions = {
    label: 'À propos de DocSteward',
    click: () => {
      void dialog.showMessageBox({
        type: 'info',
        title: 'À propos de DocSteward',
        message: 'DocSteward',
        detail: `Version ${app.getVersion()}\nIndependentWeb`,
        buttons: ['Fermer'],
      });
    },
  };
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: 'DocSteward',
      submenu: [
        about,
        { type: 'separator' },
        { label: 'Services', role: 'services', submenu: [] },
        { type: 'separator' },
        { label: 'Masquer DocSteward', role: 'hide' },
        { label: 'Masquer les autres', role: 'hideOthers' },
        { label: 'Tout afficher', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quitter DocSteward', role: 'quit' },
      ],
    });
  }

  template.push(
    {
      label: '&Fichier',
      submenu: [
        { label: 'Fermer la fenêtre', role: 'close' },
        ...(!isMac
          ? ([
              { type: 'separator' },
              { label: 'Quitter', role: 'quit' },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: '&Édition',
      submenu: [
        { label: 'Annuler', role: 'undo' },
        { label: 'Rétablir', role: 'redo' },
        { type: 'separator' },
        { label: 'Couper', role: 'cut' },
        { label: 'Copier', role: 'copy' },
        { label: 'Coller', role: 'paste' },
        { label: 'Supprimer', role: 'delete' },
        { type: 'separator' },
        { label: 'Tout sélectionner', role: 'selectAll' },
      ],
    },
    {
      label: '&Affichage',
      submenu: [
        { label: 'Actualiser', role: 'reload' },
        { label: 'Forcer l’actualisation', role: 'forceReload' },
        { label: 'Outils de développement', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Taille réelle', role: 'resetZoom' },
        { label: 'Zoom avant', role: 'zoomIn' },
        { label: 'Zoom arrière', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Plein écran', role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Fe&nêtre',
      submenu: [
        { label: 'Réduire', role: 'minimize' },
        { label: 'Agrandir', role: 'zoom' },
        ...(isMac
          ? ([
              { type: 'separator' },
              { label: 'Tout ramener au premier plan', role: 'front' },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: 'Ai&de',
      submenu: [
        {
          label: 'Limites du produit',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'Limites du produit',
              message: 'Limites de DocSteward',
              detail: [
                `Questions et indicateurs : ${PRODUCT_LIMITS.indexedDocuments} fichiers compatibles par dossier, avec ${PRODUCT_LIMITS.indexCharacters.toLocaleString('fr-FR')} caractères de texte au total.`,
                `Fichiers texte : 2 Mio. PDF, Word et Excel : 20 Mio. PDF : ${PRODUCT_LIMITS.pdfPages} pages. Excel : ${PRODUCT_LIMITS.workbookSheets} feuilles et ${PRODUCT_LIMITS.sheetCharacters.toLocaleString('fr-FR')} caractères par feuille.`,
                'Un fichier dépassant ces plafonds est exclu entièrement de l’index et indiqué comme non indexé dans le rapport. Il reste visible dans l’arborescence avec un avertissement dans l’aperçu. L’aperçu est limité à 5 Mio pour le texte et 50 Mio pour les autres formats ; Excel affiche les 10 premières feuilles, 200 lignes et 50 colonnes.',
                `Classement IA : ${PRODUCT_LIMITS.sortedDocuments} documents au maximum par classement. Il utilise les noms, chemins, métadonnées et les 2 000 premiers caractères extraits. Lorsque le contenu est hors limites ou illisible, seules les métadonnées sont utilisées.`,
                'Les réponses utilisent au maximum cinq extraits et peuvent manquer des informations. Les totaux et comparaisons sur tout un dossier ne sont pas garantis exhaustifs. Vérifiez les sources des réponses et indicateurs.',
                'Les images sont indexées par leurs métadonnées uniquement, sans analyse visuelle ni OCR. L’OCR des PDF est en français et anglais ; sa fiabilité dépend de la qualité du scan.',
                'Ces plafonds ne garantissent pas un temps de traitement : les performances dépendent des documents, de l’ordinateur et du service IA. Les indicateurs sont actualisés à la demande.',
              ].join('\n\n'),
              buttons: ['Fermer'],
            });
          },
        },
        { type: 'separator' },
        about,
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
