import { useState, useCallback, useEffect } from 'react';
import { useGateway } from '../gateway/context';
import { usePollingRpc } from '../hooks/usePollingRpc';
import { Card } from '../components/common/Card';
import { Spinner } from '../components/common/Spinner';
import { EmptyState } from '../components/common/EmptyState';
import { Button } from '../components/common/Button';
import { cn } from '../lib/utils';
import { PageTransition } from '../components/motion/PageTransition';
import { FadeIn } from '../components/motion/FadeIn';
import type { GatewayAgentRow, AgentsListResult, AgentFilesListResult, AgentFile } from '../gateway/types';
import {
  Bot,
  ChevronRight,
  File,
  FolderOpen,
  RefreshCw,
  Save,
  Star,
  X,
  AlertTriangle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// AgentCard
// ---------------------------------------------------------------------------

function AgentCard({
  agent,
  selected,
  isDefault,
  onSelect,
}: {
  agent: GatewayAgentRow;
  selected: boolean;
  isDefault: boolean;
  onSelect: () => void;
}) {
  const displayName = agent.identity?.name ?? agent.name ?? agent.id;

  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-left px-3 py-2.5 rounded-lg transition-colors',
        'hover:bg-neutral-800/60',
        selected && 'bg-primary-500/10 border border-primary-500/20',
        !selected && 'border border-transparent',
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="shrink-0 w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center overflow-hidden">
          {agent.identity?.emoji ? (
            <span className="text-base leading-none">{agent.identity.emoji}</span>
          ) : (
            <span className="text-base leading-none font-semibold text-primary-400">
              {displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-neutral-200 truncate">
              {displayName}
            </span>
            {isDefault && (
              <Star size={12} className="text-warning-400 shrink-0" fill="currentColor" />
            )}
          </div>
          <span className="text-[11px] text-neutral-500 font-mono truncate block">
            {agent.id}
          </span>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// FileList
// ---------------------------------------------------------------------------

function FileList({
  files,
  loading,
  error,
  selectedPath,
  onSelectFile,
  onRefresh,
}: {
  files: AgentFile[];
  loading: boolean;
  error: string | null;
  selectedPath: string | null;
  onSelectFile: (file: AgentFile) => void;
  onRefresh: () => void;
}) {
  if (loading && files.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={24} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-error-400 mb-3">{error}</p>
        <Button variant="secondary" onClick={onRefresh}>
          Retry
        </Button>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No files"
        description="This agent has no workspace files."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
          Files ({files.length})
        </h3>
        <Button variant="ghost" onClick={onRefresh}>
          <RefreshCw size={12} />
        </Button>
      </div>

      <div className="space-y-0.5">
        {files.filter((f) => !f.missing).map((file) => {
          const isSelected = selectedPath === file.name;
          return (
            <button
              key={file.name}
              onClick={() => onSelectFile(file)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-md transition-colors flex items-center gap-2.5',
                'hover:bg-neutral-800/50',
                isSelected && 'bg-primary-500/10 border border-primary-500/20',
                !isSelected && 'border border-transparent',
              )}
            >
              <File size={14} className="text-neutral-400 shrink-0" />
              <span className="text-sm text-neutral-200 truncate flex-1">
                {file.name}
              </span>
              <ChevronRight size={14} className="text-neutral-600 shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileEditor
// ---------------------------------------------------------------------------

function FileEditor({
  agentId,
  filePath,
  onClose,
}: {
  agentId: string;
  filePath: string;
  onClose: () => void;
}) {
  const { rpc } = useGateway();
  const [content, setContent] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaveError(null);
    setSaveSuccess(false);

    const res = await rpc<{ file: AgentFile }>('agents.files.get', { agentId, name: filePath });
    if (res.ok && res.payload) {
      const fileContent = res.payload.file?.content ?? '';
      setContent(fileContent);
      setOriginalContent(fileContent);
    } else {
      setError(res.error?.message ?? 'Failed to load file');
    }
    setLoading(false);
  }, [rpc, agentId, filePath]);

  useEffect(() => {
    void fetchContent();
  }, [fetchContent]);

  const isDirty = content !== null && content !== originalContent;

  const handleSave = useCallback(async () => {
    if (content === null) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const res = await rpc('agents.files.set', { agentId, name: filePath, content });
    if (res.ok) {
      setOriginalContent(content);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } else {
      setSaveError(res.error?.message ?? 'Save failed');
    }
    setSaving(false);
  }, [rpc, agentId, filePath, content]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty) {
          void handleSave();
        }
      }
    },
    [isDirty, handleSave],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700/50 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <File size={14} className="text-neutral-400 shrink-0" />
          <span className="text-sm font-medium text-neutral-200 truncate">
            {filePath}
          </span>
          {isDirty && (
            <span className="w-2 h-2 rounded-full bg-warning-400 shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="primary"
            disabled={!isDirty || saving}
            loading={saving}
            onClick={() => void handleSave()}
          >
            <Save size={14} />
            Save
          </Button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-neutral-800 transition-colors text-neutral-400 hover:text-neutral-200"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Feedback */}
      {saveError && (
        <div className="mx-4 mt-2 rounded-md bg-error-500/10 border border-error-500/20 px-3 py-2 text-xs text-error-400">
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div className="mx-4 mt-2 rounded-md bg-success-500/10 border border-success-500/20 px-3 py-2 text-xs text-success-400">
          File saved successfully.
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Spinner size={24} />
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <AlertTriangle size={32} className="text-error-400" />
          <p className="text-sm text-error-400">{error}</p>
          <Button variant="secondary" onClick={() => void fetchContent()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="flex-1 min-h-0 p-4">
          <textarea
            value={content ?? ''}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            className={cn(
              'w-full h-full resize-none rounded-md p-3',
              'bg-neutral-950 border border-neutral-700/50',
              'text-sm text-neutral-200 font-mono leading-relaxed',
              'placeholder-neutral-600',
              'focus:outline-none focus:border-primary-500 focus:shadow-[0_0_0_3px_rgba(14,165,233,0.15)]',
              'transition-colors',
            )}
            placeholder="(empty file)"
          />
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-2 border-t border-neutral-700/50 flex items-center justify-between text-xs text-neutral-500 shrink-0">
        <span>{content !== null ? `${content.length} chars` : '--'}</span>
        <span className="text-neutral-600">Ctrl+S to save</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agents — main page
// ---------------------------------------------------------------------------

export function Agents() {
  const { rpc } = useGateway();
  const { data, loading, error, refresh } = usePollingRpc<AgentsListResult>('agents.list', undefined, 30_000);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

  // File list state
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  const agents = data?.agents ?? [];
  const defaultId = data?.defaultId;
  const selectedAgent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId)
    : undefined;

  const fetchFiles = useCallback(
    async (agentId: string) => {
      setFilesLoading(true);
      setFilesError(null);
      const res = await rpc<AgentFilesListResult>('agents.files.list', { agentId });
      if (res.ok && res.payload) {
        setFiles(res.payload.files ?? []);
      } else {
        setFilesError(res.error?.message ?? 'Failed to load files');
      }
      setFilesLoading(false);
    },
    [rpc],
  );

  const handleSelectAgent = useCallback(
    (agentId: string) => {
      setSelectedAgentId(agentId);
      setSelectedFilePath(null);
      void fetchFiles(agentId);
    },
    [fetchFiles],
  );

  const handleRefreshFiles = useCallback(() => {
    if (selectedAgentId) {
      void fetchFiles(selectedAgentId);
    }
  }, [selectedAgentId, fetchFiles]);

  const handleCloseEditor = useCallback(() => {
    setSelectedFilePath(null);
  }, []);

  const selectedAgentName = selectedAgent?.identity?.name ?? selectedAgent?.name ?? selectedAgent?.id;

  // Loading
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={28} />
      </div>
    );
  }

  // Error
  if (error && !data) {
    return (
      <PageTransition>
        <FadeIn>
          <div className="space-y-6">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold text-neutral-100">Agents</h1>
              <p className="text-sm text-neutral-400 mt-1">Manage agents and their workspace files.</p>
            </div>
            <Card>
              <div className="text-center py-8">
                <p className="text-sm text-error-400">{error}</p>
                <Button variant="secondary" className="mt-3" onClick={refresh}>
                  Retry
                </Button>
              </div>
            </Card>
          </div>
        </FadeIn>
      </PageTransition>
    );
  }

  // Empty
  if (agents.length === 0) {
    return (
      <PageTransition>
        <FadeIn>
          <div className="space-y-6">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold text-neutral-100">Agents</h1>
              <p className="text-sm text-neutral-400 mt-1">Manage agents and their workspace files.</p>
            </div>
            <EmptyState
              icon={Bot}
              title="No agents"
              description="No agents are configured on this gateway."
            />
          </div>
        </FadeIn>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="space-y-4">
        {/* Header */}
        <FadeIn>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold text-neutral-100">Agents</h1>
              <p className="text-sm text-neutral-400 mt-1">
                Manage agents and their workspace files.
              </p>
            </div>
            <Button onClick={refresh} variant="secondary">
              <RefreshCw size={14} />
              Refresh
            </Button>
          </div>
        </FadeIn>

        {/* Breadcrumb */}
        {selectedAgent && (
          <div className="flex items-center gap-1.5 text-xs text-neutral-400">
            <button
              onClick={() => {
                setSelectedAgentId(null);
                setSelectedFilePath(null);
              }}
              className="hover:text-neutral-200 transition-colors"
            >
              Agents
            </button>
            <ChevronRight size={12} className="text-neutral-600" />
            <button
              onClick={handleCloseEditor}
              className={cn(
                'hover:text-neutral-200 transition-colors',
                !selectedFilePath && 'text-neutral-200',
              )}
            >
              {selectedAgentName}
            </button>
            {selectedFilePath && (
              <>
                <ChevronRight size={12} className="text-neutral-600" />
                <span className="text-neutral-200 font-mono">{selectedFilePath}</span>
              </>
            )}
          </div>
        )}

        {/* Three-panel layout */}
        <div className="flex flex-col lg:flex-row gap-4 min-h-[400px] md:min-h-[600px]">
          {/* Left: Agent list */}
          <Card className="lg:w-64 shrink-0 !p-2 overflow-hidden">
            <div className="px-2 pt-1 pb-2">
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                Agents ({agents.length})
              </h3>
            </div>
            <div className="space-y-0.5 overflow-y-auto max-h-[calc(100vh-280px)]">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  selected={selectedAgentId === agent.id}
                  isDefault={agent.id === defaultId}
                  onSelect={() => handleSelectAgent(agent.id)}
                />
              ))}
            </div>
          </Card>

          {/* Middle + Right panels */}
          {selectedAgentId ? (
            <div className="flex flex-col lg:flex-row flex-1 gap-4 min-w-0">
              {/* File browser */}
              <Card
                className={cn(
                  '!p-3 overflow-hidden',
                  selectedFilePath ? 'lg:w-72 shrink-0' : 'flex-1',
                )}
              >
                <div className="overflow-y-auto max-h-[calc(100vh-280px)]">
                  <FileList
                    files={files}
                    loading={filesLoading}
                    error={filesError}
                    selectedPath={selectedFilePath}
                    onSelectFile={(file) => setSelectedFilePath(file.name)}
                    onRefresh={handleRefreshFiles}
                  />
                </div>
              </Card>

              {/* File editor */}
              {selectedFilePath && (
                <Card className="flex-1 !p-0 overflow-hidden min-h-[240px] md:min-h-[400px]">
                  <FileEditor
                    key={selectedFilePath}
                    agentId={selectedAgentId}
                    filePath={selectedFilePath}
                    onClose={handleCloseEditor}
                  />
                </Card>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                icon={Bot}
                title="Select an agent"
                description="Choose an agent from the sidebar to browse and edit its workspace files."
              />
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
