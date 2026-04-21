import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { IngestDocumentDialog } from './ingest-document-dialog';

describe('IngestDocumentDialog', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('open=false なら何も描画しない', () => {
    const { container } = render(<IngestDocumentDialog open={false} onClose={() => {}} />);
    expect(container.textContent).toBe('');
  });

  it('open=true で 貼り付け / ディレクトリ タブ + 共通ボタンを表示', () => {
    render(<IngestDocumentDialog open={true} onClose={() => {}} />);
    expect(screen.getByRole('tab', { name: /貼り付け/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /ディレクトリ/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /取り込む/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /キャンセル/ })).toBeDefined();
  });

  it('貼り付けタブは初期選択、textarea が見える', () => {
    render(<IngestDocumentDialog open={true} onClose={() => {}} />);
    expect(screen.getByRole('textbox')).toBeDefined();
    const btn = screen.getByRole('button', { name: /取り込む/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('貼り付けタブでテキスト入力 → startIngestDocument に paste input', () => {
    const spy = vi.fn().mockResolvedValue({ ok: true });
    useCanvasStore.setState({ startIngestDocument: spy } as never);
    render(<IngestDocumentDialog open={true} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '本文' } });
    fireEvent.click(screen.getByRole('button', { name: /取り込む/ }));
    expect(spy).toHaveBeenCalledWith({ source: 'paste', text: '本文' });
  });

  it('ディレクトリタブに切替 → dirPath 入力欄 (デフォルト docs) + 取り込むで docs-dir input', () => {
    const spy = vi.fn().mockResolvedValue({ ok: true });
    useCanvasStore.setState({ startIngestDocument: spy } as never);
    render(<IngestDocumentDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: /ディレクトリ/ }));
    const dirInput = screen.getByLabelText(/ディレクトリ/) as HTMLInputElement;
    expect(dirInput.value).toBe('docs');
    fireEvent.click(screen.getByRole('button', { name: /取り込む/ }));
    expect(spy).toHaveBeenCalledWith({ source: 'docs-dir', dirPath: 'docs' });
  });

  it('ディレクトリタブで dirPath 空なら disabled', () => {
    render(<IngestDocumentDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: /ディレクトリ/ }));
    const dirInput = screen.getByLabelText(/ディレクトリ/) as HTMLInputElement;
    fireEvent.change(dirInput, { target: { value: '' } });
    const btn = screen.getByRole('button', { name: /取り込む/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('他エージェント実行中は全ボタン disabled', () => {
    useCanvasStore.setState({
      runningAgent: { agent: 'analyze-impact', inputNodeId: 'uc-1', events: [] },
    } as never);
    render(<IngestDocumentDialog open={true} onClose={() => {}} />);
    const ingest = screen.getByRole('button', { name: /取り込む/ }) as HTMLButtonElement;
    const cancel = screen.getByRole('button', { name: /キャンセル/ }) as HTMLButtonElement;
    expect(ingest.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
  });

  it('失敗時はテキスト保持 + エラー表示 + ダイアログ維持', async () => {
    const onClose = vi.fn();
    const start = vi
      .fn()
      .mockResolvedValue({ ok: false, errorMessage: 'not_authenticated' });
    useCanvasStore.setState({ startIngestDocument: start } as never);
    render(<IngestDocumentDialog open={true} onClose={onClose} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '要求書' } });
    fireEvent.click(screen.getByRole('button', { name: /取り込む/ }));
    await waitFor(() => {
      expect(screen.getByText(/not_authenticated/)).toBeDefined();
    });
    expect(textarea.value).toBe('要求書');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('キャンセルで onClose + start 呼ばれない', () => {
    const onClose = vi.fn();
    const start = vi.fn();
    useCanvasStore.setState({ startIngestDocument: start } as never);
    render(<IngestDocumentDialog open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /キャンセル/ }));
    expect(onClose).toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});
