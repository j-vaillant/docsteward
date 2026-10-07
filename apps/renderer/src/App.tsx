import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AuthState,
  Indicator,
  PreviewResult,
  RagAnswer,
  RagField,
  RagStatus,
  VirtualMappingEntry,
  VirtualTree,
  WorkspaceSummary,
} from '@docsteward/contracts';
import { ApiError, api } from './api';
import brandMarkUrl from './assets/docsteward-mark.svg';
import changelogMarkdown from '../../../changelog.md?raw';
import { parseChangelog } from './changelog';
import { formatIndicatorValue } from './format';
import { SorterPanel } from './SorterPanel';

const changelogReleases = parseChangelog(changelogMarkdown);

function fileExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mio`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

function formatLabel(extension: string): string {
  if (extension === '.doc' || extension === '.docx') return 'Word';
  if (extension === '.xls' || extension === '.xlsx') return 'Excel';
  if (extension === '.pdf') return 'PDF';
  return 'Texte';
}

function Icon({
  name,
}: {
  name: 'book' | 'folder' | 'file' | 'chevron' | 'check' | 'shield' | 'close' | 'info';
}) {
  const paths = {
    book: (
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 0 4 21.5Zm16 0A2.5 2.5 0 0 0 17.5 3H12v16h5.5a2.5 2.5 0 0 1 2.5 2.5Z" />
    ),
    folder: (
      <path d="M3 6.5h7l2 2h9v10.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm0 0v-.5a2 2 0 0 1 2-2h5l2 2" />
    ),
    file: <path d="M7 3h7l4 4v14H7Zm7 0v5h4" />,
    chevron: <path d="m9 6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    shield: <path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6Zm-4 9 2.5 2.5L16 9" />,
    close: <path d="m7 7 10 10M17 7 7 17" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7.5v.5" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`icon icon-${name}`}>
      {paths[name]}
    </svg>
  );
}

function BrandMark({ className = '' }: { className?: string }) {
  return (
    <img
      className={`brand-logo${className ? ` ${className}` : ''}`}
      src={brandMarkUrl}
      alt=""
      aria-hidden="true"
    />
  );
}

function accountInitials(email: string): string {
  const localPart = email.split('@')[0] ?? email;
  const parts = localPart.split(/[._+-]+/).filter(Boolean);
  const initials =
    parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : localPart.slice(0, 2);
  return initials.toLocaleUpperCase('fr-FR');
}

function ProfileMenu({ email, onLogout }: { email: string; onLogout: () => Promise<void> }) {
  return (
    <details className="profile-menu">
      <summary role="button" aria-haspopup="menu" aria-label={`Compte de ${email}`} title={email}>
        <span className="profile-avatar" aria-hidden="true">
          {accountInitials(email)}
        </span>
      </summary>
      <div className="profile-popover">
        <div className="profile-identity">
          <span>Compte connecté</span>
          <strong>{email}</strong>
        </div>
        <button type="button" onClick={() => void onLogout()}>
          Se déconnecter
        </button>
      </div>
    </details>
  );
}

type TreeProps = {
  tree: VirtualTree | null;
  selectedPath?: string;
  onOpen: (path: string) => void;
};

type VirtualNode =
  | { type: 'group'; name: string; path: string; depth: number }
  | { type: 'document'; name: string; path: string; depth: number; entry: VirtualMappingEntry };

function virtualNodes(tree: VirtualTree, expanded: Set<string>): VirtualNode[] {
  const groups = new Set<string>();
  for (const entry of tree.entries) {
    const parts = entry.virtualPath.split('/');
    for (let index = 1; index < parts.length; index += 1)
      groups.add(parts.slice(0, index).join('/'));
  }
  const result: VirtualNode[] = [];
  const visit = (parent: string, depth: number) => {
    const prefix = parent ? `${parent}/` : '';
    const childGroups = [...groups]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
    const documents = tree.entries
      .filter((entry) => {
        const index = entry.virtualPath.lastIndexOf('/');
        return (index < 0 ? '' : entry.virtualPath.slice(0, index)) === parent;
      })
      .sort((a, b) => a.virtualPath.localeCompare(b.virtualPath, 'fr', { sensitivity: 'base' }));
    for (const path of childGroups) {
      result.push({ type: 'group', name: path.split('/').at(-1) ?? path, path, depth });
      if (expanded.has(path)) visit(path, depth + 1);
    }
    for (const entry of documents)
      result.push({
        type: 'document',
        name: entry.virtualPath.split('/').at(-1) ?? entry.virtualPath,
        path: entry.virtualPath,
        depth,
        entry,
      });
  };
  visit('', 0);
  return result;
}

function FileTree({ tree, selectedPath, onOpen }: TreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const container = useRef<HTMLDivElement>(null);
  const nodes = useMemo(() => (tree ? virtualNodes(tree, expanded) : []), [tree, expanded]);

  const toggle = (path: string, open?: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (open === false || (open === undefined && next.has(path))) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleKey = (event: React.KeyboardEvent<HTMLButtonElement>, node: VirtualNode) => {
    const buttons = [
      ...(container.current?.querySelectorAll<HTMLButtonElement>('button.tree-item') ?? []),
    ];
    const index = buttons.indexOf(event.currentTarget);
    if (event.key === 'ArrowDown') buttons[Math.min(index + 1, buttons.length - 1)]?.focus();
    else if (event.key === 'ArrowUp') buttons[Math.max(index - 1, 0)]?.focus();
    else if (event.key === 'Home') buttons[0]?.focus();
    else if (event.key === 'End') buttons.at(-1)?.focus();
    else if (event.key === 'ArrowRight' && node.type === 'group') toggle(node.path, true);
    else if (event.key === 'ArrowLeft' && node.type === 'group') toggle(node.path, false);
    else return;
    event.preventDefault();
  };

  return (
    <div
      className="tree virtual-tree"
      role="tree"
      aria-label="Organisation des documents"
      ref={container}
    >
      <div className="tree-mode">
        <span className="tree-mode-meta">
          {tree ? (
            <span className="tree-count">
              {tree.summary.documents} document{tree.summary.documents === 1 ? '' : 's'} indexable
              {tree.summary.documents === 1 ? '' : 's'}
            </span>
          ) : null}
          {tree?.status === 'stale' ? <strong>À actualiser</strong> : null}
        </span>
      </div>
      {!tree ? (
        <div className="tree-loading" role="status">
          <span />
          <span />
          <span />
        </div>
      ) : nodes.length ? (
        <ul className="tree-level">
          {nodes.map((node) => {
            const isGroup = node.type === 'group';
            const isExpanded = isGroup && expanded.has(node.path);
            const extension = isGroup ? '' : fileExtension(node.name);
            return (
              <li
                key={`${node.type}:${node.path}`}
                role="treeitem"
                aria-selected={!isGroup && selectedPath === node.entry.physicalRelativePath}
              >
                <button
                  aria-expanded={isGroup ? isExpanded : undefined}
                  className={`tree-item${!isGroup && selectedPath === node.entry.physicalRelativePath ? ' selected' : ''}`}
                  style={{ '--depth': node.depth } as React.CSSProperties}
                  onClick={() =>
                    isGroup ? toggle(node.path) : onOpen(node.entry.physicalRelativePath)
                  }
                  onKeyDown={(event) => handleKey(event, node)}
                  title={node.path}
                >
                  <span className={`tree-chevron${isExpanded ? ' expanded' : ''}`}>
                    {isGroup ? <Icon name="chevron" /> : null}
                  </span>
                  <Icon name={isGroup ? 'folder' : 'file'} />
                  <span className="tree-name">{node.name}</span>
                  {!isGroup ? <span className="file-kind">{extension.slice(1)}</span> : null}
                  {!isGroup && node.entry.status === 'unclassified' ? (
                    <span className="tree-unclassified">À classer</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="tree-empty">Ce dossier ne contient aucun document compatible.</p>
      )}
    </div>
  );
}

function DocumentPreview({
  preview,
  workspaceId,
  path,
}: {
  preview: PreviewResult;
  workspaceId: string;
  path: string;
}) {
  const [activeSheet, setActiveSheet] = useState(0);
  if (preview.kind === 'pdf') {
    return (
      <iframe
        className="pdf-preview"
        title={`Aperçu PDF de ${path.split('/').at(-1) ?? path}`}
        src={api.rawUrl(workspaceId, path)}
      />
    );
  }
  if (preview.kind === 'spreadsheet') {
    const sheet = preview.sheets[activeSheet];
    return (
      <section className="spreadsheet-preview" aria-label="Aperçu du classeur">
        <nav className="sheet-tabs" aria-label="Feuilles du classeur">
          {preview.sheets.map((item, index) => (
            <button
              key={item.name}
              className={index === activeSheet ? 'active' : ''}
              onClick={() => setActiveSheet(index)}
            >
              {item.name}
            </button>
          ))}
        </nav>
        {sheet ? (
          <div className="table-scroll">
            <table>
              <tbody>
                {sheet.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <th scope="row">{rowIndex + 1}</th>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{cell ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {sheet.truncated ? (
              <p className="preview-limit">
                Aperçu limité aux 200 premières lignes et 50 colonnes.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="preview-empty">Ce classeur ne contient aucune feuille lisible.</div>
        )}
      </section>
    );
  }
  if (preview.kind === 'document') {
    return (
      <article className="word-preview">
        {preview.content
          .split(/\n{2,}/)
          .filter(Boolean)
          .map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
      </article>
    );
  }
  return <pre className="text-preview">{preview.content}</pre>;
}

function PinIndicatorDialog({
  field,
  title,
  busy,
  error,
  onTitleChange,
  onClose,
  onSubmit,
}: {
  field: RagField;
  title: string;
  busy: boolean;
  error: string;
  onTitleChange: (title: string) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="pin-dialog"
      aria-labelledby="pin-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form className="pin-dialog-form" onSubmit={onSubmit}>
        <header>
          <h2 id="pin-dialog-title">Créer un indicateur</h2>
          <p>La requête et ses sources seront conservées pour actualiser cette valeur.</p>
        </header>
        <label>
          <span>Titre</span>
          <input
            autoFocus
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            maxLength={120}
          />
        </label>
        <div className="pin-preview">
          <span>Valeur épinglée</span>
          <strong>
            {formatIndicatorValue({
              displayType: field.type,
              latestValue: field.value,
              latestUnit: field.unit,
            })}
          </strong>
        </div>
        {error ? (
          <div className="pin-dialog-error" role="alert">
            {error}
          </div>
        ) : null}
        <footer className="pin-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Ajout…' : 'Ajouter aux indicateurs'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function VersionHistoryDialog({
  appVersion,
  onClose,
}: {
  appVersion: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="version-dialog"
      aria-labelledby="version-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="version-dialog-content">
        <header>
          <div>
            <h2 id="version-dialog-title">Historique des versions</h2>
            <p>Les évolutions livrées avec DocSteward.</p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Fermer">
            <Icon name="close" />
          </button>
        </header>
        <div className="release-list">
          {changelogReleases.length ? (
            changelogReleases.map((release) => (
              <article className="release-entry" key={`${release.version}-${release.date}`}>
                <div className="release-heading">
                  <h3>Version {release.version}</h3>
                  {release.version === appVersion ? <span>Version actuelle</span> : null}
                  <time dateTime={release.date}>
                    {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(
                      new Date(`${release.date}T12:00:00`),
                    )}
                  </time>
                </div>
                {release.notes.length ? (
                  <ul>
                    {release.notes.map((note, index) => (
                      <li key={`${release.version}-${index}`}>{note}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="release-empty">Aucune note publiée pour cette version.</p>
                )}
              </article>
            ))
          ) : (
            <p className="release-empty">Aucun historique de version n’est encore disponible.</p>
          )}
        </div>
      </section>
    </dialog>
  );
}

function RagPanel({
  workspace,
  section,
  onOpenConfiguration,
  onIndexUpdated,
  onWorkspaceRemoved,
}: {
  workspace: WorkspaceSummary;
  section: 'dashboard' | 'questions' | 'configuration';
  onOpenConfiguration: () => void;
  onIndexUpdated: () => void;
  onWorkspaceRemoved: () => void;
}) {
  const [ragStatus, setRagStatus] = useState<RagStatus | null>(null);
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<RagAnswer | null>(null);
  const [lastQuestion, setLastQuestion] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [pinning, setPinning] = useState<RagField | null>(null);
  const [indicatorTitle, setIndicatorTitle] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingTitle, setEditingTitle] = useState('');

  const reload = useCallback(async () => {
    const [nextStatus, nextIndicators] = await Promise.all([
      api.ragStatus(workspace.id),
      api.indicators(workspace.id),
    ]);
    setRagStatus(nextStatus);
    setIndicators(nextIndicators);
    setConsent(nextStatus.enabled);
  }, [workspace.id]);

  useEffect(() => {
    setAnswer(null);
    setQuestion('');
    setError('');
    void reload().catch((issue: unknown) =>
      setError(issue instanceof Error ? issue.message : 'Impossible de charger la recherche IA.'),
    );
  }, [reload]);

  const enable = async () => {
    if (!consent) return;
    setBusy('consent');
    setError('');
    try {
      await api.setRagConsent(workspace.id, true);
      await reload();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Impossible d’activer la recherche IA.');
    } finally {
      setBusy('');
    }
  };

  const buildIndex = async () => {
    setBusy('index');
    setError('');
    try {
      setRagStatus(await api.indexWorkspace(workspace.id));
      onIndexUpdated();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'L’indexation a échoué.');
      await reload();
    } finally {
      setBusy('');
    }
  };

  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!question.trim()) return;
    setBusy('query');
    setError('');
    setAnswer(null);
    try {
      const asked = question.trim();
      setLastQuestion(asked);
      setAnswer(await api.query(workspace.id, asked));
      await reload();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'La recherche a échoué.');
    } finally {
      setBusy('');
    }
  };

  const pin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pinning || !answer) return;
    setBusy('pin');
    setError('');
    try {
      await api.createIndicator({
        workspaceId: workspace.id,
        title: indicatorTitle.trim() || pinning.label,
        query: lastQuestion,
        selectedFieldKey: pinning.key,
        expectedType: pinning.type,
        initialAnswer: answer,
      });
      setPinning(null);
      await reload();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Impossible de créer cet indicateur.');
    } finally {
      setBusy('');
    }
  };

  const refresh = async (indicator: Indicator) => {
    setBusy(indicator.id);
    setError('');
    try {
      const next = await api.refreshIndicator(indicator.id, workspace.id);
      setIndicators((current) => current.map((item) => (item.id === next.id ? next : item)));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'L’actualisation a échoué.');
      await reload();
    } finally {
      setBusy('');
    }
  };

  const remove = async (indicator: Indicator) => {
    if (!window.confirm(`Supprimer l’indicateur « ${indicator.title} » ?`)) return;
    await api.deleteIndicator(indicator.id);
    await reload();
  };

  const rename = async (event: React.FormEvent, indicator: Indicator) => {
    event.preventDefault();
    if (!editingTitle.trim()) return;
    const next = await api.renameIndicator(indicator.id, editingTitle.trim());
    setIndicators((current) => current.map((item) => (item.id === next.id ? next : item)));
    setEditingId('');
  };

  const disableRag = async () => {
    if (
      !window.confirm(
        'Désactiver la recherche IA et supprimer l’index local de cet espace ? Les documents sources resteront inchangés.',
      )
    )
      return;
    await api.setRagConsent(workspace.id, false);
    setAnswer(null);
    await reload();
  };

  const removeWorkspace = async () => {
    if (
      !window.confirm(
        `Retirer « ${workspace.displayName} » de la bibliothèque ? Le dossier et ses fichiers resteront inchangés. Son index et ses indicateurs seront supprimés de DocSteward.`,
      )
    )
      return;
    setBusy('remove-workspace');
    setError('');
    try {
      await Promise.all(indicators.map((indicator) => api.deleteIndicator(indicator.id)));
      await api.deleteIndex(workspace.id);
      await window.docSteward.removeWorkspace(workspace.id);
      onWorkspaceRemoved();
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue.message
          : 'Impossible de retirer ce dossier de la bibliothèque.',
      );
      setBusy('');
    }
  };

  if (!ragStatus)
    return (
      <div className="rag-loading" role="status">
        Chargement de la recherche documentaire…
      </div>
    );

  const indexLabel =
    ragStatus.status === 'ready'
      ? 'Index prêt'
      : ragStatus.status === 'indexing'
        ? 'Indexation en cours'
        : ragStatus.status === 'stale'
          ? 'Index à actualiser'
          : ragStatus.status === 'error'
            ? 'Index en erreur'
            : 'Non indexé';

  if (section === 'configuration') {
    return (
      <div className="settings-scroll">
        <header className="settings-hero">
          <div>
            <h1>Configuration du dossier</h1>
            <p>
              Gérez l’indexation et l’accès à « {workspace.displayName} » pour ce dossier
              uniquement.
            </p>
          </div>
        </header>

        {error ? (
          <div className="rag-error" role="alert">
            {error}
          </div>
        ) : null}

        <section className="settings-section workspace-ai-settings">
          <div className="settings-section-heading">
            <h2>Indexation</h2>
          </div>
          {!ragStatus.keyConfigured ? (
            <div className="settings-status unavailable">
              <span>
                <Icon name="info" />
              </span>
              <div>
                <strong>Service IA indisponible pour ce compte</strong>
                <p>Contactez IndependentWeb pour activer cet accès.</p>
              </div>
            </div>
          ) : !ragStatus.enabled ? (
            <>
              <label className="consent-check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>J’autorise l’indexation de ce dossier par une IA tierce.</span>
              </label>
              <button
                className="primary-button"
                disabled={!consent || busy === 'consent'}
                onClick={enable}
              >
                Activer pour ce dossier
              </button>
            </>
          ) : (
            <div className="index-settings-row">
              <div>
                <strong>{indexLabel}</strong>
                <p>
                  {ragStatus.status === 'ready'
                    ? 'La recherche et l’actualisation des indicateurs sont disponibles.'
                    : 'Préparez l’index documentaire pour utiliser les fonctions IA.'}
                </p>
              </div>
              <div className="settings-actions">
                <button className="primary-button" disabled={busy === 'index'} onClick={buildIndex}>
                  {busy === 'index'
                    ? 'Indexation…'
                    : ragStatus.status === 'ready' || ragStatus.status === 'stale'
                      ? 'Mettre à jour l’index'
                      : 'Indexer les documents'}
                </button>
                <button className="text-danger" onClick={() => void disableRag()}>
                  Désactiver et supprimer l’index
                </button>
              </div>
            </div>
          )}
          {busy === 'index' ? (
            <div className="index-progress" role="status">
              {ragStatus.status === 'ready' || ragStatus.status === 'stale'
                ? 'Mise à jour des documents modifiés et de l’index local…'
                : 'Création des embeddings et de l’index local…'}
            </div>
          ) : null}
        </section>

        <section className="settings-section danger-zone">
          <div className="settings-section-heading">
            <h2>Retirer de la bibliothèque</h2>
            <p>
              DocSteward oubliera ce dossier et supprimera son index ainsi que ses indicateurs.
              Aucun fichier source ne sera supprimé ni modifié.
            </p>
          </div>
          <button
            className="danger-button"
            disabled={busy === 'remove-workspace'}
            onClick={() => void removeWorkspace()}
          >
            {busy === 'remove-workspace'
              ? 'Retrait du dossier…'
              : 'Retirer ce dossier de la bibliothèque'}
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="rag-scroll">
      <header className="rag-hero">
        <div>
          <h1>
            {section === 'questions' ? (
              'Interrogez votre bibliothèque'
            ) : (
              <>
                Tableau de bord :{' '}
                <span className="rag-workspace-name">{workspace.displayName}</span>
              </>
            )}
          </h1>
          {section === 'questions' ? (
            <p>Posez une question à vos documents et vérifiez chaque réponse dans ses sources.</p>
          ) : null}
          <p className="rag-privacy-compact">
            Documents en lecture seule · extraits utiles transmis à OpenAI
          </p>
        </div>
        {section === 'dashboard' ? (
          <div
            className={`index-state ${ragStatus.status}`}
            role="status"
            aria-label={`Index documentaire : ${indexLabel}`}
          >
            <small className="index-state-label">Index documentaire</small>
            <span>{indexLabel}</span>
            <small className="index-state-count">
              {ragStatus.indexedDocuments} document{ragStatus.indexedDocuments > 1 ? 's' : ''}
            </small>
          </div>
        ) : null}
      </header>
      {error ? (
        <div className="rag-error" role="alert">
          {error}
        </div>
      ) : null}
      {section === 'questions' && (!ragStatus.enabled || ragStatus.status !== 'ready') ? (
        <section className="setup-sheet prerequisite-sheet">
          <h2>La recherche n’est pas encore disponible</h2>
          <p>Autorisez l’indexation de ce dossier pour pouvoir lancer une recherche.</p>
          <button
            className="secondary-button"
            disabled={!ragStatus.keyConfigured}
            onClick={onOpenConfiguration}
          >
            {ragStatus.keyConfigured
              ? 'Configurer ce dossier'
              : 'Service indisponible pour ce compte'}
          </button>
        </section>
      ) : null}
      {section === 'questions' && ragStatus.enabled && ragStatus.status === 'ready' ? (
        <>
          <section className="question-sheet">
            <form onSubmit={ask}>
              <label htmlFor="rag-question">Que voulez vous savoir ?</label>
              <div className="question-row">
                <textarea
                  id="rag-question"
                  rows={2}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ex. Quel est le montant total de mon chiffre d’affaires ?"
                />
                <button
                  className="primary-button"
                  disabled={busy === 'query' || question.trim().length < 3}
                >
                  {busy === 'query' ? 'Recherche…' : 'Poser la question'}
                </button>
              </div>
            </form>
          </section>
          {answer ? (
            <section className="answer-sheet" aria-live="polite">
              <h2>Réponse</h2>
              <p className="answer-copy">{answer.answer}</p>
              {answer.fields.length ? (
                <div className="answer-fields">
                  {answer.fields.map((field) => (
                    <div className="answer-field" key={field.key}>
                      <div>
                        <span>{field.label}</span>
                        <strong>
                          {formatIndicatorValue({
                            displayType: field.type,
                            latestValue: field.value,
                            latestUnit: field.unit,
                          })}
                        </strong>
                      </div>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setError('');
                          setPinning(field);
                          setIndicatorTitle(field.label);
                        }}
                      >
                        Épingler comme indicateur
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="answer-note">
                  Cette réponse ne contient aucun champ suffisamment structuré pour devenir un
                  indicateur.
                </p>
              )}
              <details className="sources">
                <summary>Sources utilisées · {answer.citations.length}</summary>
                {answer.citations.map((citation) => (
                  <article key={citation.id}>
                    <strong>
                      {citation.documentName}
                      {citation.sheet ? ` · ${citation.sheet}` : ''}
                    </strong>
                    <p>{citation.excerpt}</p>
                    <code>{citation.documentPath}</code>
                  </article>
                ))}
              </details>
            </section>
          ) : null}
          {pinning && answer ? (
            <PinIndicatorDialog
              field={pinning}
              title={indicatorTitle}
              busy={busy === 'pin'}
              error={error}
              onTitleChange={setIndicatorTitle}
              onClose={() => {
                setPinning(null);
                setIndicatorTitle('');
                setError('');
              }}
              onSubmit={pin}
            />
          ) : null}
        </>
      ) : null}
      {section === 'dashboard' ? (
        <section className="indicators-section">
          <div className="section-heading">
            <div>
              <h2>Indicateurs épinglés</h2>
              <p>
                {indicators.length
                  ? 'Leur dernière valeur fiable reste visible même si une actualisation échoue.'
                  : 'Épinglez un champ depuis une réponse pour le retrouver ici.'}
              </p>
            </div>
            <span>{indicators.length}</span>
          </div>
          {indicators.length ? (
            <div className="indicator-grid">
              {indicators.map((indicator) => (
                <article className={`indicator-tile ${indicator.status}`} key={indicator.id}>
                  <header>
                    <span>
                      {indicator.status === 'ready'
                        ? 'À jour'
                        : indicator.status === 'refreshing'
                          ? 'Actualisation'
                          : indicator.status === 'stale'
                            ? 'À vérifier'
                            : 'Erreur'}
                    </span>
                    <div className="indicator-menu">
                      <button
                        onClick={() => {
                          setEditingId(indicator.id);
                          setEditingTitle(indicator.title);
                        }}
                      >
                        Renommer
                      </button>
                      <button
                        aria-label={`Supprimer ${indicator.title}`}
                        onClick={() => void remove(indicator)}
                      >
                        Supprimer
                      </button>
                    </div>
                  </header>
                  {editingId === indicator.id ? (
                    <form
                      className="rename-form"
                      onSubmit={(event) => void rename(event, indicator)}
                    >
                      <label>
                        <span className="sr-only">Nouveau titre</span>
                        <input
                          value={editingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          maxLength={120}
                          autoFocus
                        />
                      </label>
                      <button className="refresh-button">Valider</button>
                      <button type="button" onClick={() => setEditingId('')}>
                        Annuler
                      </button>
                    </form>
                  ) : (
                    <h3>{indicator.title}</h3>
                  )}
                  <div className="indicator-value">{formatIndicatorValue(indicator)}</div>
                  <p>
                    {indicator.lastSuccessfulRunAt
                      ? `Actualisé ${formatDate(indicator.lastSuccessfulRunAt)}`
                      : 'Jamais actualisé'}
                  </p>
                  {indicator.lastError ? <small>{indicator.lastError.message}</small> : null}
                  <footer>
                    <details>
                      <summary>Sources · {indicator.latestCitations.length}</summary>
                      {indicator.latestCitations.map((citation) => (
                        <span key={citation.id}>{citation.documentName}</span>
                      ))}
                    </details>
                    <button
                      className="refresh-button"
                      disabled={busy === indicator.id}
                      onClick={() => void refresh(indicator)}
                    >
                      {busy === indicator.id ? 'Actualisation…' : 'Actualiser'}
                    </button>
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <div className="indicators-empty">Aucun indicateur pour ce dossier.</div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: (state: AuthState) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onAuthenticated(await window.docSteward.login(email.trim(), password));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'La connexion a échoué.');
      setBusy(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <BrandMark />
          <span>DocSteward</span>
        </div>
        <div className="login-heading">
          <h1>Retrouvez votre bibliothèque</h1>
          <p>Connectez-vous avec le compte fourni par IndependentWeb.</p>
        </div>
        <form onSubmit={submit}>
          <label>
            <span>Adresse e-mail</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </label>
          <label>
            <span>Mot de passe</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? (
            <div className="login-error" role="alert">
              {error}
            </div>
          ) : null}
          <button className="primary-button" disabled={busy || !email.trim() || !password}>
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
        <p className="login-footnote">
          Vos documents restent sur cet appareil. Seuls les extraits nécessaires aux fonctions IA
          transitent par IndependentWeb et OpenAI.
        </p>
      </section>
    </main>
  );
}

export function App() {
  const [authentication, setAuthentication] = useState<AuthState | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeId, setActiveId] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [previewTabs, setPreviewTabs] = useState<
    Array<{ path: string; preview: PreviewResult | null; error?: string }>
  >([]);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [view, setView] = useState<'document' | 'workspace'>('workspace');
  const [workspaceSection, setWorkspaceSection] = useState<
    'dashboard' | 'questions' | 'sorter' | 'configuration'
  >('dashboard');
  const [fileTreeRefreshVersion, setFileTreeRefreshVersion] = useState(0);
  const [virtualTree, setVirtualTree] = useState<VirtualTree | null>(null);
  const [physicalTree, setPhysicalTree] = useState<VirtualTree | null>(null);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeId);
  const activePreviewTab = previewTabs.find((tab) => tab.path === selectedPath);
  const preview = activePreviewTab?.preview ?? null;
  const opening = activePreviewTab ? !activePreviewTab.preview && !activePreviewTab.error : false;
  const visiblePreviewTabs = previewTabs.slice(0, 3);
  const hiddenPreviewTabs = previewTabs.slice(3);
  const inspectorVisible = view === 'document' && Boolean(preview) && !inspectorCollapsed;

  const refreshWorkspaces = useCallback(async (preferredId?: string) => {
    const next = await api.workspaces();
    setWorkspaces(next);
    setActiveId(
      (current) =>
        preferredId ?? (next.some((item) => item.id === current) ? current : (next[0]?.id ?? '')),
    );
  }, []);

  useEffect(() => {
    void window.docSteward
      .getAuthState()
      .then(setAuthentication)
      .catch(() => setAuthentication({ authenticated: false }));
  }, []);

  useEffect(() => {
    if (!authentication?.authenticated) return;
    void Promise.all([api.health(), api.workspaces(), window.docSteward.getAppInfo()])
      .then(([health, initialWorkspaces, appInfo]) => {
        setStatus('ready');
        setWorkspaces(initialWorkspaces);
        setActiveId(initialWorkspaces[0]?.id ?? '');
        setAppVersion(health.version || appInfo.version);
      })
      .catch((error: unknown) => {
        setStatus('error');
        setNotice({
          tone: 'error',
          text: error instanceof Error ? error.message : 'Serveur indisponible.',
        });
      });
  }, [authentication]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    void api
      .virtualTree(activeId)
      .then((tree) => {
        if (cancelled) return;
        setVirtualTree(tree);
        setPhysicalTree(null);
      })
      .catch(
        (error: unknown) =>
          !cancelled &&
          setNotice({
            tone: 'error',
            text: error instanceof Error ? error.message : 'Impossible de charger l’organisation.',
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [activeId, fileTreeRefreshVersion]);

  const chooseWorkspace = async () => {
    const chosen = await window.docSteward.selectWorkspace();
    if (!chosen) return;
    setSelectedPath('');
    setPreviewTabs([]);
    setWorkspaceSection('dashboard');
    setView('workspace');
    await refreshWorkspaces(chosen.id);
  };

  const openFile = async (path: string) => {
    if (!activeId) return;
    setView('document');
    setNotice(null);
    setSelectedPath(path);
    const existingTab = previewTabs.find((tab) => tab.path === path);
    if (existingTab) return;

    setPreviewTabs((current) => [...current, { path, preview: null }]);
    try {
      const next = await api.preview(activeId, path);
      setPreviewTabs((current) =>
        current.map((tab) => (tab.path === path ? { ...tab, preview: next } : tab)),
      );
    } catch (error) {
      const apiError = error instanceof ApiError ? error : undefined;
      const message =
        apiError?.code === 'FILE_TOO_LARGE'
          ? 'Ce fichier est trop volumineux pour être prévisualisé.'
          : (apiError?.message ?? 'Impossible de prévisualiser ce fichier.');
      setPreviewTabs((current) =>
        current.map((tab) => (tab.path === path ? { ...tab, error: message } : tab)),
      );
      setNotice({
        tone: 'error',
        text: message,
      });
    }
  };

  const selectPreviewTab = (path: string) => {
    setSelectedPath(path);
    setView('document');
    setNotice(null);
  };

  const closePreviewTab = (path: string) => {
    setPreviewTabs((current) => {
      const closedIndex = current.findIndex((tab) => tab.path === path);
      const next = current.filter((tab) => tab.path !== path);
      if (selectedPath === path) {
        const fallback = next[Math.min(closedIndex, next.length - 1)];
        setSelectedPath(fallback?.path ?? '');
        if (!fallback) setView('workspace');
      }
      return next;
    });
  };

  const handleWorkspaceRemoved = () => {
    setSelectedPath('');
    setPreviewTabs([]);
    setWorkspaceSection('dashboard');
    setView('workspace');
    setWorkspaces((current) => {
      const next = current.filter((workspace) => workspace.id !== activeId);
      setActiveId(next[0]?.id ?? '');
      return next;
    });
  };

  const logout = async () => {
    const nextAuthentication = await window.docSteward.logout();
    setAuthentication(nextAuthentication);
    setStatus('loading');
    setWorkspaces([]);
    setActiveId('');
    setSelectedPath('');
    setPreviewTabs([]);
  };

  const filename = selectedPath.split('/').at(-1) ?? '';
  const extension = fileExtension(filename);
  const selectedMapping = virtualTree?.entries.find(
    (entry) => entry.physicalRelativePath === selectedPath,
  );

  if (authentication === null)
    return (
      <main className="startup-state" aria-busy="true">
        <div className="brand-mark">
          <BrandMark />
        </div>
        <h1>DocSteward</h1>
        <p>Ouverture sécurisée…</p>
        <div className="startup-rule">
          <span />
        </div>
      </main>
    );

  if (!authentication.authenticated) return <LoginScreen onAuthenticated={setAuthentication} />;

  if (status === 'loading')
    return (
      <main className="startup-state" aria-busy="true">
        <div className="brand-mark">
          <BrandMark />
        </div>
        <h1>DocSteward</h1>
        <p>Préparation de votre bibliothèque locale…</p>
        <div className="startup-rule">
          <span />
        </div>
      </main>
    );

  if (status === 'error')
    return (
      <main className="empty-state error-state">
        <div className="empty-symbol">
          <Icon name="shield" />
        </div>
        <h1>Le serveur local ne répond pas</h1>
        <p>{notice?.text}</p>
        <div className="error-actions">
          <button className="primary-button" onClick={() => window.docSteward.retryServer()}>
            Réessayer
          </button>
          <button
            className="secondary-button"
            onClick={() => window.docSteward.openLogsDirectory()}
          >
            Ouvrir le dossier des journaux
          </button>
        </div>
      </main>
    );

  if (!activeWorkspace)
    return (
      <div className="welcome-shell">
        <header className="welcome-header">
          <div className="wordmark">
            <BrandMark />
            <span>DocSteward</span>
          </div>
          <ProfileMenu email={authentication.account.email} onLogout={logout} />
        </header>
        <main className="empty-state">
          <div className="folio brand-folio">
            <BrandMark />
          </div>
          <h1>
            Vos documents,
            <br />
            simplement à portée de vue.
          </h1>
          <p>
            Choisissez un dossier local pour prévisualiser vos PDF, documents Word, classeurs Excel
            et fichiers texte. Rien n’est modifié, rien n’est envoyé ailleurs.
          </p>
          <button className="primary-button" onClick={chooseWorkspace}>
            Choisir un dossier
          </button>
          <div className="permission-note">
            <Icon name="shield" />
            <span>Accès local, en lecture seule et limité au dossier choisi</span>
          </div>
        </main>
        <footer className="welcome-footer">Version {appVersion}</footer>
      </div>
    );

  return (
    <div className={`app-shell${inspectorVisible ? ' has-inspector' : ''}`}>
      <aside className="sidebar">
        <div className="wordmark compact">
          <BrandMark />
          <span>DocSteward</span>
        </div>
        <div className="server-status-row">
          <div className="server-status">
            <i /> Serveur prêt
          </div>
          <button
            type="button"
            className="version-button"
            onClick={() => setVersionHistoryOpen(true)}
            aria-label={`Voir l’historique des versions, version actuelle ${appVersion}`}
          >
            v{appVersion}
          </button>
        </div>
        <div className="workspace-heading">Bibliothèque locale</div>
        <label className="workspace-select">
          <span className="sr-only">Dossier actif</span>
          <select
            value={activeId}
            onChange={(event) => {
              setActiveId(event.target.value);
              setSelectedPath('');
              setPreviewTabs([]);
              setWorkspaceSection('dashboard');
              setView('workspace');
            }}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.displayName}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button full" onClick={chooseWorkspace}>
          Ajouter un dossier
        </button>
        <div className="sidebar-rule" />
        <FileTree
          key={activeId}
          tree={physicalTree ?? virtualTree}
          selectedPath={selectedPath}
          onOpen={openFile}
        />
        <div className="sidebar-footer">
          <ProfileMenu email={authentication.account.email} onLogout={logout} />
          <button onClick={() => window.docSteward.openLogsDirectory()}>Journaux</button>
        </div>
      </aside>
      {versionHistoryOpen ? (
        <VersionHistoryDialog
          appVersion={appVersion}
          onClose={() => setVersionHistoryOpen(false)}
        />
      ) : null}
      <section className="primary-surface">
        {notice && view !== 'document' ? (
          <div className={`notice app-notice ${notice.tone}`} role="status">
            {notice.text}
          </div>
        ) : null}
        <nav className="action-tabs" aria-label="Navigation du dossier">
          <div className="primary-tabs" role="tablist" aria-label="Navigation principale">
            <button
              className={view === 'workspace' && workspaceSection === 'dashboard' ? 'active' : ''}
              role="tab"
              aria-selected={view === 'workspace' && workspaceSection === 'dashboard'}
              onClick={() => {
                setWorkspaceSection('dashboard');
                setView('workspace');
              }}
            >
              Tableau de bord
            </button>
            <button
              className={view === 'workspace' && workspaceSection === 'questions' ? 'active' : ''}
              role="tab"
              aria-selected={view === 'workspace' && workspaceSection === 'questions'}
              onClick={() => {
                setWorkspaceSection('questions');
                setView('workspace');
              }}
            >
              Recherche
            </button>
            <button
              className={view === 'workspace' && workspaceSection === 'sorter' ? 'active' : ''}
              role="tab"
              aria-selected={view === 'workspace' && workspaceSection === 'sorter'}
              onClick={() => {
                setWorkspaceSection('sorter');
                setView('workspace');
              }}
            >
              Organisation
            </button>
            <button
              className={
                view === 'workspace' && workspaceSection === 'configuration' ? 'active' : ''
              }
              role="tab"
              aria-selected={view === 'workspace' && workspaceSection === 'configuration'}
              onClick={() => {
                setWorkspaceSection('configuration');
                setView('workspace');
              }}
            >
              Configuration
            </button>
          </div>
          {previewTabs.length ? (
            <div className="preview-tabs" role="tablist" aria-label="Aperçus ouverts">
              {visiblePreviewTabs.map((tab) => {
                const tabName = tab.path.split('/').at(-1) ?? tab.path;
                const isActive = view === 'document' && selectedPath === tab.path;
                return (
                  <div className={`preview-tab${isActive ? ' active' : ''}`} key={tab.path}>
                    <button
                      className="preview-tab-select"
                      role="tab"
                      aria-selected={isActive}
                      title={tab.path}
                      onClick={() => selectPreviewTab(tab.path)}
                    >
                      {tabName}
                    </button>
                    <button
                      className="preview-tab-close"
                      aria-label={`Fermer l’aperçu ${tabName}`}
                      onClick={() => closePreviewTab(tab.path)}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                );
              })}
              {hiddenPreviewTabs.length ? (
                <details
                  className={`preview-overflow${
                    view === 'document' &&
                    hiddenPreviewTabs.some((tab) => tab.path === selectedPath)
                      ? ' active'
                      : ''
                  }`}
                >
                  <summary aria-label={`${hiddenPreviewTabs.length} autres aperçus ouverts`}>
                    …
                  </summary>
                  <div className="preview-overflow-menu">
                    {hiddenPreviewTabs.map((tab) => {
                      const tabName = tab.path.split('/').at(-1) ?? tab.path;
                      return (
                        <div className="preview-overflow-item" key={tab.path}>
                          <button
                            className="preview-overflow-select"
                            aria-current={selectedPath === tab.path ? 'page' : undefined}
                            title={tab.path}
                            onClick={(event) => {
                              selectPreviewTab(tab.path);
                              event.currentTarget.closest('details')?.removeAttribute('open');
                            }}
                          >
                            <Icon name="file" />
                            <span>{tabName}</span>
                          </button>
                          <button
                            className="preview-overflow-close"
                            aria-label={`Fermer l’aperçu ${tabName}`}
                            onClick={() => closePreviewTab(tab.path)}
                          >
                            <Icon name="close" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </nav>
        <main className="document-area" hidden={view !== 'document'}>
          <header className="document-toolbar">
            <span className="document-name">{filename || 'Aucun document ouvert'}</span>
            {preview ? (
              <div className="toolbar-actions">
                <div className="toolbar-meta">
                  <span className="format-chip">{formatLabel(extension)}</span>
                  {formatBytes(preview.size)}
                </div>
                <button
                  className="inspector-toggle"
                  aria-expanded={inspectorVisible}
                  aria-controls="file-inspector"
                  onClick={() => setInspectorCollapsed((current) => !current)}
                >
                  <Icon name="info" />
                  <span>Informations</span>
                </button>
              </div>
            ) : null}
          </header>
          {notice ? (
            <div className={`notice ${notice.tone}`} role="status">
              {notice.text}
            </div>
          ) : null}
          {opening ? (
            <div className="editor-loading" aria-label="Création de l’aperçu">
              <span />
              <span />
              <span />
              <span />
            </div>
          ) : preview ? (
            <DocumentPreview
              key={selectedPath}
              preview={preview}
              workspaceId={activeId}
              path={selectedPath}
            />
          ) : (
            <section className="editor-empty">
              <div className="paper-corner" />
              <h1>Choisissez un document</h1>
              <p>
                Sélectionnez un PDF, un fichier Word, un classeur Excel ou un fichier texte pour
                l’afficher ici, sans jamais le modifier.
              </p>
            </section>
          )}
        </main>
        {view === 'workspace' && workspaceSection === 'sorter' ? (
          <main className="sorter-area">
            <SorterPanel
              workspace={activeWorkspace}
              currentTree={virtualTree}
              viewingPhysical={Boolean(physicalTree)}
              onShowPhysical={async () =>
                setPhysicalTree(await api.virtualTree(activeId, 'physical'))
              }
              onShowActive={() => setPhysicalTree(null)}
              onTreeChange={(tree, message) => {
                setVirtualTree(tree);
                setPhysicalTree(null);
                if (message) setNotice({ tone: 'info', text: message });
              }}
            />
          </main>
        ) : (
          <main
            className={workspaceSection === 'configuration' ? 'settings-area' : 'rag-area'}
            hidden={view === 'document'}
          >
            <RagPanel
              workspace={activeWorkspace}
              section={workspaceSection as 'dashboard' | 'questions' | 'configuration'}
              onOpenConfiguration={() => {
                setWorkspaceSection('configuration');
                setView('workspace');
              }}
              onIndexUpdated={() => {
                setFileTreeRefreshVersion((current) => current + 1);
                void api
                  .reindexVirtualTree(activeId)
                  .then((tree) => {
                    setVirtualTree(tree);
                    setPhysicalTree(null);
                  })
                  .catch(() => api.virtualTree(activeId).then(setVirtualTree));
              }}
              onWorkspaceRemoved={handleWorkspaceRemoved}
            />
          </main>
        )}
      </section>
      {inspectorVisible && preview ? (
        <aside className="inspector" id="file-inspector">
          <div className="inspector-title">
            <span>Informations</span>
            <button
              aria-label="Replier le volet d’informations"
              onClick={() => setInspectorCollapsed(true)}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="file-summary">
            <Icon name="file" />
            <div>
              <strong>{filename}</strong>
              <span>
                {formatLabel(extension)} · {formatBytes(preview.size)}
              </span>
            </div>
          </div>
          <dl className="metadata">
            <div>
              <dt>Dans DocSteward</dt>
              <dd>{selectedMapping?.virtualPath ?? selectedPath}</dd>
            </div>
            <div>
              <dt>Sur le disque</dt>
              <dd>{selectedPath}</dd>
            </div>
            {selectedMapping?.reason ? (
              <div>
                <dt>Classement</dt>
                <dd>{selectedMapping.reason}</dd>
              </div>
            ) : null}
            <div>
              <dt>Modifié</dt>
              <dd>{formatDate(preview.modifiedAt)}</dd>
            </div>
            <div>
              <dt>Accès</dt>
              <dd>Lecture seule</dd>
            </div>
            {preview.kind === 'spreadsheet' ? (
              <div>
                <dt>Feuilles</dt>
                <dd>{preview.sheets.length}</dd>
              </div>
            ) : null}
          </dl>
          <div className="inspector-section">
            <h2>Confidentialité</h2>
            <div className="secure-line">
              <span>
                <Icon name="check" />
              </span>
              <div>
                <strong>Consulté localement</strong>
                <p>DocSteward ne modifie pas le fichier et ne l’envoie à aucun service distant.</p>
              </div>
            </div>
          </div>
          <div className="hash-block">
            <span>Empreinte SHA-256</span>
            <code>{preview.sha256}</code>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
