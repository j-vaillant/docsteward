import { app, dialog, Menu, type MenuItemConstructorOptions } from 'electron';

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
    { label: 'Ai&de', submenu: [about] },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
