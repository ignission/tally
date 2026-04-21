'use client';

import type { Codebase } from '@tally/core';

interface Props {
  codebases: Codebase[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

// 複数 codebase が存在する場合に表示する選択 UI。1 件以下なら null を返す。
export function CodebasePickerSelect({ codebases, value, onChange, disabled }: Props) {
  if (codebases.length <= 1) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label="対象コードベース"
      style={{
        background: '#0d1117',
        color: '#e6edf3',
        border: '1px solid #30363d',
        borderRadius: 4,
        fontSize: 11,
        padding: '2px 6px',
      }}
    >
      {codebases.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
    </select>
  );
}
