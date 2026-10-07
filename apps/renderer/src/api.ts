import type {
  ApiFailure,
  ApiSuccess,
  FileEntry,
  Indicator,
  PreviewResult,
  RagAnswer,
  RagFieldType,
  RagStatus,
  IndexReport,
  VirtualTree,
  WorkspaceSummary,
} from '@docsteward/contracts';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
    if (init?.body) headers.set('Content-Type', 'application/json');
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch {
    if (init?.signal?.aborted)
      throw new ApiError('REQUEST_TIMEOUT', 'Le chargement a été interrompu. Réessayez.');
    throw new ApiError(
      'SERVER_UNAVAILABLE',
      'Le serveur local ne répond plus. Relancez DocSteward.',
    );
  }
  const payload = (await response.json()) as ApiSuccess<T> | ApiFailure;
  if (!payload.ok)
    throw new ApiError(payload.error.code, payload.error.message, payload.error.details);
  return payload.data;
}

export const api = {
  health: () =>
    request<{ status: 'ready'; version: string; apiSchemaVersion: number }>('/api/health'),
  workspaces: () => request<WorkspaceSummary[]>('/api/workspaces'),
  list: (workspaceId: string, path = '', signal?: AbortSignal) => {
    const params = new URLSearchParams({ workspaceId, path });
    const timeout = AbortSignal.timeout(15_000);
    return request<FileEntry[]>(`/api/fs/list?${params.toString()}`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  },
  activeVirtualTree: (workspaceId: string) =>
    request<VirtualTree | null>(
      `/api/virtual-tree/active?${new URLSearchParams({ workspaceId })}`,
      {
        signal: AbortSignal.timeout(15_000),
      },
    ),
  preview: (workspaceId: string, path: string) =>
    request<PreviewResult>('/api/fs/preview', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, path }),
    }),
  rawUrl: (workspaceId: string, path: string) => {
    const params = new URLSearchParams({ workspaceId, path });
    return `/api/fs/raw?${params.toString()}`;
  },
  ragStatus: (workspaceId: string) =>
    request<RagStatus>(`/api/rag/status?${new URLSearchParams({ workspaceId })}`),
  indexReport: (workspaceId: string) =>
    request<IndexReport | null>(`/api/rag/report?${new URLSearchParams({ workspaceId })}`),
  cancelIndex: (workspaceId: string) =>
    request<{ cancelled: boolean }>('/api/rag/cancel', {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    }),
  setRagConsent: (workspaceId: string, enabled: boolean) =>
    request<{ enabled: boolean }>('/api/rag/consent', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, enabled }),
    }),
  verifyOpenAIKey: () =>
    request<{ valid: boolean }>('/api/rag/verify-key', { method: 'POST', body: '{}' }),
  indexWorkspace: (workspaceId: string) =>
    request<RagStatus>('/api/rag/index', { method: 'POST', body: JSON.stringify({ workspaceId }) }),
  deleteIndex: (workspaceId: string) =>
    request<{ deleted: boolean }>(`/api/rag/index/${workspaceId}`, { method: 'DELETE' }),
  query: (workspaceId: string, question: string) =>
    request<RagAnswer>('/api/rag/query', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, question }),
    }),
  indicators: (workspaceId: string) =>
    request<Indicator[]>(`/api/indicators?${new URLSearchParams({ workspaceId })}`),
  createIndicator: (input: {
    workspaceId: string;
    title: string;
    query: string;
    selectedFieldKey: string;
    expectedType: RagFieldType;
    initialAnswer: RagAnswer;
  }) => request<Indicator>('/api/indicators', { method: 'POST', body: JSON.stringify(input) }),
  renameIndicator: (id: string, title: string) =>
    request<Indicator>(`/api/indicators/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  deleteIndicator: (id: string) =>
    request<{ deleted: boolean }>(`/api/indicators/${id}`, { method: 'DELETE' }),
  refreshIndicator: (id: string, workspaceId: string) =>
    request<Indicator>(`/api/indicators/${id}/refresh`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    }),
  virtualTree: (workspaceId: string, mode: 'active' | 'physical' = 'active') =>
    request<VirtualTree>(
      `/api/virtual-tree?${new URLSearchParams({ workspaceId, mode }).toString()}`,
    ),
  prepareVirtualTree: (workspaceId: string, instruction: string) =>
    request<VirtualTree>('/api/virtual-tree/preview', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, instruction }),
    }),
  discardVirtualTreePreview: (workspaceId: string) =>
    request<{ deleted: boolean }>(
      `/api/virtual-tree/preview?${new URLSearchParams({ workspaceId }).toString()}`,
      { method: 'DELETE' },
    ),
  activateVirtualTree: (workspaceId: string, inventoryFingerprint: string) =>
    request<VirtualTree>('/api/virtual-tree/activate', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, inventoryFingerprint }),
    }),
  reindexVirtualTree: (workspaceId: string) =>
    request<VirtualTree>('/api/virtual-tree/reindex', {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    }),
  resetVirtualTree: (workspaceId: string) =>
    request<VirtualTree>(`/api/virtual-tree?${new URLSearchParams({ workspaceId }).toString()}`, {
      method: 'DELETE',
    }),
};
