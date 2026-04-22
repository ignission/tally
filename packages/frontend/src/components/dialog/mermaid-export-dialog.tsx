'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { buildMermaid } from '@/lib/mermaid';
import { useCanvasStore } from '@/lib/store';

interface Props {
  open: boolean;
  onClose: () => void;
}

// 現在のキャンバスを Mermaid flowchart として書き出すダイアログ。
// 右ペインでビューワープレビュー (mermaid.render) も行う。
type ViewMode = 'preview' | 'source';

export function MermaidExportDialog({ open, onClose }: Props) {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const [direction, setDirection] = useState<'LR' | 'TB'>('LR');
  const [mode, setMode] = useState<ViewMode>('preview');
  const [copied, setCopied] = useState(false);
  const [renderedSvg, setRenderedSvg] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const source = useMemo(
    () => buildMermaid(Object.values(nodes), Object.values(edges), { direction }),
    [nodes, edges, direction],
  );

  // mermaid は dynamic import: SSR で window 参照を避け、初回レンダのバンドルも軽くする。
  // mermaid は securityLevel='strict' でサニタイズ済みの SVG を返すが、念のため
  // DOMPurify で二重サニタイズしてから dangerouslySetInnerHTML へ流す。
  useEffect(() => {
    if (!open || mode !== 'preview') return;
    let cancelled = false;
    (async () => {
      try {
        const [mermaidMod, dompurifyMod] = await Promise.all([
          import('mermaid'),
          import('dompurify'),
        ]);
        const mermaid = mermaidMod.default;
        const DOMPurify = dompurifyMod.default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'strict',
          flowchart: { htmlLabels: true, curve: 'basis' },
        });
        const id = `tally-mermaid-${Date.now()}`;
        const { svg } = await mermaid.render(id, source);
        // DOMPurify の svg profile は foreignObject を削除するため、
        // Mermaid の HTML ラベルを残すように ADD_TAGS / ADD_ATTR で明示許可する。
        // securityLevel='strict' 側でユーザー入力は既に sanitize 済みなので二重防御。
        const clean = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true, html: true },
          ADD_TAGS: ['foreignObject'],
          ADD_ATTR: ['xmlns', 'requiredExtensions'],
        });
        if (!cancelled) {
          setRenderedSvg(clean);
          setRenderError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setRenderedSvg('');
          setRenderError(String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, source]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('clipboard failed', err);
    }
  };

  return (
    <div style={CONTAINER_STYLE}>
      <button type="button" aria-label="閉じる" onClick={onClose} style={BACKDROP_STYLE} />
      <dialog open aria-modal="true" aria-label="Mermaid エクスポート" style={DIALOG_STYLE}>
        <div style={HEADER_STYLE}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Mermaid ビューワー / エクスポート</div>
          <div style={{ fontSize: 11, color: '#8b949e' }}>
            {Object.values(nodes).length} ノード / {Object.values(edges).length} エッジ
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={() => setMode('preview')}
                style={dirButtonStyle(mode === 'preview')}
              >
                プレビュー
              </button>
              <button
                type="button"
                onClick={() => setMode('source')}
                style={dirButtonStyle(mode === 'source')}
              >
                ソース
              </button>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={() => setDirection('LR')}
                style={dirButtonStyle(direction === 'LR')}
              >
                横 (LR)
              </button>
              <button
                type="button"
                onClick={() => setDirection('TB')}
                style={dirButtonStyle(direction === 'TB')}
              >
                縦 (TB)
              </button>
            </div>
          </div>
        </div>

        {mode === 'preview' ? (
          <div style={PREVIEW_WRAPPER_STYLE}>
            {renderError ? (
              <div style={ERROR_STYLE}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>レンダリング失敗</div>
                <div style={{ fontSize: 11 }}>{renderError}</div>
              </div>
            ) : renderedSvg ? (
              <div
                ref={previewRef}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid が securityLevel='strict' でサニタイズした SVG を更に DOMPurify で sanitize 済み
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: renderedSvg }}
                style={SVG_CONTAINER_STYLE}
              />
            ) : (
              <div style={{ color: '#8b949e', fontSize: 12 }}>レンダリング中…</div>
            )}
          </div>
        ) : (
          <textarea readOnly value={source} style={TEXTAREA_STYLE} />
        )}

        <div style={HINT_STYLE}>
          コピーして Slack / Notion / Confluence / GitHub の Mermaid
          コードブロックに貼ると同じ図が表示される。
        </div>

        <div style={FOOTER_STYLE}>
          <button type="button" onClick={onClose} style={CANCEL_STYLE}>
            閉じる
          </button>
          <button type="button" onClick={copy} style={COPY_STYLE}>
            {copied ? 'コピー済み ✓' : 'クリップボードにコピー'}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function dirButtonStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? '#2d333b' : 'transparent',
    color: '#c9d1d9',
    border: `1px solid ${active ? '#8b949e' : '#30363d'}`,
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 11,
    cursor: 'pointer',
  };
}

const CONTAINER_STYLE = {
  position: 'fixed' as const,
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const BACKDROP_STYLE = {
  position: 'absolute' as const,
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  border: 'none',
  padding: 0,
  cursor: 'default',
};

const DIALOG_STYLE = {
  position: 'relative' as const,
  width: 680,
  maxHeight: '80vh',
  display: 'flex',
  flexDirection: 'column' as const,
  background: '#161b22',
  color: '#e6edf3',
  borderRadius: 10,
  border: '1px solid #30363d',
  padding: 20,
  boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
  gap: 12,
};

const HEADER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const TEXTAREA_STYLE = {
  flex: 1,
  minHeight: 280,
  background: '#0d1117',
  color: '#c9d1d9',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: 10,
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.5,
  resize: 'vertical' as const,
};

const PREVIEW_WRAPPER_STYLE = {
  flex: 1,
  minHeight: 280,
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: 10,
  overflow: 'auto' as const,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const SVG_CONTAINER_STYLE = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const ERROR_STYLE = {
  color: '#f85149',
  background: '#2a0f10',
  border: '1px solid #7a2020',
  borderRadius: 6,
  padding: 10,
  fontSize: 12,
  width: '100%',
};

const HINT_STYLE = {
  fontSize: 11,
  color: '#8b949e',
  lineHeight: 1.5,
};

const FOOTER_STYLE = {
  display: 'flex',
  justifyContent: 'flex-end' as const,
  gap: 8,
};

const CANCEL_STYLE = {
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 12,
  cursor: 'pointer',
};

const COPY_STYLE = {
  background: '#238636',
  color: '#fff',
  border: '1px solid #1a6b2c',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 12,
  cursor: 'pointer',
};
