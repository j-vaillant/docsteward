import { useEffect, useMemo, useRef, useState } from 'react';
import type { VirtualMappingEntry, VirtualTree, WorkspaceSummary } from '@docsteward/contracts';
import { ApiError, api } from './api';

function effectLabel(entry: VirtualMappingEntry): string {
  if (entry.status === 'unclassified') return 'À classer';
  if (entry.status === 'identity') return 'Identique à l’origine';
  const physicalName = entry.physicalRelativePath.split('/').at(-1);
  const virtualName = entry.virtualPath.split('/').at(-1);
  return physicalName === virtualName ? 'Classé ailleurs' : 'Nom d’affichage adapté';
}

function PreviewTree({
  tree,
  selected,
  onSelect,
}: {
  tree: VirtualTree;
  selected?: string;
  onSelect: (documentId: string) => void;
}) {
  const groups = useMemo(() => {
    const values = new Map<string, VirtualMappingEntry[]>();
    for (const entry of tree.entries) {
      const group = entry.virtualPath.split('/').slice(0, -1).join('/') || 'Racine';
      values.set(group, [...(values.get(group) ?? []), entry]);
    }
    return [...values.entries()].sort(([a], [b]) => a.localeCompare(b, 'fr'));
  }, [tree]);
  return (
    <div className="sorter-preview-tree" role="tree" aria-label="Nouvelle organisation virtuelle">
      {groups.map(([group, entries]) => (
        <section key={group}>
          <h3>{group}</h3>
          {entries.map((entry) => (
            <button
              key={entry.documentId}
              className={selected === entry.documentId ? 'selected' : ''}
              onClick={() => onSelect(entry.documentId)}
              aria-selected={selected === entry.documentId}
              title={entry.virtualPath}
            >
              <span>{entry.virtualPath.split('/').at(-1)}</span>
              <small>{effectLabel(entry)}</small>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

export function SorterPanel({
  workspace,
  currentTree,
  onTreeChange,
  viewingPhysical,
  onShowPhysical,
  onShowActive,
}: {
  workspace: WorkspaceSummary;
  currentTree: VirtualTree | null;
  onTreeChange: (tree: VirtualTree, message?: string) => void;
  viewingPhysical: boolean;
  onShowPhysical: () => Promise<void>;
  onShowActive: () => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [proposal, setProposal] = useState<VirtualTree | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [ragReady, setRagReady] = useState({ enabled: false, keyConfigured: false });
  const [busy, setBusy] = useState<'preview' | 'activate' | 'reset' | ''>('');
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<'activate' | 'reset' | ''>('');
  const timer = useRef<number | undefined>(undefined);
  const requestVersion = useRef(0);

  useEffect(() => {
    setProposal(null);
    setInstruction('');
    setSelectedId('');
    setError('');
    void api
      .ragStatus(workspace.id)
      .then((status) =>
        setRagReady({ enabled: status.enabled, keyConfigured: status.keyConfigured }),
      )
      .catch((issue: unknown) =>
        setError(
          issue instanceof Error ? issue.message : 'Impossible de vérifier la configuration.',
        ),
      );
    return () => window.clearInterval(timer.current);
  }, [workspace.id]);

  const prepare = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setBusy('preview');
    setError('');
    setPhase(0);
    const version = ++requestVersion.current;
    timer.current = window.setInterval(() => setPhase((value) => Math.min(value + 1, 2)), 700);
    try {
      const next = await api.prepareVirtualTree(workspace.id, instruction.trim());
      if (version !== requestVersion.current) return;
      setProposal(next);
      setSelectedId(next.entries[0]?.documentId ?? '');
      setPhase(2);
    } catch (issue) {
      if (version !== requestVersion.current) return;
      setError(
        issue instanceof ApiError ? issue.message : 'La proposition n’a pas pu être préparée.',
      );
    } finally {
      if (version === requestVersion.current) {
        window.clearInterval(timer.current);
        setBusy('');
      }
    }
  };

  const activate = async () => {
    if (!proposal) return;
    setBusy('activate');
    setError('');
    try {
      const tree = await api.activateVirtualTree(workspace.id, proposal.inventoryFingerprint);
      setProposal(null);
      setConfirming('');
      onTreeChange(tree, 'Organisation activée — aucun fichier déplacé');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'L’organisation n’a pas pu être activée.');
      setConfirming('');
    } finally {
      setBusy('');
    }
  };

  const reset = async () => {
    setBusy('reset');
    setError('');
    try {
      const tree = await api.resetVirtualTree(workspace.id);
      setProposal(null);
      setInstruction('');
      setConfirming('');
      onTreeChange(tree, 'Organisation d’origine restaurée — aucun fichier modifié');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Le retour à l’origine a échoué.');
    } finally {
      setBusy('');
    }
  };

  const selected = proposal?.entries.find((entry) => entry.documentId === selectedId);
  const selectedRule = proposal?.rules.find((rule) => rule.id === selected?.ruleId);
  const canPrepare =
    instruction.trim().length >= 10 && ragReady.enabled && ragReady.keyConfigured && !busy;

  if (busy === 'preview') {
    const phases = [
      'Inventaire local',
      'Interprétation des règles',
      'Construction de l’arbre virtuel',
    ];
    return (
      <section className="sorter-generating" aria-live="polite" aria-busy="true">
        <div className="sorter-binding" />
        <h1>DocSteward compose votre nouvelle table des matières</h1>
        <ol>
          {phases.map((label, index) => (
            <li className={index < phase ? 'done' : index === phase ? 'current' : ''} key={label}>
              <span>{index < phase ? '✓' : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        <button
          className="secondary-button"
          onClick={() => {
            requestVersion.current += 1;
            window.clearInterval(timer.current);
            setBusy('');
          }}
        >
          Annuler
        </button>
      </section>
    );
  }

  if (proposal) {
    return (
      <div className="sorter-preview-layout">
        <aside className="sorter-rules">
          <h1>Organisation proposée</h1>
          <blockquote>{proposal.instruction}</blockquote>
          <h2>Règles</h2>
          <ol>
            {proposal.rules.map((rule) => (
              <li key={rule.id}>
                <strong>{rule.title}</strong>
                <span>{rule.description}</span>
              </li>
            ))}
          </ol>
          <dl className="sorter-summary">
            <div>
              <dt>Groupes</dt>
              <dd>{proposal.summary.groups}</dd>
            </div>
            <div>
              <dt>Reclassés</dt>
              <dd>{proposal.summary.mapped}</dd>
            </div>
            <div>
              <dt>Inchangés</dt>
              <dd>{proposal.summary.identity}</dd>
            </div>
            <div>
              <dt>À classer</dt>
              <dd>{proposal.summary.unclassified}</dd>
            </div>
          </dl>
          <button className="text-button" onClick={() => setProposal(null)}>
            Modifier la consigne
          </button>
          <button className="secondary-button" onClick={() => void prepare()}>
            Recalculer la proposition
          </button>
        </aside>
        <main className="sorter-tree-surface">
          <header>
            <div>
              <h2>Nouvel arbre virtuel</h2>
              <p>{proposal.summary.documents} documents, tous conservés</p>
            </div>
          </header>
          <PreviewTree tree={proposal} selected={selectedId} onSelect={setSelectedId} />
          <footer>
            {confirming === 'activate' ? (
              <div className="sorter-confirmation" role="alert">
                <p>
                  Cette organisation remplacera l’arborescence affichée dans DocSteward, y compris
                  après un redémarrage. Vos fichiers resteront exactement à leur emplacement actuel
                  sur le disque.
                </p>
                <button className="secondary-button" onClick={() => setConfirming('')}>
                  Revenir à l’aperçu
                </button>
                <button
                  className="primary-button"
                  disabled={busy === 'activate'}
                  onClick={() => void activate()}
                >
                  Utiliser cette organisation
                </button>
              </div>
            ) : (
              <button className="primary-button" onClick={() => setConfirming('activate')}>
                Utiliser cette organisation
              </button>
            )}
          </footer>
        </main>
        <aside className="sorter-detail">
          <h2>Détail du document</h2>
          {selected ? (
            <>
              <span className={`sorter-effect ${selected.status}`}>{effectLabel(selected)}</span>
              <dl>
                <div>
                  <dt>Dans DocSteward</dt>
                  <dd>{selected.virtualPath}</dd>
                </div>
                <div>
                  <dt>Sur le disque</dt>
                  <dd>{selected.physicalRelativePath}</dd>
                </div>
                <div>
                  <dt>Classement</dt>
                  <dd>
                    {selected.reason || selectedRule?.description || 'Chemin d’origine conservé.'}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p>Sélectionnez un document dans l’arbre.</p>
          )}
        </aside>
      </div>
    );
  }

  return (
    <div className="sorter-scroll">
      <header className="sorter-hero">
        <div>
          <h1>Organisez sans déplacer</h1>
          <p>
            Décrivez une logique de classement. DocSteward en fait une vue virtuelle, temporaire et
            réversible.
          </p>
        </div>
      </header>
      {error ? (
        <div className="rag-error" role="alert">
          {error}
        </div>
      ) : null}
      {currentTree?.status === 'active' || currentTree?.status === 'stale' ? (
        <section className="sorter-active-sheet">
          <div>
            <h2>Organisation virtuelle active</h2>
            <p>
              Les règles seront rejouées lors des prochaines réindexations. Aucun fichier n’a été
              déplacé ou renommé.
            </p>
          </div>
          <div className="sorter-active-actions">
            {viewingPhysical ? (
              <button className="secondary-button" onClick={onShowActive}>
                Afficher l’organisation virtuelle
              </button>
            ) : (
              <button
                className="secondary-button"
                onClick={() =>
                  void onShowPhysical().catch((issue: unknown) =>
                    setError(
                      issue instanceof Error ? issue.message : 'La vue d’origine est indisponible.',
                    ),
                  )
                }
              >
                Voir l’organisation d’origine
              </button>
            )}
            <button className="text-danger" onClick={() => setConfirming('reset')}>
              Revenir à l’origine
            </button>
          </div>
          {confirming === 'reset' ? (
            <div className="sorter-confirmation">
              <p>
                DocSteward affichera de nouveau l’organisation réelle du disque. Aucun fichier ne
                sera modifié.
              </p>
              <button className="secondary-button" onClick={() => setConfirming('')}>
                Annuler
              </button>
              <button
                className="danger-button"
                disabled={busy === 'reset'}
                onClick={() => void reset()}
              >
                Revenir à l’origine
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      <section className="sorter-compose">
        <div className="sorter-compose-heading">
          <div>
            <h2>
              {currentTree?.status === 'active'
                ? 'Préparer une nouvelle organisation'
                : 'Créer une organisation virtuelle'}
            </h2>
            <p>Les groupes proposés n’existent que dans DocSteward.</p>
          </div>
        </div>
        <form onSubmit={(event) => void prepare(event)}>
          <label htmlFor="sorter-instruction">
            Comment souhaitez-vous organiser vos documents ?
          </label>
          <textarea
            id="sorter-instruction"
            rows={6}
            value={instruction}
            maxLength={4000}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Ex. Classe les factures par année et fournisseur. Regroupe les contrats par client. Laisse les autres documents dans leur dossier actuel."
          />
          <div className="sorter-examples">
            <span>Quelques pistes</span>
            <button
              type="button"
              onClick={() =>
                setInstruction(
                  'Classe les factures par année et fournisseur. Laisse les autres documents dans leur dossier actuel.',
                )
              }
            >
              Factures par année
            </button>
            <button
              type="button"
              onClick={() =>
                setInstruction('Regroupe les contrats par client et conserve leur nom actuel.')
              }
            >
              Contrats par client
            </button>
          </div>
          {!ragReady.enabled ? (
            <div className="sorter-consent">
              <strong>Consentement requis</strong>
              <p>Autoriser l’indexation du dossier pour utiliser la fonction d’organisation.</p>
            </div>
          ) : null}
          <button className="primary-button" disabled={!canPrepare}>
            Préparer l’organisation
          </button>
        </form>
      </section>
    </div>
  );
}
