'use client';

import type { Codebase, McpServerConfig } from '@tally/core';
import { useEffect, useMemo, useState } from 'react';

import { AuthRequestCard } from '@/components/mcp/auth-request-card';
import { TextInput } from '@/components/ui/text-input';
import { useCanvasStore } from '@/lib/store';
import { FolderBrowserDialog } from './folder-browser-dialog';

// MCP サーバー新規追加時のデフォルト config。oauth.clientId は PR-E4 で required 化
// されたので空文字でも作るが、OAuth 認証は clientId 確定後でないと走れない。
function makeDefaultMcpServer(seq: number): McpServerConfig {
  return {
    id: `atlassian-${seq}`,
    name: 'Atlassian',
    kind: 'atlassian',
    url: '',
    oauth: { clientId: '' },
    options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
  };
}

// UI ローカルの不変 ID を持つ MCP server エントリ。
// React key として用いる `_uid` はマウント時に 1 度だけ割り当て、その後は変更しない。
// `id` は UI で編集可能なため key にすると編集中の再マウント (focus / state リセット)
// や重複入力時の reconciliation 衝突を起こす。`_uid` は永続化対象外で onSave で剥がす。
type McpServerEntry = McpServerConfig & { _uid: string };

function makeUid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // crypto.randomUUID 非対応環境向け fallback (jsdom の古い setup 等)。
  return `mcp-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

// AuthRequestCard を描画してよいかの判定。Route Handler は YAML 上の保存済み設定を
// 読むので、未保存の編集 (id / url / clientId / options など全フィールド) を含む状態で
// Connect させると、UI とサーバーの設定が乖離する。判定は「永続化済み projectMeta の
// 同 id の server と、入力中の row が完全一致するか」を JSON.stringify で全フィールド
// 比較する (codex Major 対応: 個別フィールドだけ比較すると options 編集を素通しする)。
// clientId が空のときも当然 false。
function isOAuthConnectable(
  meta: { mcpServers?: McpServerConfig[] } | null,
  entry: McpServerConfig,
): boolean {
  if (!meta?.mcpServers) return false;
  if (!entry.oauth.clientId) return false;
  const saved = meta.mcpServers.find((s) => s.id === entry.id);
  if (!saved) return false;
  // 完全一致比較: McpServerConfig のフィールドはプリミティブ + 配列 + 浅い object のみで
  // 順序も同じはずなので JSON.stringify で十分。将来 ネストが深くなったら deep-equal に置換。
  return JSON.stringify(saved) === JSON.stringify(entry);
}

export function ProjectSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projectMeta = useCanvasStore((s) => s.projectMeta);
  const patchProjectMeta = useCanvasStore((s) => s.patchProjectMeta);

  const [codebases, setCodebases] = useState<Codebase[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && projectMeta) {
      setCodebases(projectMeta.codebases);
      setMcpServers((projectMeta.mcpServers ?? []).map((s) => ({ ...s, _uid: makeUid() })));
    }
  }, [open, projectMeta]);

  const duplicateIds = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const c of codebases) {
      if (seen.has(c.id)) dup.add(c.id);
      seen.add(c.id);
    }
    return dup;
  }, [codebases]);

  const invalidIds = useMemo(
    () => new Set(codebases.filter((c) => !/^[a-z][a-z0-9-]{0,31}$/u.test(c.id)).map((c) => c.id)),
    [codebases],
  );

  if (!open) return null;

  const saveDisabled = busy || duplicateIds.size > 0 || invalidIds.size > 0;

  const onPickCodebase = (p: string) => {
    const baseSlug =
      p
        .split('/')
        .pop()
        ?.toLowerCase()
        .replace(/[^a-z0-9-]/g, '-') ?? 'cb';
    let id = baseSlug.slice(0, 32) || 'cb';
    while (codebases.some((c) => c.id === id)) {
      id = `${id.slice(0, 28)}-${Math.random().toString(36).slice(2, 4)}`;
    }
    setCodebases([...codebases, { id, label: p.split('/').pop() ?? id, path: p }]);
    setPickerOpen(false);
  };

  const onSave = async () => {
    setBusy(true);
    setError(null);
    try {
      // _uid は UI ローカルの React key 用なので永続化前に剥がす。
      const cleanedMcpServers = mcpServers.map(({ _uid, ...rest }) => rest);
      await patchProjectMeta({ codebases, mcpServers: cleanedMcpServers });
      onClose();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  const addMcpServer = () => {
    // 採番 id は表示初期値として使うが、React key は別途 _uid を割り当てる
    // (id はユーザーが編集できるため key に使うと編集中の再マウントを起こす)。
    const usedIds = new Set(mcpServers.map((s) => s.id));
    let seq = 1;
    while (usedIds.has(`atlassian-${seq}`)) seq += 1;
    setMcpServers([...mcpServers, { ...makeDefaultMcpServer(seq), _uid: makeUid() }]);
  };

  const updateMcpServer = (index: number, next: McpServerConfig) => {
    const list = [...mcpServers];
    const prev = list[index];
    if (!prev) return;
    // 既存エントリの _uid は保持 (フォーム編集で React key が変わるのを防ぐ)。
    list[index] = { ...next, _uid: prev._uid };
    setMcpServers(list);
  };

  const removeMcpServer = (index: number) => {
    setMcpServers(mcpServers.filter((_, i) => i !== index));
  };

  return (
    <div role="dialog" style={BACKDROP}>
      <div style={DIALOG}>
        <h2 style={TITLE}>プロジェクト設定</h2>

        <div style={SECTION}>
          <div style={SECTION_HEADER}>
            コードベース ({codebases.length})
            <button type="button" onClick={() => setPickerOpen(true)} disabled={busy} style={LINK}>
              + コードベースを追加
            </button>
          </div>
          {codebases.length === 0 && <div style={MUTED}>コードベース未設定</div>}
          <ul style={CB_LIST}>
            {codebases.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: path が空の初期行でも一意にするため index を組み合わせる
              <li key={`${c.path}-${i}`} style={CB_ITEM}>
                <TextInput
                  type="text"
                  value={c.id}
                  onChange={(e) => {
                    const next = [...codebases];
                    next[i] = { ...c, id: e.target.value };
                    setCodebases(next);
                  }}
                  disabled={busy}
                  aria-label={`codebase-${i}-id`}
                  style={{ ...INPUT, width: 140 }}
                />
                <TextInput
                  type="text"
                  value={c.label}
                  onChange={(e) => {
                    const next = [...codebases];
                    next[i] = { ...c, label: e.target.value };
                    setCodebases(next);
                  }}
                  disabled={busy}
                  aria-label={`codebase-${i}-label`}
                  style={{ ...INPUT, flex: 1 }}
                />
                <span style={CB_PATH}>{c.path}</span>
                {duplicateIds.has(c.id) && (
                  <span role="alert" style={ERROR_INLINE}>
                    id 重複
                  </span>
                )}
                {invalidIds.has(c.id) && (
                  <span role="alert" style={ERROR_INLINE}>
                    id 形式不正
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setCodebases(codebases.filter((_, j) => j !== i))}
                  disabled={busy}
                  style={LINK}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div style={SECTION}>
          <div style={SECTION_HEADER}>
            MCP サーバー (Atlassian 等の外部連携) ({mcpServers.length})
            <button type="button" onClick={addMcpServer} disabled={busy} style={LINK}>
              + MCP サーバーを追加
            </button>
          </div>
          <div style={MUTED}>
            ADR-0011: OAuth 2.1 フローは Tally プロセスが直接管理します。各 server の 「OAuth Client
            ID」を入力して保存した後、下の「認証する」ボタンで認証フローを 起動してください
            (別タブの認可画面 → 自動で完了)。
          </div>
          {mcpServers.length === 0 && <div style={MUTED}>MCP サーバー未設定</div>}
          <ul style={CB_LIST}>
            {mcpServers.map((s, i) => (
              // _uid は UI ローカルの不変 ID。s.id はフォームで編集可能なため key に使うと
              // 編集中の再マウント (focus / state リセット) や重複入力時の reconciliation
              // 衝突を起こすため避ける (CR 指摘 #19)。
              <li key={s._uid} style={MCP_ITEM}>
                <div style={MCP_ROW}>
                  <TextInput
                    type="text"
                    value={s.id}
                    onChange={(e) => updateMcpServer(i, { ...s, id: e.target.value })}
                    disabled={busy}
                    aria-label={`mcp-${i}-id`}
                    style={{ ...INPUT, width: 160 }}
                    placeholder="atlassian"
                  />
                  <TextInput
                    type="text"
                    value={s.name}
                    onChange={(e) => updateMcpServer(i, { ...s, name: e.target.value })}
                    disabled={busy}
                    aria-label={`mcp-${i}-name`}
                    style={{ ...INPUT, flex: 1 }}
                    placeholder="表示名"
                  />
                  <button
                    type="button"
                    onClick={() => removeMcpServer(i)}
                    disabled={busy}
                    style={LINK}
                  >
                    削除
                  </button>
                </div>
                <div style={MCP_ROW}>
                  <TextInput
                    type="url"
                    value={s.url}
                    onChange={(e) => updateMcpServer(i, { ...s, url: e.target.value })}
                    disabled={busy}
                    aria-label={`mcp-${i}-url`}
                    style={{ ...INPUT, flex: 1 }}
                    placeholder="https://mcp.atlassian.example/v1/mcp"
                  />
                </div>
                <div style={MCP_ROW}>
                  <span style={INPUT_LABEL}>OAuth Client ID</span>
                  <TextInput
                    type="text"
                    value={s.oauth.clientId}
                    onChange={(e) =>
                      updateMcpServer(i, {
                        ...s,
                        oauth: { ...s.oauth, clientId: e.target.value },
                      })
                    }
                    disabled={busy}
                    aria-label={`mcp-${i}-clientId`}
                    style={{ ...INPUT, flex: 1 }}
                    placeholder="OAuth client ID (provider 側で発行)"
                  />
                </div>
                {/* Connect ボタン: Atlassian の認証フローを起動する。
                    オリジナル設定 (= 保存済み + 編集なし) かつ clientId 入力済みのときだけ
                    描画する。未保存の編集を含む状態で Connect すると、Route Handler が
                    YAML 上の古い設定で動いてしまうため。 */}
                {isOAuthConnectable(projectMeta, s) ? (
                  <div style={MCP_AUTH_ROW}>
                    <AuthRequestCard mcpServerId={s.id} mcpServerLabel={s.name} />
                  </div>
                ) : (
                  <div style={MCP_AUTH_HINT}>
                    Connect ボタンは「設定を保存 + Client ID を入力」後に表示されます。
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <div role="alert" style={ERROR}>
            {error}
          </div>
        )}

        <div style={FOOTER}>
          <button type="button" onClick={onClose} disabled={busy} style={CANCEL_BTN}>
            キャンセル
          </button>
          <button
            type="button"
            disabled={saveDisabled}
            onClick={() => void onSave()}
            style={PRIMARY_BTN}
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>

        {pickerOpen && (
          <FolderBrowserDialog
            open
            purpose="add-codebase"
            onConfirm={onPickCodebase}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

// スタイル定数（NewProjectDialog と同じパレット）
const BACKDROP = {
  position: 'fixed' as const,
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const DIALOG = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 8,
  padding: 20,
  width: 720,
  maxWidth: '92vw',
  maxHeight: '85vh',
  overflow: 'auto' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 12,
};
const TITLE = { margin: 0, fontSize: 16, color: '#e6edf3' };
const SECTION = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  padding: 10,
  border: '1px solid #30363d',
  borderRadius: 6,
};
const SECTION_HEADER = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 12,
  color: '#8b949e',
};
const INPUT = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};
const MUTED = { fontSize: 12, color: '#8b949e' };
const CB_LIST = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 6,
};
const CB_ITEM = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap' as const,
};
const MCP_ITEM = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  padding: 8,
  border: '1px solid #30363d',
  borderRadius: 6,
  background: '#0d1117',
};
const MCP_ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap' as const,
};
const MCP_AUTH_ROW = { marginTop: 4 };
const MCP_AUTH_HINT = { fontSize: 11, color: '#8b949e', marginTop: 4 };
const INPUT_LABEL = { fontSize: 11, color: '#8b949e', minWidth: 100 };
const CB_PATH = {
  flex: 1,
  fontSize: 11,
  color: '#8b949e',
  fontFamily: 'ui-monospace, monospace',
};
const ERROR_INLINE = { color: '#f85149', fontSize: 10 };
const LINK = {
  background: 'transparent',
  border: 'none',
  color: '#58a6ff',
  fontSize: 12,
  cursor: 'pointer',
  textDecoration: 'underline' as const,
  padding: 0,
};
const FOOTER = { display: 'flex', justifyContent: 'flex-end', gap: 8 };
const CANCEL_BTN = {
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};
const PRIMARY_BTN = {
  ...CANCEL_BTN,
  background: '#238636',
  color: '#fff',
  border: '1px solid #2ea043',
};
const ERROR = {
  color: '#f85149',
  fontSize: 12,
  padding: '6px 8px',
  border: '1px solid #6e2130',
  borderRadius: 6,
  background: '#2b1419',
};
