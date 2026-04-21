import React, { useState, useCallback, useRef, useEffect } from 'react';

// ============================================================================
// 型定義
// ============================================================================
const NODE_TYPES = {
  requirement: { label: '要求',       color: '#5b8def', accent: '#8fb0f5', icon: '◆' },
  usecase:     { label: 'UC',         color: '#4caf7a', accent: '#7fc79d', icon: '▶' },
  userstory:   { label: 'ストーリー',   color: '#3fb8c9', accent: '#7dd3e0', icon: '✎' },
  question:    { label: '論点',       color: '#e07a4a', accent: '#f0a07a', icon: '?' },
  coderef:     { label: 'コード',      color: '#8b8b8b', accent: '#b0b0b0', icon: '⌘' },
  issue:       { label: '課題',       color: '#d9a441', accent: '#e6bf75', icon: '!' },
  proposal:    { label: 'AI提案',     color: '#a070c8', accent: '#c4a3dc', icon: '✦' },
};

// SysML 2.0 の要求関係ステレオタイプに準拠した内部識別子。
// UI表示は日本語 (label)、データは英語キー (key) を使用。
const EDGE_TYPES = {
  satisfy: { label: '充足',   dash: '' },           // 上位要求を下位要素が満たす
  contain: { label: '分解',   dash: '10,3,2,3' },    // 親子構造
  derive:  { label: '派生',   dash: '6,4' },        // 導出関係
  refine:  { label: '詳細化', dash: '2,4' },        // 詳細化・影響
  verify:  { label: '検証',   dash: '4,2,1,2' },     // テストによる検証
  trace:   { label: '関連',   dash: '1,3' },        // 弱い関連 (汎用)
};

// ============================================================================
// 初期データ (架空例: TaskFlow タスク管理SaaSに「チーム招待機能」を追加)
// ============================================================================
const initialNodes = [
  // ========== 要求 ==========
  { id: 'req1', type: 'requirement', x: 40, y: 40, title: 'チーム招待機能',
    body: '複数ユーザーから「仕事仲間をプロジェクトに招待したい」と要望。\nメール経由の招待リンクで参加できるようにしたい。',
    kind: 'functional', priority: 'must',
  },
  { id: 'req2', type: 'requirement', x: 40, y: 260, title: '権限レベルの柔軟設定',
    body: '招待時に権限を指定できるようにしたい。\n\n・管理者 / 編集者 / 閲覧者\n・プロジェクト単位で設定\n・後から変更可能',
    kind: 'functional', priority: 'must',
  },
  { id: 'req3', type: 'requirement', x: 40, y: 480, title: '有効期限の管理',
    body: 'セキュリティのため招待リンクに有効期限を設けたい。\n期限切れリンクの再発行も容易に。',
    kind: 'non_functional', priority: 'should',
  },

  // ========== 論点 (未決定の設計判断、オレンジ) ==========
  { id: 'q1', type: 'question', x: 340, y: 260,
    title: '権限の継承ルール',
    body: '招待者の権限は被招待者の権限上限になる？',
    options: [
      { id: 'o1', text: '招待者の権限を上限とする（管理者のみ他管理者を招待可）', selected: false },
      { id: 'o2', text: '招待者は自分以下の権限のみ付与可', selected: false },
      { id: 'o3', text: 'ロール別の制限をDBで設定', selected: false },
    ],
    decision: null,
  },
  { id: 'q2', type: 'question', x: 340, y: 440,
    title: '招待リンクの有効期限',
    body: '招待リンクはどのくらいで失効させる？',
    options: [
      { id: 'o1', text: '24時間', selected: false },
      { id: 'o2', text: '7日間', selected: false },
      { id: 'o3', text: '無期限（明示失効のみ）', selected: false },
      { id: 'o4', text: 'ユーザー設定で選択', selected: false },
    ],
    decision: null,
  },
  { id: 'q3', type: 'question', x: 340, y: 660,
    title: '同一メール宛の複数招待',
    body: '同じメールに未承認の招待が複数ある状態はどう扱う？',
    options: [
      { id: 'o1', text: '新しい招待で古いものを自動失効', selected: false },
      { id: 'o2', text: '複数併存、どれでも承認可', selected: false },
      { id: 'o3', text: '重複を拒否（既存招待のキャンセル後に再招待）', selected: false },
    ],
    decision: null,
  },

  // ========== UC (AI提案状態、紫) ==========
  { id: 'p1', type: 'proposal', x: 340, y: 40,
    title: '[AI] 招待リンクを発行する',
    body: 'アクター: プロジェクト管理者\n事前条件: プロジェクトが存在、管理者としてログイン済み\n主フロー: メール・権限を指定→リンク生成→送信',
    adoptAs: 'usecase',
  },
  { id: 'p2', type: 'proposal', x: 340, y: 120,
    title: '[AI] 招待を承認する',
    body: 'アクター: 被招待者\n事前条件: 招待リンクを持っている\n主フロー: リンクアクセス→ログインor登録→参加完了',
    adoptAs: 'usecase',
  },

  // ========== 既存コード参照 (グレー) ==========
  { id: 'c1', type: 'coderef', x: 640, y: 40, title: 'User モデル',
    body: 'src/domain/user/mod.ts\n\n既存。ユーザーの基本情報とプロジェクト所属を持つ。\n権限は project_members テーブルで管理。',
    filePath: 'src/domain/user/mod.ts',
  },
  { id: 'c2', type: 'coderef', x: 640, y: 200, title: 'Project 集約',
    body: 'src/domain/project/mod.ts\n\n既存。プロジェクトの基本情報とメンバー管理。\n招待機能は未実装。',
    filePath: 'src/domain/project/mod.ts',
  },
  { id: 'c3', type: 'coderef', x: 640, y: 380, title: 'MailSender',
    body: 'src/infra/mail/sender.ts\n\n既存。SendGrid経由でメール送信。\nテンプレート管理あり。',
    filePath: 'src/infra/mail/sender.ts',
  },
  { id: 'c4', type: 'coderef', x: 640, y: 560, title: 'Auth ミドルウェア',
    body: 'src/api/middleware/auth.ts\n\n既存。JWTトークン認証。\n招待リンク用の一時トークン検証は未実装。',
    filePath: 'src/api/middleware/auth.ts',
  },

  // ========== 課題 (黄色) ==========
  { id: 'i1', type: 'issue', x: 640, y: 740,
    title: 'メール配信失敗時の挙動',
    body: 'SendGridエラー時、招待リンクは作成したがメールは届かない状態になる。\n再送機能か、管理画面でリンク表示の必要あり。',
  },
];

const initialEdges = [
  // 要求 → 論点
  { id: 'e1', from: 'req2', to: 'q1', type: 'derive' },
  { id: 'e2', from: 'req3', to: 'q2', type: 'derive' },
  { id: 'e3', from: 'req1', to: 'q3', type: 'derive' },
  // 要求 → UC提案
  { id: 'e4', from: 'req1', to: 'p1', type: 'satisfy' },
  { id: 'e5', from: 'req1', to: 'p2', type: 'satisfy' },
  // UC提案 → 既存コード
  { id: 'e6', from: 'p1', to: 'c2', type: 'refine' },
  { id: 'e7', from: 'p1', to: 'c3', type: 'refine' },
  { id: 'e8', from: 'p2', to: 'c4', type: 'refine' },
  // 要求 → 既存コード
  { id: 'e9', from: 'req2', to: 'c1', type: 'refine' },
  { id: 'e10', from: 'req2', to: 'c2', type: 'refine' },
  // 論点・UC → 課題
  { id: 'e11', from: 'p1', to: 'i1', type: 'derive' },
];

const genId = () => 'n' + Math.random().toString(36).slice(2, 8);
const genEdgeId = () => 'e' + Math.random().toString(36).slice(2, 8);

const NODE_W = 200;
const NODE_H = 130;

// ============================================================================
// メインコンポーネント
// ============================================================================
export default function TallyMobile() {
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);
  const [selectedId, setSelectedId] = useState(null);
  const [connectingFrom, setConnectingFrom] = useState(null); // 接続モード時: 選択元ノードID
  const [sheet, setSheet] = useState(null); // null | 'detail' | 'issues' | 'add' | 'intro' | 'coach'
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, scale: 1 });
  const [hasSeenIntro, setHasSeenIntro] = useState(false);
  const canvasRef = useRef(null);
  const gestureRef = useRef({});

  const selectedNode = nodes.find(n => n.id === selectedId);
  const issues = nodes.filter(n => n.type === 'issue');
  const proposals = nodes.filter(n => n.type === 'proposal');

  // 初回イントロ
  useEffect(() => {
    if (!hasSeenIntro) {
      setSheet('intro');
      setHasSeenIntro(true);
    }
  }, [hasSeenIntro]);

  // ========== ジェスチャ (パン/ピンチ) ==========
  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      gestureRef.current = {
        mode: 'pan',
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        vbX: viewBox.x,
        vbY: viewBox.y,
        startedAt: Date.now(),
      };
    } else if (e.touches.length === 2) {
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const cx = (t1.clientX + t2.clientX) / 2;
      const cy = (t1.clientY + t2.clientY) / 2;
      gestureRef.current = {
        mode: 'pinch',
        startDist: dist,
        startScale: viewBox.scale,
        centerX: cx, centerY: cy,
        vbX: viewBox.x, vbY: viewBox.y,
      };
    }
  };

  const handleTouchMove = (e) => {
    const g = gestureRef.current;
    if (g.mode === 'pan' && e.touches.length === 1) {
      const dx = e.touches[0].clientX - g.startX;
      const dy = e.touches[0].clientY - g.startY;
      setViewBox(vb => ({ ...vb, x: g.vbX + dx, y: g.vbY + dy }));
    } else if (g.mode === 'pinch' && e.touches.length === 2) {
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const newScale = Math.max(0.35, Math.min(2.5, g.startScale * (dist / g.startDist)));
      const rect = canvasRef.current.getBoundingClientRect();
      const cx = g.centerX - rect.left;
      const cy = g.centerY - rect.top;
      // センター基準でズーム
      const dx = (cx - g.vbX) * (newScale / g.startScale - 1);
      const dy = (cy - g.vbY) * (newScale / g.startScale - 1);
      setViewBox({ x: g.vbX - dx, y: g.vbY - dy, scale: newScale });
    }
  };

  const handleTouchEnd = (e) => {
    gestureRef.current = {};
  };

  // ノードタップ
  const handleNodeTap = (e, node) => {
    e.stopPropagation();
    if (connectingFrom) {
      if (connectingFrom === node.id) {
        setConnectingFrom(null);
      } else {
        const exists = edges.some(ed => ed.from === connectingFrom && ed.to === node.id);
        if (!exists) {
          // デフォルトは汎用の trace (後で種別変更可能)
          setEdges(es => [...es, { id: genEdgeId(), from: connectingFrom, to: node.id, type: 'trace' }]);
        }
        setConnectingFrom(null);
      }
      return;
    }
    setSelectedId(node.id);
    setSheet('detail');
  };

  // AIアクション
  const aiAction = (action) => {
    if (!selectedNode) return;
    const node = selectedNode;
    let proposal;
    if (action === 'detail') {
      proposal = {
        id: genId(), type: 'proposal',
        x: node.x, y: node.y + NODE_H + 40,
        title: `[AI] ${node.title}の詳細化`,
        body: `・事前条件: 飲食店がStripe顧客登録済み\n・主フロー: 商品選択→頻度選択→確認→確定\n・代替: 在庫不足時は登録不可\n・事後条件: Subscription作成、次回配送日登録`,
      };
    } else if (action === 'findcode') {
      proposal = {
        id: genId(), type: 'proposal',
        x: node.x + 40, y: node.y + NODE_H + 40,
        title: `[AI] 関連コード候補`,
        body: `・src/domain/order/mod.rs (近いが定期ではない)\n・src/infra/stripe.rs (charge のみ)\n・src/application/order_service.rs\n\n新規: src/domain/subscription/`,
      };
    } else if (action === 'impact') {
      proposal = {
        id: genId(), type: 'proposal',
        x: node.x + 20, y: node.y + NODE_H + 40,
        title: `[AI] 影響分析`,
        body: `・Order: Subscription参照追加\n・Product: おまかせ型SKU新設\n・Stripe: Subscription API移行\n・日次バッチ追加\n・既存テスト13箇所修正`,
      };
    } else if (action === 'stories') {
      // UCからユーザーストーリー3つを派生
      const stories = [
        {
          title: `${node.title}(基本フロー)`,
          body: `飲食店として\n最低限の入力で登録できる\nなぜなら手早く始めたいから`,
          ac: ['必須項目のみ入力できる', '登録ボタンで即時反映される'],
          tasks: ['入力フォームUI', 'POST エンドポイント'],
          pts: 3,
        },
        {
          title: `${node.title}(バリデーション)`,
          body: `飲食店として\n誤った入力は弾かれてほしい\nなぜなら誤操作で不要な請求が発生すると困るから`,
          ac: ['不正な値はエラー表示', '保存前にクライアント側で検証'],
          tasks: ['バリデーションルール定義', 'エラーUI'],
          pts: 2,
        },
        {
          title: `${node.title}(完了通知)`,
          body: `飲食店として\n登録が成功したら通知を受け取りたい\nなぜなら結果を確実に把握したいから`,
          ac: ['完了画面に次回配送日が表示される', '確認メールが届く'],
          tasks: ['SendGridテンプレート', '次回配送日計算'],
          pts: 2,
        },
      ];
      const newNodes = stories.map((s, i) => ({
        id: genId(), type: 'proposal',
        x: node.x + 260, y: node.y + i * 180,
        title: `[AI] ${s.title}`,
        body: s.body,
        acceptanceCriteria: s.ac.map((t, j) => ({ id: 'ac' + j, text: t, done: false })),
        tasks: s.tasks.map((t, j) => ({ id: 't' + j, text: t, done: false })),
        points: s.pts,
        adoptAs: 'userstory',
      }));
      const newEdges = newNodes.map(nn => ({
        id: genEdgeId(), from: node.id, to: nn.id, type: 'contain',
      }));
      setNodes(ns => [...ns, ...newNodes]);
      setEdges(es => [...es, ...newEdges]);
      return;
    } else if (action === 'questions') {
      // 要素から未決定の論点を洗い出す
      const qs = [
        {
          title: '境界値の扱い',
          body: '境界条件をどう扱うか未定',
          options: [
            { text: '包含（含める）', },
            { text: '排他（含めない）', },
            { text: 'ユーザー設定で切替', },
          ],
        },
        {
          title: 'エラー時の挙動',
          body: '計算失敗時にどう振る舞うか',
          options: [
            { text: 'エラー表示で処理中断', },
            { text: '該当行のみスキップして続行', },
            { text: '既定値で補完', },
          ],
        },
      ];
      const newNodes = qs.map((q, i) => ({
        id: genId(), type: 'proposal',
        x: node.x + 260, y: node.y + i * 200,
        title: `[AI] ${q.title}`,
        body: q.body,
        options: q.options.map((o, j) => ({ id: 'o' + j, text: o.text, selected: false })),
        decision: null,
        adoptAs: 'question',
      }));
      const newEdges = newNodes.map(nn => ({
        id: genEdgeId(), from: node.id, to: nn.id, type: 'derive',
      }));
      setNodes(ns => [...ns, ...newNodes]);
      setEdges(es => [...es, ...newEdges]);
      return;
    } else if (action === 'breakdown') {
      proposal = {
        id: genId(), type: 'proposal',
        x: node.x, y: node.y + NODE_H + 40,
        title: `[AI] 実装タスク分解`,
        body: `・Subscription集約の設計(DDD)\n・frequency値オブジェクト\n・日次バッチで次回配送計算\n・Stripe自動課金連携\n・飲食店UI(スキップ/停止)\n・生産者UI(スキップ申請)`,
      };
    }
    if (proposal) {
      setNodes(ns => [...ns, proposal]);
      // AI提案は元ノードからの派生関係
      setEdges(es => [...es, { id: genEdgeId(), from: node.id, to: proposal.id, type: 'derive' }]);
      setSelectedId(proposal.id);
    }
  };

  const adoptProposal = (newType) => {
    if (!selectedNode) return;
    const targetType = newType || selectedNode.adoptAs || 'usecase';
    setNodes(ns => ns.map(n =>
      n.id === selectedNode.id
        ? { ...n, type: targetType, title: n.title.replace(/^\[AI\]\s*/, '') }
        : n
    ));
  };

  const deleteSelected = () => {
    if (!selectedNode) return;
    setNodes(ns => ns.filter(n => n.id !== selectedNode.id));
    setEdges(es => es.filter(e => e.from !== selectedNode.id && e.to !== selectedNode.id));
    setSelectedId(null);
    setSheet(null);
  };

  const addNodeOfType = (type) => {
    const cx = -viewBox.x / viewBox.scale + 80;
    const cy = -viewBox.y / viewBox.scale + 120;
    const n = {
      id: genId(), type,
      x: cx + Math.random() * 40,
      y: cy + Math.random() * 40,
      title: `新しい${NODE_TYPES[type].label}`,
      body: '',
    };
    setNodes(ns => [...ns, n]);
    setSelectedId(n.id);
    setSheet('detail');
  };

  const addCommentAsIssue = (text) => {
    if (!selectedNode || !text.trim()) return;
    const issue = {
      id: genId(), type: 'issue',
      x: selectedNode.x + 30, y: selectedNode.y + NODE_H + 30,
      title: text.slice(0, 24) + (text.length > 24 ? '…' : ''),
      body: text,
    };
    setNodes(ns => [...ns, issue]);
    setEdges(es => [...es, { id: genEdgeId(), from: selectedNode.id, to: issue.id, type: 'derive' }]);
  };

  const jumpToNode = (nodeId) => {
    const n = nodes.find(x => x.id === nodeId);
    if (!n) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setViewBox({
      x: rect.width / 2 - (n.x + NODE_W / 2) * viewBox.scale,
      y: rect.height / 3 - (n.y + NODE_H / 2) * viewBox.scale,
      scale: viewBox.scale,
    });
    setSelectedId(nodeId);
    setSheet('detail');
  };

  return (
    <div style={styles.root}>
      <style>{globalCSS}</style>

      {/* トップバー */}
      <div style={styles.topbar}>
        <div style={styles.brand}>
          <span style={styles.brandMark}>⚓</span>
          <span style={styles.brandName}>Tally</span>
        </div>
        <button style={styles.iconBtn} onClick={() => setSheet('coach')} aria-label="使い方">?</button>
      </div>
      <div style={styles.subBar}>
        <span style={styles.projectName}>TaskFlow · 招待機能追加</span>
        <span style={styles.zoomChip}>{Math.round(viewBox.scale * 100)}%</span>
      </div>

      {/* 接続モード時のバナー */}
      {connectingFrom && (
        <div style={styles.banner}>
          接続先のノードをタップ
          <button style={styles.bannerCancel} onClick={() => setConnectingFrom(null)}>キャンセル</button>
        </div>
      )}

      {/* キャンバス */}
      <div
        ref={canvasRef}
        style={styles.canvas}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => { if (!connectingFrom) setSelectedId(null); }}
      >
        <svg style={styles.svg}>
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"
              patternTransform={`translate(${viewBox.x % 40} ${viewBox.y % 40}) scale(${viewBox.scale})`}>
              <circle cx="20" cy="20" r="1" fill="#2a2f3a" />
            </pattern>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="#6a7280" />
            </marker>
            <marker id="arrow-p" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="#a070c8" />
            </marker>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          <g transform={`translate(${viewBox.x} ${viewBox.y}) scale(${viewBox.scale})`}>
            {edges.map(edge => {
              const from = nodes.find(n => n.id === edge.from);
              const to = nodes.find(n => n.id === edge.to);
              if (!from || !to) return null;
              const fx = from.x + NODE_W, fy = from.y + NODE_H / 2;
              const tx = to.x, ty = to.y + NODE_H / 2;
              const midX = (fx + tx) / 2;
              const path = `M${fx},${fy} C${midX},${fy} ${midX},${ty} ${tx},${ty}`;
              const isProp = to.type === 'proposal' || from.type === 'proposal';
              const meta = EDGE_TYPES[edge.type] || EDGE_TYPES.trace;
              // エッジ色: AI提案絡みは紫、contain(分解) は水色、それ以外はグレー
              const stroke = isProp ? '#a070c8'
                : edge.type === 'contain' ? '#7dd3e0'
                : '#6a7280';
              return (
                <path key={edge.id} d={path} fill="none"
                  stroke={stroke} strokeWidth="1.8"
                  strokeDasharray={meta.dash}
                  markerEnd={isProp ? 'url(#arrow-p)' : 'url(#arrow)'} opacity="0.85" />
              );
            })}
          </g>
        </svg>

        <div style={{
          position: 'absolute', left: viewBox.x, top: viewBox.y,
          transform: `scale(${viewBox.scale})`, transformOrigin: '0 0',
          pointerEvents: 'none',
        }}>
          {nodes.map(node => {
            const t = NODE_TYPES[node.type];
            const isSelected = node.id === selectedId;
            const isConnectSrc = node.id === connectingFrom;
            const isProposal = node.type === 'proposal';
            const isStory = node.type === 'userstory';
            const ac = node.acceptanceCriteria || [];
            const tasks = node.tasks || [];
            const acDone = ac.filter(x => x.done).length;
            const taskDone = tasks.filter(x => x.done).length;
            const isQuestion = node.type === 'question';
            const opts = node.options || [];
            const selectedOpt = opts.find(o => o.selected);
            const isDecided = isQuestion && !!node.decision;
            return (
              <div key={node.id}
                style={{
                  ...styles.node,
                  left: node.x, top: node.y,
                  width: NODE_W, minHeight: NODE_H,
                  borderColor: isConnectSrc ? '#d9a441' : (isSelected ? t.accent : t.color),
                  boxShadow: isSelected
                    ? `0 0 0 2px ${t.accent}, 0 8px 24px rgba(0,0,0,0.5)`
                    : isConnectSrc
                      ? `0 0 0 2px #d9a441, 0 8px 24px rgba(0,0,0,0.5)`
                      : '0 4px 14px rgba(0,0,0,0.3)',
                  borderStyle: isProposal ? 'dashed'
                    : (isQuestion && !isDecided) ? 'dashed'
                    : 'solid',
                  background: isProposal ? 'rgba(160,112,200,0.08)'
                    : isStory ? '#1d2229'
                    : (isQuestion && !isDecided) ? 'rgba(224,122,74,0.06)'
                    : '#1a1e26',
                  borderRadius: isStory ? '2px 10px 2px 2px' : 6,
                  opacity: (isQuestion && isDecided) ? 0.9 : 1,
                }}
                onClick={(e) => handleNodeTap(e, node)}
                onTouchEnd={(e) => { e.stopPropagation(); }}
              >
                <div style={{...styles.nodeHeader, background: t.color + '22', color: t.accent}}>
                  <span style={styles.nodeIcon}>{t.icon}</span>
                  <span style={styles.nodeTypeLabel}>{t.label}</span>
                  {isStory && node.points != null && (
                    <span style={styles.nodePointsPill}>{node.points}pt</span>
                  )}
                  {isQuestion && (
                    <span style={styles.nodeQuestionPill}>
                      {isDecided ? '決定' : `${opts.length}候補`}
                    </span>
                  )}
                </div>
                <div style={styles.nodeTitle}>{node.title}</div>
                {node.body && <div style={styles.nodeBody}>{node.body}</div>}
                {/* 論点: 決定済なら選択肢を、未決定なら選択肢の件数を表示 */}
                {isQuestion && isDecided && selectedOpt && (
                  <div style={styles.nodeDecision}>
                    <span style={styles.nodeDecisionCheck}>✓</span>
                    <span style={styles.nodeDecisionText}>{selectedOpt.text}</span>
                  </div>
                )}
                {isQuestion && !isDecided && opts.length > 0 && (
                  <div style={styles.nodeOptionsPeek}>
                    {opts.slice(0, 2).map((o, i) => (
                      <div key={o.id} style={styles.nodeOptionPeekRow}>
                        <span style={styles.nodeOptionPeekDot}>○</span>
                        <span style={styles.nodeOptionPeekText}>{o.text}</span>
                      </div>
                    ))}
                    {opts.length > 2 && (
                      <div style={styles.nodeOptionsMore}>他 {opts.length - 2} 件</div>
                    )}
                  </div>
                )}
                {isStory && (ac.length > 0 || tasks.length > 0) && (
                  <div style={styles.nodeProgress}>
                    {ac.length > 0 && (
                      <span style={styles.progressChip}>
                        AC {acDone}/{ac.length}
                      </span>
                    )}
                    {tasks.length > 0 && (
                      <span style={styles.progressChip}>
                        Task {taskDone}/{tasks.length}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ミニマップ的なヒント */}
        {nodes.length === 0 && (
          <div style={styles.emptyHint}>右下の + からノードを追加</div>
        )}
      </div>

      {/* フローティングアクションボタン群 */}
      <div style={styles.fabStack}>
        <button style={styles.fabSmall} onClick={() => {
          const rect = canvasRef.current.getBoundingClientRect();
          setViewBox({ x: 20, y: 20, scale: 0.7 });
        }} aria-label="全体表示">⤢</button>
        <button style={styles.fabSmall} onClick={() => setSheet('issues')} aria-label="課題一覧">
          <span style={styles.fabIcon}>!</span>
          {issues.length > 0 && <span style={styles.badge}>{issues.length}</span>}
        </button>
        <button style={styles.fab} onClick={() => setSheet('add')} aria-label="追加">+</button>
      </div>

      {/* ボトムシート */}
      {sheet && (
        <>
          <div style={styles.scrim} onClick={() => setSheet(null)} />
          <div style={styles.sheet}>
            <div style={styles.sheetHandle} />

            {sheet === 'intro' && (
              <div style={styles.sheetBody}>
                <div style={styles.sheetTitle}>Tally へようこそ</div>
                <p style={styles.introP}>
                  既存システムの機能追加を、視覚的に要件定義するためのツールです。
                </p>
                <p style={styles.introP}>
                  いま画面には「TaskFlow（架空のタスク管理SaaS）に招待機能を追加」というシナリオが載っています。要求(青)、未決定の論点(オレンジ)、既存コード(グレー)、課題(黄)、AI提案(紫) が繋がっています。
                </p>
                <p style={styles.introP}>
                  <b>オレンジの論点ノード</b>は「まだ決めていない設計判断」。選択肢候補を持っていて、タップして選ぶと決定に昇格します。
                </p>
                <div style={styles.introStep}>
                  <span style={styles.introStepNum}>1</span>
                  <div><b>1本指ドラッグ</b>でパン、<b>2本指ピンチ</b>でズーム</div>
                </div>
                <div style={styles.introStep}>
                  <span style={styles.introStepNum}>2</span>
                  <div><b>ノードをタップ</b>で詳細と AI アクション</div>
                </div>
                <div style={styles.introStep}>
                  <span style={styles.introStepNum}>3</span>
                  <div>右下の <b>+</b> で新規ノード、<b>!</b> で課題一覧</div>
                </div>
                <button style={styles.primaryBtn} onClick={() => setSheet(null)}>はじめる</button>
              </div>
            )}

            {sheet === 'coach' && (
              <div style={styles.sheetBody}>
                <div style={styles.sheetTitle}>使い方</div>
                <div style={styles.coachRow}><b>1本指ドラッグ</b>：キャンバスを動かす</div>
                <div style={styles.coachRow}><b>2本指ピンチ</b>：ズーム</div>
                <div style={styles.coachRow}><b>ノードをタップ</b>：詳細シート表示</div>
                <div style={styles.coachRow}><b>詳細シートの AI ボタン</b>：詳細化・関連コード・影響分析・タスク分解</div>
                <div style={styles.coachRow}><b>接続モード</b>：詳細シートの「接続」→相手ノードをタップ</div>
                <div style={styles.coachRow}><b>AI提案(紫・破線)</b>：詳細で「採用」すると正規ノードに</div>
                <div style={styles.coachRow}><b>右下 !</b>：課題一覧・ジャンプ</div>
                <div style={styles.coachRow}><b>右下 ⤢</b>：全体を俯瞰</div>
                <button style={styles.primaryBtn} onClick={() => setSheet(null)}>閉じる</button>
              </div>
            )}

            {sheet === 'add' && (
              <div style={styles.sheetBody}>
                <div style={styles.sheetTitle}>ノードを追加</div>
                <div style={styles.addGrid}>
                  {Object.entries(NODE_TYPES).filter(([k]) => k !== 'proposal').map(([k, v]) => (
                    <button key={k}
                      style={{...styles.addTile, borderColor: v.color}}
                      onClick={() => { addNodeOfType(k); setSheet('detail'); }}>
                      <span style={{...styles.addTileIcon, color: v.color}}>{v.icon}</span>
                      <span style={styles.addTileLabel}>{v.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {sheet === 'issues' && (
              <div style={styles.sheetBody}>
                <div style={styles.sheetTitle}>課題一覧 <span style={styles.countPill}>{issues.length}</span></div>
                {issues.length === 0 && <div style={styles.hint}>課題はまだありません</div>}
                {issues.map(iss => (
                  <div key={iss.id} style={styles.issueCard} onClick={() => jumpToNode(iss.id)}>
                    <div style={styles.issueTitle}>
                      <span style={{color: NODE_TYPES.issue.accent}}>!</span> {iss.title}
                    </div>
                    {iss.body && <div style={styles.issueBody}>{iss.body}</div>}
                    <div style={styles.issueSync}>→ Jira に同期 (mock)</div>
                  </div>
                ))}
              </div>
            )}

            {sheet === 'detail' && selectedNode && (
              <DetailSheet
                node={selectedNode}
                onUpdate={(patch) => setNodes(ns => ns.map(n => n.id === selectedNode.id ? {...n, ...patch} : n))}
                onAI={aiAction}
                onAdopt={adoptProposal}
                onConnect={() => { setConnectingFrom(selectedNode.id); setSheet(null); }}
                onComment={addCommentAsIssue}
                onDelete={deleteSelected}
                onClose={() => setSheet(null)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// 詳細シート
// ============================================================================
function DetailSheet({ node, onUpdate, onAI, onAdopt, onConnect, onComment, onDelete, onClose }) {
  const [commentText, setCommentText] = useState('');
  const [newAC, setNewAC] = useState('');
  const [newTask, setNewTask] = useState('');
  const [newOption, setNewOption] = useState('');
  const t = NODE_TYPES[node.type];
  const isProposal = node.type === 'proposal';
  const isStory = node.type === 'userstory' || (isProposal && node.adoptAs === 'userstory');
  const isUC = node.type === 'usecase';
  const isQuestion = node.type === 'question';

  const ac = node.acceptanceCriteria || [];
  const tasks = node.tasks || [];
  const acDone = ac.filter(x => x.done).length;
  const taskDone = tasks.filter(x => x.done).length;
  const options = node.options || [];

  const toggleAC = (id) => onUpdate({
    acceptanceCriteria: ac.map(x => x.id === id ? { ...x, done: !x.done } : x),
  });
  const toggleTask = (id) => onUpdate({
    tasks: tasks.map(x => x.id === id ? { ...x, done: !x.done } : x),
  });
  const addAC = () => {
    if (!newAC.trim()) return;
    onUpdate({ acceptanceCriteria: [...ac, { id: 'ac' + Date.now(), text: newAC, done: false }] });
    setNewAC('');
  };
  const addTask = () => {
    if (!newTask.trim()) return;
    onUpdate({ tasks: [...tasks, { id: 't' + Date.now(), text: newTask, done: false }] });
    setNewTask('');
  };
  const removeAC = (id) => onUpdate({ acceptanceCriteria: ac.filter(x => x.id !== id) });
  const removeTask = (id) => onUpdate({ tasks: tasks.filter(x => x.id !== id) });
  const selectOption = (id) => {
    onUpdate({
      options: options.map(o => ({ ...o, selected: o.id === id })),
      decision: id,
    });
  };
  const clearDecision = () => {
    onUpdate({
      options: options.map(o => ({ ...o, selected: false })),
      decision: null,
    });
  };
  const addOption = () => {
    if (!newOption.trim()) return;
    onUpdate({
      options: [...options, { id: 'o' + Date.now(), text: newOption, selected: false }],
    });
    setNewOption('');
  };
  const removeOption = (id) => onUpdate({ options: options.filter(o => o.id !== id) });

  return (
    <div style={styles.sheetBody}>
      <div style={{...styles.typeBadge, background: t.color + '22', color: t.accent, borderColor: t.color}}>
        <span>{t.icon}</span> {t.label}
        {isStory && node.points != null && (
          <span style={styles.pointsPill}>{node.points} pt</span>
        )}
        {isQuestion && node.decision && (
          <span style={styles.decidedPill}>決定済</span>
        )}
      </div>

      <input
        style={styles.titleInput}
        value={node.title}
        onChange={e => onUpdate({ title: e.target.value })}
      />
      <textarea
        style={styles.bodyInput}
        value={node.body || ''}
        placeholder={isStory ? '〇〇として / 〜したい / なぜなら〜' : isQuestion ? '何を判断する必要があるか...' : '詳細を記述...'}
        onChange={e => onUpdate({ body: e.target.value })}
      />

      {/* 論点: 選択肢 */}
      {isQuestion && (
        <>
          <div style={styles.sheetSectionLabel}>
            選択肢 {node.decision ? '(決定済)' : '(未決定)'}
          </div>
          {options.map(opt => (
            <div key={opt.id}
              style={{
                ...styles.optionRow,
                ...(opt.selected ? styles.optionRowSelected : {}),
              }}
              onClick={() => selectOption(opt.id)}
            >
              <div style={{
                ...styles.radioDot,
                ...(opt.selected ? styles.radioDotActive : {}),
              }}>
                {opt.selected && <span style={styles.radioInner} />}
              </div>
              <span style={styles.optionText}>{opt.text}</span>
              <button style={styles.removeX} onClick={(e) => { e.stopPropagation(); removeOption(opt.id); }}>×</button>
            </div>
          ))}
          <div style={styles.inlineAddRow}>
            <input
              style={styles.inlineInput}
              value={newOption}
              placeholder="選択肢を追加"
              onChange={e => setNewOption(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addOption()}
            />
            <button style={styles.inlineAddBtn} onClick={addOption}>追加</button>
          </div>
          {node.decision && (
            <button style={styles.clearDecisionBtn} onClick={clearDecision}>
              決定を取り消す
            </button>
          )}
        </>
      )}

      {isProposal && (
        <div style={styles.adoptRow}>
          <div style={styles.adoptLabel}>
            {node.adoptAs === 'userstory' ? 'ストーリーとして採用 →'
              : node.adoptAs === 'question' ? '論点として採用 →'
              : 'AI提案を採用 →'}
          </div>
          {node.adoptAs === 'userstory' ? (
            <button style={styles.adoptBtn} onClick={() => onAdopt('userstory')}>Story</button>
          ) : node.adoptAs === 'question' ? (
            <button style={styles.adoptBtn} onClick={() => onAdopt('question')}>論点</button>
          ) : (
            <>
              <button style={styles.adoptBtn} onClick={() => onAdopt('usecase')}>UC</button>
              <button style={styles.adoptBtn} onClick={() => onAdopt('userstory')}>Story</button>
              <button style={styles.adoptBtn} onClick={() => onAdopt('question')}>論点</button>
              <button style={styles.adoptBtn} onClick={() => onAdopt('requirement')}>要求</button>
              <button style={styles.adoptBtn} onClick={() => onAdopt('issue')}>課題</button>
            </>
          )}
        </div>
      )}

      {/* ストーリー固有: 受け入れ基準 */}
      {isStory && (
        <>
          <div style={styles.sheetSectionLabel}>
            受け入れ基準 <span style={styles.sectionCounter}>{acDone}/{ac.length}</span>
          </div>
          {ac.map(item => (
            <div key={item.id} style={styles.checkRow}>
              <button
                style={{...styles.checkbox, ...(item.done ? styles.checkboxDone : {})}}
                onClick={() => toggleAC(item.id)}
                aria-label="完了"
              >{item.done ? '✓' : ''}</button>
              <span style={{...styles.checkText, ...(item.done ? styles.checkTextDone : {})}}>
                {item.text}
              </span>
              <button style={styles.removeX} onClick={() => removeAC(item.id)} aria-label="削除">×</button>
            </div>
          ))}
          <div style={styles.inlineAddRow}>
            <input
              style={styles.inlineInput}
              value={newAC}
              placeholder="Given/When/Then を追加"
              onChange={e => setNewAC(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addAC()}
            />
            <button style={styles.inlineAddBtn} onClick={addAC}>追加</button>
          </div>
        </>
      )}

      {/* ストーリー固有: タスク */}
      {isStory && (
        <>
          <div style={styles.sheetSectionLabel}>
            実装タスク <span style={styles.sectionCounter}>{taskDone}/{tasks.length}</span>
          </div>
          {tasks.map(item => (
            <div key={item.id} style={styles.checkRow}>
              <button
                style={{...styles.checkbox, ...(item.done ? styles.checkboxDone : {})}}
                onClick={() => toggleTask(item.id)}
                aria-label="完了"
              >{item.done ? '✓' : ''}</button>
              <span style={{...styles.checkText, ...(item.done ? styles.checkTextDone : {})}}>
                {item.text}
              </span>
              <button style={styles.removeX} onClick={() => removeTask(item.id)} aria-label="削除">×</button>
            </div>
          ))}
          <div style={styles.inlineAddRow}>
            <input
              style={styles.inlineInput}
              value={newTask}
              placeholder="タスクを追加"
              onChange={e => setNewTask(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTask()}
            />
            <button style={styles.inlineAddBtn} onClick={addTask}>追加</button>
          </div>

          <div style={styles.sheetSectionLabel}>ストーリーポイント</div>
          <div style={styles.pointsRow}>
            {[1, 2, 3, 5, 8, 13].map(p => (
              <button key={p}
                style={{
                  ...styles.pointBtn,
                  ...(node.points === p ? styles.pointBtnActive : {}),
                }}
                onClick={() => onUpdate({ points: p })}>
                {p}
              </button>
            ))}
          </div>
        </>
      )}

      <div style={styles.sheetSectionLabel}>AIアクション</div>
      <div style={styles.aiGrid}>
        <button style={styles.aiBtn} onClick={() => onAI('detail')}>
          <span style={styles.aiIcon}>✦</span>詳細化
        </button>
        <button style={styles.aiBtn} onClick={() => onAI('findcode')}>
          <span style={styles.aiIcon}>✦</span>関連コード
        </button>
        <button style={styles.aiBtn} onClick={() => onAI('impact')}>
          <span style={styles.aiIcon}>✦</span>影響分析
        </button>
        {isUC ? (
          <button style={styles.aiBtn} onClick={() => onAI('stories')}>
            <span style={styles.aiIcon}>✦</span>ストーリー分解
          </button>
        ) : node.type === 'requirement' ? (
          <button style={styles.aiBtn} onClick={() => onAI('questions')}>
            <span style={styles.aiIcon}>✦</span>論点を洗い出す
          </button>
        ) : (
          <button style={styles.aiBtn} onClick={() => onAI('breakdown')}>
            <span style={styles.aiIcon}>✦</span>タスク分解
          </button>
        )}
      </div>

      <div style={styles.sheetSectionLabel}>コメント → 課題化</div>
      <textarea
        style={styles.commentInput}
        value={commentText}
        placeholder="論点・疑問・TODOを書く"
        onChange={e => setCommentText(e.target.value)}
      />
      <button style={styles.primaryBtn} disabled={!commentText.trim()}
        onClick={() => { onComment(commentText); setCommentText(''); }}>
        課題として登録
      </button>

      <div style={styles.sheetActions}>
        <button style={styles.secondaryBtn} onClick={onConnect}>接続モード</button>
        <button style={styles.dangerBtn} onClick={onDelete}>削除</button>
      </div>
    </div>
  );
}

// ============================================================================
// スタイル
// ============================================================================
const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Fraunces:opsz,wght@9..144,400;9..144,600&display=swap');
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; overscroll-behavior: none; }
  button { font-family: inherit; }
  input:focus, textarea:focus { outline: none; border-color: #8fb0f5 !important; }
  button:active { transform: scale(0.97); }
`;

const font = `'JetBrains Mono', ui-monospace, monospace`;
const serif = `'Fraunces', Georgia, serif`;

const styles = {
  root: {
    width: '100vw', height: '100vh', height: '100dvh',
    display: 'flex', flexDirection: 'column',
    background: '#0e1117', color: '#c8ccd4', fontFamily: font, fontSize: 13,
    overflow: 'hidden', position: 'relative',
    touchAction: 'none',
  },
  topbar: {
    height: 48, flexShrink: 0, background: '#151922',
    borderBottom: '1px solid #242935',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 16px',
  },
  brand: { display: 'flex', alignItems: 'center', gap: 10 },
  brandMark: { fontSize: 18, color: '#d9a441' },
  brandName: { fontFamily: serif, fontSize: 20, fontWeight: 600, color: '#e8ecf3' },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18, background: '#1a1e26',
    border: '1px solid #242935', color: '#8b93a5', fontSize: 16,
    cursor: 'pointer',
  },
  subBar: {
    flexShrink: 0, padding: '8px 16px', background: '#11151d',
    borderBottom: '1px solid #1a1f2a',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: 11,
  },
  projectName: { color: '#8b93a5' },
  zoomChip: {
    background: '#0e1117', border: '1px solid #242935', padding: '2px 8px',
    borderRadius: 4, fontSize: 10, color: '#8b93a5',
  },
  banner: {
    position: 'absolute', top: 96, left: 16, right: 16, zIndex: 50,
    background: '#d9a441', color: '#0e1117', padding: '10px 14px',
    borderRadius: 6, display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', fontSize: 12, fontWeight: 600,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  bannerCancel: {
    background: 'rgba(14,17,23,0.2)', border: 'none', color: '#0e1117',
    padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
    cursor: 'pointer', fontFamily: font,
  },

  canvas: {
    flex: 1, position: 'relative', overflow: 'hidden', background: '#0e1117',
    touchAction: 'none',
  },
  svg: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' },

  node: {
    position: 'absolute',
    background: '#1a1e26', border: '1px solid', borderRadius: 6,
    pointerEvents: 'auto', userSelect: 'none',
  },
  nodeHeader: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '5px 10px', fontSize: 10,
    textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600,
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  nodeIcon: { fontSize: 12 },
  nodeTypeLabel: {},
  nodeTitle: {
    padding: '8px 10px 4px', fontSize: 13, fontWeight: 600, color: '#e8ecf3',
    fontFamily: serif,
  },
  nodeBody: {
    padding: '0 10px 10px', fontSize: 11, color: '#8b93a5',
    whiteSpace: 'pre-wrap', lineHeight: 1.5, maxHeight: 80, overflow: 'hidden',
  },
  emptyHint: {
    position: 'absolute', top: '45%', left: '50%',
    transform: 'translate(-50%, -50%)',
    color: '#3a4150', fontFamily: serif, fontSize: 16, fontStyle: 'italic',
    textAlign: 'center', padding: '0 24px',
  },

  fabStack: {
    position: 'absolute', right: 16, bottom: 24, zIndex: 30,
    display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center',
  },
  fab: {
    width: 56, height: 56, borderRadius: 28,
    background: '#d9a441', color: '#0e1117', border: 'none',
    fontSize: 28, fontWeight: 300, cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  fabSmall: {
    width: 44, height: 44, borderRadius: 22,
    background: '#1a1e26', color: '#c8ccd4', border: '1px solid #2a2f3a',
    fontSize: 16, cursor: 'pointer', position: 'relative',
    boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  fabIcon: { color: '#e6bf75', fontWeight: 600 },
  badge: {
    position: 'absolute', top: -4, right: -4,
    background: '#d9a441', color: '#0e1117', borderRadius: 10,
    minWidth: 18, height: 18, fontSize: 10, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '0 5px',
  },

  scrim: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40,
  },
  sheet: {
    position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
    background: '#151922', borderTop: '1px solid #242935',
    borderRadius: '16px 16px 0 0',
    maxHeight: '80dvh', overflowY: 'auto',
    boxShadow: '0 -12px 32px rgba(0,0,0,0.5)',
    paddingBottom: 'env(safe-area-inset-bottom, 0)',
  },
  sheetHandle: {
    width: 36, height: 4, background: '#3a4150', borderRadius: 2,
    margin: '10px auto 4px',
  },
  sheetBody: { padding: '12px 18px 24px' },
  sheetTitle: {
    fontSize: 16, fontWeight: 600, color: '#e8ecf3', fontFamily: serif,
    marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8,
  },
  sheetSectionLabel: {
    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em',
    color: '#6a7280', margin: '18px 0 8px', fontWeight: 500,
  },
  sheetActions: {
    display: 'flex', gap: 8, marginTop: 20,
  },
  countPill: {
    background: '#d9a441', color: '#0e1117', borderRadius: 10,
    padding: '2px 8px', fontSize: 11, fontWeight: 700,
  },
  hint: { fontSize: 12, color: '#6a7280', lineHeight: 1.6 },

  introP: { fontSize: 13, color: '#c8ccd4', lineHeight: 1.7, margin: '0 0 12px' },
  introStep: {
    display: 'flex', alignItems: 'flex-start', gap: 12, margin: '12px 0',
    fontSize: 13, color: '#c8ccd4', lineHeight: 1.6,
  },
  introStepNum: {
    width: 24, height: 24, borderRadius: 12, background: '#d9a441',
    color: '#0e1117', fontSize: 12, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  coachRow: {
    fontSize: 13, color: '#c8ccd4', lineHeight: 1.7, margin: '10px 0',
  },

  typeBadge: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 10px', borderRadius: 4, border: '1px solid',
    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em',
    fontWeight: 600, marginBottom: 12,
  },
  titleInput: {
    width: '100%', padding: '10px 12px', marginBottom: 8,
    background: '#0e1117', border: '1px solid #242935', borderRadius: 6,
    color: '#e8ecf3', fontFamily: serif, fontSize: 16, fontWeight: 600,
  },
  bodyInput: {
    width: '100%', minHeight: 100, padding: '10px 12px',
    background: '#0e1117', border: '1px solid #242935', borderRadius: 6,
    color: '#c8ccd4', fontFamily: font, fontSize: 13,
    resize: 'vertical', lineHeight: 1.6,
  },

  adoptRow: {
    display: 'flex', alignItems: 'center', gap: 8, marginTop: 14,
    padding: '10px 12px', background: 'rgba(160,112,200,0.08)',
    border: '1px dashed #a070c8', borderRadius: 6, flexWrap: 'wrap',
  },
  adoptLabel: { fontSize: 11, color: '#c4a3dc', flex: 1 },
  adoptBtn: {
    padding: '6px 12px', fontSize: 11, fontWeight: 600,
    background: 'rgba(160,112,200,0.2)', border: '1px solid #a070c8',
    color: '#c4a3dc', borderRadius: 4, cursor: 'pointer',
  },

  aiGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
  },
  aiBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '12px 8px', fontSize: 12, fontWeight: 500,
    background: '#1a1e26', border: '1px solid #2a2f3a',
    color: '#c8ccd4', borderRadius: 6, cursor: 'pointer',
  },
  aiIcon: { color: '#a070c8', fontSize: 13 },

  commentInput: {
    width: '100%', minHeight: 64, padding: '10px 12px', marginBottom: 8,
    background: '#0e1117', border: '1px solid #242935', borderRadius: 6,
    color: '#c8ccd4', fontFamily: font, fontSize: 13, resize: 'vertical',
  },
  primaryBtn: {
    width: '100%', padding: '12px', marginTop: 8,
    background: '#d9a441', border: 'none', borderRadius: 6,
    color: '#0e1117', fontFamily: font, fontSize: 13, fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryBtn: {
    flex: 1, padding: '12px',
    background: '#1a1e26', border: '1px solid #2a2f3a', borderRadius: 6,
    color: '#c8ccd4', fontFamily: font, fontSize: 12, fontWeight: 500,
    cursor: 'pointer',
  },
  dangerBtn: {
    padding: '12px 16px',
    background: 'transparent', border: '1px solid #5a2a2a', borderRadius: 6,
    color: '#e07a7a', fontFamily: font, fontSize: 12, fontWeight: 500,
    cursor: 'pointer',
  },

  addGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
  },
  addTile: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    padding: '18px 12px',
    background: '#1a1e26', border: '1px solid', borderRadius: 6,
    cursor: 'pointer',
  },
  addTileIcon: { fontSize: 22 },
  addTileLabel: { fontSize: 12, fontWeight: 600, color: '#c8ccd4' },

  issueCard: {
    padding: '12px 14px', marginBottom: 10,
    background: '#0e1117', border: '1px solid #2a2f3a', borderRadius: 6,
    cursor: 'pointer',
  },
  issueTitle: { fontSize: 13, color: '#e8ecf3', fontWeight: 600, marginBottom: 4 },
  issueBody: { fontSize: 11, color: '#8b93a5', lineHeight: 1.5, marginBottom: 6 },
  issueSync: { fontSize: 10, color: '#6a7280', fontStyle: 'italic' },

  // ストーリー関連
  nodePointsPill: {
    marginLeft: 'auto', background: 'rgba(63,184,201,0.2)', color: '#7dd3e0',
    padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: 700,
  },
  nodeProgress: {
    display: 'flex', gap: 4, padding: '0 10px 10px', flexWrap: 'wrap',
  },
  progressChip: {
    background: '#0e1117', border: '1px solid #2a2f3a',
    padding: '2px 6px', borderRadius: 3, fontSize: 9,
    color: '#8b93a5', fontWeight: 500,
  },
  pointsPill: {
    marginLeft: 6, background: 'rgba(63,184,201,0.2)', color: '#7dd3e0',
    padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 700,
  },
  sectionCounter: {
    marginLeft: 4, color: '#8b93a5', fontSize: 10, fontWeight: 400,
    textTransform: 'none', letterSpacing: 0,
  },
  checkRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 10px', marginBottom: 4,
    background: '#0e1117', border: '1px solid #1a1f2a', borderRadius: 4,
  },
  checkbox: {
    width: 20, height: 20, flexShrink: 0,
    background: 'transparent', border: '1.5px solid #3a4150', borderRadius: 4,
    color: '#0e1117', fontSize: 13, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer',
  },
  checkboxDone: {
    background: '#7dd3e0', borderColor: '#7dd3e0',
  },
  checkText: {
    flex: 1, fontSize: 12, color: '#c8ccd4', lineHeight: 1.5,
  },
  checkTextDone: {
    textDecoration: 'line-through', color: '#6a7280',
  },
  removeX: {
    width: 22, height: 22, flexShrink: 0,
    background: 'transparent', border: 'none', color: '#6a7280',
    fontSize: 16, cursor: 'pointer',
  },
  inlineAddRow: {
    display: 'flex', gap: 6, marginTop: 6,
  },
  inlineInput: {
    flex: 1, padding: '8px 10px',
    background: '#0e1117', border: '1px solid #242935', borderRadius: 4,
    color: '#c8ccd4', fontFamily: font, fontSize: 12,
  },
  inlineAddBtn: {
    padding: '8px 12px',
    background: '#1a1e26', border: '1px solid #3fb8c9', borderRadius: 4,
    color: '#7dd3e0', fontFamily: font, fontSize: 11, fontWeight: 600,
    cursor: 'pointer',
  },
  pointsRow: {
    display: 'flex', gap: 6, flexWrap: 'wrap',
  },
  pointBtn: {
    flex: 1, minWidth: 44, padding: '10px 8px',
    background: '#0e1117', border: '1px solid #242935', borderRadius: 4,
    color: '#8b93a5', fontFamily: font, fontSize: 13, fontWeight: 600,
    cursor: 'pointer',
  },
  pointBtnActive: {
    background: 'rgba(63,184,201,0.15)', borderColor: '#3fb8c9',
    color: '#7dd3e0',
  },

  // ========== 論点 (question) 関連 ==========
  nodeQuestionPill: {
    marginLeft: 'auto', background: 'rgba(224,122,74,0.2)', color: '#f0a07a',
    padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: 700,
  },
  nodeDecision: {
    display: 'flex', alignItems: 'flex-start', gap: 6,
    padding: '6px 10px 10px', fontSize: 10, color: '#7fc79d',
    lineHeight: 1.4,
  },
  nodeDecisionCheck: {
    flexShrink: 0, color: '#7fc79d', fontWeight: 700, fontSize: 11,
  },
  nodeDecisionText: { fontSize: 10, color: '#c8ccd4' },
  nodeOptionsPeek: { padding: '2px 10px 8px' },
  nodeOptionPeekRow: {
    display: 'flex', alignItems: 'flex-start', gap: 5,
    fontSize: 10, color: '#8b93a5', lineHeight: 1.4, marginBottom: 2,
  },
  nodeOptionPeekDot: { color: '#6a7280', flexShrink: 0, fontSize: 10 },
  nodeOptionPeekText: {
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    flex: 1,
  },
  nodeOptionsMore: {
    fontSize: 9, color: '#6a7280', fontStyle: 'italic', marginTop: 2,
  },
  decidedPill: {
    marginLeft: 6, background: 'rgba(127,199,157,0.2)', color: '#7fc79d',
    padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 700,
  },
  optionRow: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    padding: '10px 12px', marginBottom: 6,
    background: '#0e1117', border: '1px solid #1a1f2a', borderRadius: 6,
    cursor: 'pointer',
  },
  optionRowSelected: {
    background: 'rgba(127,199,157,0.08)', borderColor: '#4caf7a',
  },
  radioDot: {
    width: 18, height: 18, flexShrink: 0, borderRadius: 9,
    border: '2px solid #3a4150',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  radioDotActive: { borderColor: '#7fc79d' },
  radioInner: {
    width: 10, height: 10, borderRadius: 5, background: '#7fc79d',
  },
  optionText: {
    flex: 1, fontSize: 12, color: '#c8ccd4', lineHeight: 1.5,
  },
  clearDecisionBtn: {
    width: '100%', padding: '8px 12px', marginTop: 8,
    background: 'transparent', border: '1px solid #3a4150', borderRadius: 4,
    color: '#8b93a5', fontFamily: font, fontSize: 11, cursor: 'pointer',
  },
};
