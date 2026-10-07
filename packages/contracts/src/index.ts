import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;
export const API_SCHEMA_VERSION = 1 as const;
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;
export const PRODUCT_LIMITS = {
  indexedDocuments: 300,
  sortedDocuments: 200,
  textBytes: 2 * 1024 * 1024,
  documentBytes: 20 * 1024 * 1024,
  pdfPages: 100,
  workbookSheets: 10,
  sheetCharacters: 100_000,
  indexCharacters: 3_000_000,
} as const;

export function indexingSizeWarning(path: string, size: number): string | undefined {
  const extension = '.' + (path.split('.').at(-1) ?? '').toLowerCase();
  // Images contribute only file metadata; their binary size does not affect indexing.
  if (IMAGE_MIME_TYPES[extension]) return undefined;
  const text = (ALLOWED_TEXT_EXTENSIONS as readonly string[]).includes(extension);
  const limit = text ? PRODUCT_LIMITS.textBytes : PRODUCT_LIMITS.documentBytes;
  return size > limit
    ? `Fichier non indexé : taille supérieure à ${limit / (1024 * 1024)} Mio.`
    : undefined;
}
export const IMAGE_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

export function ignoredFileReason(path: string): string | undefined {
  const name = (path.split('/').at(-1) ?? '').toLowerCase();
  if (name.startsWith('~$') || /\.(tmp|asd)$/.test(name))
    return 'Fichier temporaire ou de récupération Office.';
  if (/\.(bak|backup)$/.test(name) || name.endsWith('~')) return 'Copie de sauvegarde.';
  if (/\.(lnk|bat|cmd|joboptions|dot|dotx|dotm)$/.test(name))
    return 'Raccourci, script, réglage ou modèle technique.';
  if (['thumbs.db', 'desktop.ini', '.ds_store'].includes(name))
    return 'Fichier technique du système.';
  return undefined;
}
export const ALLOWED_TEXT_EXTENSIONS = [
  '.txt',
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.html',
] as const;
export const ALLOWED_PREVIEW_EXTENSIONS = [
  ...ALLOWED_TEXT_EXTENSIONS,
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
] as const;

export const WorkspaceRecordSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(255),
  rootPath: z.string().min(1),
  access: z.enum(['read-only', 'read-write']).transform(() => 'read-only' as const),
});
export type WorkspaceRecord = z.infer<typeof WorkspaceRecordSchema>;

export const WorkspaceSummarySchema = WorkspaceRecordSchema.omit({ rootPath: true });
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

export const RagModelsSchema = z.object({
  generationModel: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
  embeddingModel: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
});
export type RagModels = z.infer<typeof RagModelsSchema>;

export type AuthAccount = {
  id: string;
  email: string;
  activationDate: string;
  apiAvailable: boolean;
};

export type AuthState = { authenticated: false } | { authenticated: true; account: AuthAccount };

export const SettingsSchema = z.object({
  schemaVersion: z.literal(1),
  workspaces: z.array(WorkspaceRecordSchema),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const RagConfigurationSchema = z.object({
  generationModel: z.string().min(1),
  embeddingModel: z.string().min(1),
  similarityTopK: z.number().int().min(1).max(5),
});
export type RagConfiguration = z.infer<typeof RagConfigurationSchema>;

const EnvelopeBaseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: z.string().uuid().optional(),
});

export const MainToServerMessageSchema = z.discriminatedUnion('type', [
  EnvelopeBaseSchema.extend({
    type: z.literal('server.configure'),
    payload: z.object({
      secret: z.string().min(43),
      rendererPath: z.string().min(1),
      dataPath: z.string().min(1),
      appVersion: z.string().min(1),
      workspaces: z.array(WorkspaceRecordSchema),
      authenticated: z.boolean(),
      apiKey: z.string().min(20).optional(),
      apiBaseUrl: z.string().url().optional(),
      ragConfiguration: RagConfigurationSchema,
    }),
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal('workspace.replaceAll'),
    payload: z.object({ workspaces: z.array(WorkspaceRecordSchema) }),
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal('rag.configure'),
    payload: z.object({
      apiKey: z.string().min(20).optional(),
      apiBaseUrl: z.string().url().optional(),
    }),
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal('rag.models.configure'),
    payload: z.object({
      apiKey: z.string().min(20).optional(),
      apiBaseUrl: z.string().url().optional(),
      ragConfiguration: RagConfigurationSchema,
    }),
  }),
  EnvelopeBaseSchema.extend({ type: z.literal('server.shutdown'), payload: z.object({}) }),
]);
export type MainToServerMessage = z.infer<typeof MainToServerMessageSchema>;

export const ServerToMainMessageSchema = z.discriminatedUnion('type', [
  EnvelopeBaseSchema.extend({
    type: z.literal('server.ready'),
    payload: z.object({ port: z.number().int().min(1).max(65_535) }),
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal('server.error'),
    payload: z.object({ code: z.string(), message: z.string(), correlationId: z.string() }),
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal('server.configuration-applied'),
    payload: z.object({}),
  }),
  EnvelopeBaseSchema.extend({ type: z.literal('server.stopped'), payload: z.object({}) }),
]);
export type ServerToMainMessage = z.infer<typeof ServerToMainMessageSchema>;

export const ListQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  path: z.string().max(4096).optional().default(''),
});
export const PreviewRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  path: z.string().min(1).max(4096),
});

export const VirtualTreeStatusSchema = z.enum([
  'identity',
  'generating',
  'preview',
  'active',
  'reindexing',
  'stale',
  'error',
]);
export type VirtualTreeStatus = z.infer<typeof VirtualTreeStatusSchema>;

export const VirtualRuleSchema = z.object({
  id: z.string().min(1).max(128),
  order: z.number().int().nonnegative(),
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(1_000),
  targetPattern: z.string().min(1).max(500),
  fallback: z.boolean(),
});
export type VirtualRule = z.infer<typeof VirtualRuleSchema>;

export const VirtualMappingEntrySchema = z.object({
  documentId: z.string().min(1).max(128),
  physicalRelativePath: z.string().min(1).max(4096),
  physicalSha256: z.string().length(64),
  virtualPath: z.string().min(1).max(4096),
  status: z.enum(['mapped', 'identity', 'unclassified']),
  ruleId: z.string().min(1).max(128).optional(),
  reason: z.string().min(1).max(1_000).optional(),
});
export type VirtualMappingEntry = z.infer<typeof VirtualMappingEntrySchema>;

export const VirtualTreeSchema = z.object({
  schemaVersion: z.literal(1),
  workspaceId: z.string().uuid(),
  status: VirtualTreeStatusSchema,
  instruction: z.string().max(4_000).nullable(),
  rules: z.array(VirtualRuleSchema).max(100),
  inventoryFingerprint: z.string().length(64),
  generatedAt: z.string().datetime(),
  entries: z.array(VirtualMappingEntrySchema).max(1_000),
  summary: z.object({
    documents: z.number().int().nonnegative(),
    groups: z.number().int().nonnegative(),
    mapped: z.number().int().nonnegative(),
    identity: z.number().int().nonnegative(),
    unclassified: z.number().int().nonnegative(),
  }),
});
export type VirtualTree = z.infer<typeof VirtualTreeSchema>;

export const VirtualTreeQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  mode: z.enum(['active', 'physical']).optional().default('active'),
});
export const VirtualTreePreviewRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  instruction: z.string().trim().min(10).max(4_000),
});
export const VirtualTreeActivateRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  inventoryFingerprint: z.string().length(64),
});

export const RagFieldTypeSchema = z.enum(['number', 'currency', 'percentage', 'text', 'date']);
export type RagFieldType = z.infer<typeof RagFieldTypeSchema>;

export const RagFieldSchema = z.object({
  key: z.string().min(1).max(128),
  label: z.string().min(1).max(255),
  type: RagFieldTypeSchema,
  value: z.union([z.string(), z.number()]),
  unit: z.string().max(32).optional(),
  citationIds: z.array(z.string().min(1)).min(1),
});
export type RagField = z.infer<typeof RagFieldSchema>;

export const RagCitationSchema = z.object({
  id: z.string().min(1),
  documentPath: z.string().min(1).max(4096),
  documentName: z.string().min(1).max(255),
  excerpt: z.string().max(1_000),
  page: z.number().int().positive().optional(),
  sheet: z.string().max(255).optional(),
});
export type RagCitation = z.infer<typeof RagCitationSchema>;

export const RagAnswerSchema = z.object({
  answer: z.string().min(1).max(20_000),
  fields: z.array(RagFieldSchema).max(25),
  citations: z.array(RagCitationSchema).max(20),
});
export type RagAnswer = z.infer<typeof RagAnswerSchema>;

export const WorkspaceIndexStatusSchema = z.enum([
  'not_indexed',
  'indexing',
  'ready',
  'stale',
  'error',
]);
export type WorkspaceIndexStatus = z.infer<typeof WorkspaceIndexStatusSchema>;

export const RagStatusSchema = z.object({
  workspaceId: z.string().uuid(),
  enabled: z.boolean(),
  keyConfigured: z.boolean(),
  status: WorkspaceIndexStatusSchema,
  indexedDocuments: z.number().int().nonnegative(),
  skippedDocuments: z.number().int().nonnegative(),
  progress: z.number().min(0).max(1).optional(),
  lastIndexedAt: z.string().datetime().nullable(),
  error: z.string().max(500).optional(),
  phase: z.enum(['inventory', 'extraction', 'embeddings', 'saving']).optional(),
  processedFiles: z.number().int().nonnegative().optional(),
  totalFiles: z.number().int().nonnegative().optional(),
  currentFile: z.string().optional(),
  startedAt: z.string().datetime().optional(),
  resumable: z.boolean().optional(),
});
export type RagStatus = z.infer<typeof RagStatusSchema>;

export const IndexReportSchema = z.object({
  workspaceId: z.string().uuid(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
  indexedFiles: z.array(z.string()),
  notIndexed: z.array(z.object({ path: z.string(), code: z.string(), reason: z.string() })),
  notes: z.array(z.string()),
});
export type IndexReport = z.infer<typeof IndexReportSchema>;

export const WorkspaceIdSchema = z.object({ workspaceId: z.string().uuid() });
export const RagConsentRequestSchema = WorkspaceIdSchema.extend({ enabled: z.boolean() });
export const RagQueryRequestSchema = WorkspaceIdSchema.extend({
  question: z.string().trim().min(3).max(2_000),
});
export const CreateIndicatorRequestSchema = WorkspaceIdSchema.extend({
  title: z.string().trim().min(1).max(120),
  query: z.string().trim().min(3).max(2_000),
  selectedFieldKey: z.string().min(1).max(128),
  expectedType: RagFieldTypeSchema,
  initialAnswer: RagAnswerSchema,
});
export const UpdateIndicatorRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
});

export const IndicatorStatusSchema = z.enum(['ready', 'refreshing', 'stale', 'error']);
export const IndicatorSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string().min(1).max(120),
  query: z.string().min(3).max(2_000),
  selectedFieldKey: z.string().min(1).max(128),
  fieldLabel: z.string().min(1).max(200).optional(),
  displayType: RagFieldTypeSchema,
  latestValue: z.union([z.string(), z.number()]).nullable(),
  latestUnit: z.string().max(32).optional(),
  latestCitations: z.array(RagCitationSchema),
  status: IndicatorStatusSchema,
  lastRunAt: z.string().datetime().nullable(),
  lastSuccessfulRunAt: z.string().datetime().nullable(),
  lastError: z.object({ code: z.string(), message: z.string() }).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Indicator = z.infer<typeof IndicatorSchema>;

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
};

export type FileEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
};

export type PreviewMetadata = {
  sha256: string;
  size: number;
  modifiedAt: string;
  indexingWarning?: string;
};
export type PreviewResult =
  | (PreviewMetadata & { kind: 'unavailable'; reason: string })
  | (PreviewMetadata & { kind: 'pdf' })
  | (PreviewMetadata & { kind: 'image' })
  | (PreviewMetadata & { kind: 'text'; content: string })
  | (PreviewMetadata & { kind: 'document'; content: string })
  | (PreviewMetadata & {
      kind: 'spreadsheet';
      sheets: Array<{
        name: string;
        rows: Array<Array<string | number | boolean | null>>;
        truncated: boolean;
      }>;
    });

export type DesktopBridge = {
  getAuthState(): Promise<AuthState>;
  login(email: string, password: string): Promise<AuthState>;
  logout(): Promise<AuthState>;
  selectWorkspace(): Promise<WorkspaceSummary | null>;
  removeWorkspace(workspaceId: string): Promise<{ removed: boolean }>;
  getAppInfo(): Promise<{ version: string; platform: string }>;
  openLogsDirectory(): Promise<void>;
  retryServer(): Promise<void>;
};
