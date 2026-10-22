/**
 * Comprehensive technical documentation of challenges implementing
 * WebGPU / WebAssembly local GGUF inference in browsers.
 */

export const TECHNICAL_CHALLENGES = [
  {
    title: '1. メモリ制約と WebAssembly 32-bit の壁',
    badge: '最重要課題',
    badgeColor: 'rose',
    summary: 'ブラウザのWasm実行環境は最大4GB（実質2〜3GB）のアドレス空間しか持てず、巨大なモデルを展開できない。',
    details: `
- **Wasm 32-bit の制限**: 現在ほとんどのブラウザで標準動作する WebAssembly は 32-bit ポインタを使用しており、単一インスタンスのメモリ上限は 4GB (通常はブラウザ実装により 2GB〜3GB程度) です。
- **タブの OOM (Out of Memory)**: 3B〜8Bクラスのモデル（2GB〜5GB）を読み込もうとすると、KVキャッシュや作業メモリと合わせて上限を超え、ブラウザのタブがクラッシュします。
- **解決策**:
  1. 0.5B〜1.5B 程度の超小型量子化モデル（Q4_K_M）を採用する。
  2. \`llama-gguf-split\` で 512MB 程度のチャンクにファイルを分割し、段階的にロードする。
  3. 将来的な Wasm 64-bit (Memory64 proposal) の普及を待つ。
    `,
  },
  {
    title: '2. ディスクアクセスと mmap の欠如',
    badge: 'I/O制約',
    badgeColor: 'amber',
    summary: 'ブラウザにはゼロコピーでディスクを仮想メモリにマッピングする mmap API が存在しない。',
    details: `
- **ネイティブ llama.cpp の設計**: ネイティブ環境では OS の \`mmap\` システムコールを使い、巨大な GGUF ファイル全体をメモリにロードせず、ディスク上の必要なウェイトだけをオンデマンドでページフォールト読み込みします。
- **ブラウザでの困難**: ブラウザのサンドボックス内ではローカルファイルシステムへの直接 mmap が許可されていません。\`<input type="file">\` で読み込む場合、通常はメモリ上にコピー（ArrayBuffer）を作成する必要があり、2重のメモリ消費が発生します。
- **解決策**:
  - **OPFS (Origin Private File System)**: Web Workers 内部で高速同期アクセスが可能な \`FileSystemSyncAccessHandle\` を使用し、ブロック単位で必要なテンソルだけを読み込む疑似 mmap 機構を構築する（wllama や Emscripten の仮想ファイルシステム）。
    `,
  },
  {
    title: '3. WebGPU と GGUF の量子化形式の相性',
    badge: 'GPU難関',
    badgeColor: 'indigo',
    summary: 'GGUF の高度なブロック量子化（K-quants等）を WebGPU (WGSL) で計算するには専用シェーダーの実装が必要。',
    details: `
- **多種多様な量子化フォーマット**: GGUF は Q4_0, Q4_K_M, Q5_K_M, Q8_0, IQ4 など、精度とサイズを極限まで最適化した独自ブロック量子化構造を持っています。
- **WebGPU のシェーダー実装コスト**: WebGPU でこれらを高速実行するには、各量子化形式のビットアンパック、スケール係数の乗算、行列ベクトル積（GEMV）を WGSL (WebGPU Shading Language) で職人芸的に最適化して実装する必要があります。
- **バッファ制限 (maxBufferSize)**: WebGPU のハードウェア制限として、単一バッファの最大サイズ (\`maxStorageBufferBindingSize\`) が 128MB〜1GB 程度に制限されている端末が多く、大きなテンソルを1つのバッファに置くことができず分割管理が必須となります。
- **現状の最適解**: wllama V3 では、llama.cpp 本体の WebGPU バックエンドPRの成果を取り込み、部分的なレイヤーオフロード (\`n_gpu_layers\`) を可能にしています。
    `,
  },
  {
    title: '4. マルチスレッドと Cross-Origin Isolation (COOP/COEP)',
    badge: 'セキュリティ要件',
    badgeColor: 'emerald',
    summary: 'CPU (Wasm SIMD) で快適な速度を出すには SharedArrayBuffer が必須だが、厳格な HTTP ヘッダー設定が要求される。',
    details: `
- **マルチスレッドの必要性**: LLM のプロンプト評価（Prefill）やトークン生成（Decode）は計算量が膨大で、シングルスレッドでは毎秒 1〜2 トークン以下に落ち込みます。マルチコアを活用することで 5〜10 倍高速化されます。
- **Spectre 脆弱性対策の制約**: ブラウザは \`SharedArrayBuffer\` によるスレッド間共有メモリを、Spectre 脆弱性への対抗措置としてデフォルトでブロックしています。
- **必須要件**:
  - \`Cross-Origin-Opener-Policy: same-origin\` (COOP)
  - \`Cross-Origin-Embedder-Policy: require-corp\` (COEP)
  この2つの HTTP レスポンスヘッダーが正しく設定されたサーバーから配信されないと、マルチスレッドが無効化され、シングルスレッドでしか動作しません。
    `,
  },
  {
    title: '5. チャットテンプレートとトークナイザーの互換性',
    badge: '推論精度',
    badgeColor: 'sky',
    summary: '各モデル（Llama, Qwen, ChatML 等）固有の Jinja2 プロンプト形式をブラウザ上で正確にパースする必要がある。',
    details: `
- **モデルごとの書式差異**: 近年のオープンソース LLM は、それぞれ異なる制御トークン（例: \`<|im_start|>\`, \`<|begin_of_text|>\`, \`<|user|>\` など）を使用しています。
- **フォーマットが崩れるとどうなるか**: プロンプトテンプレートが正しく適用されないと、AI が自分自身で会話を続けたり、不要な終了タグを出力したり、幻覚（ハルシネーション）が激増します。
- **解決策**: GGUF ファイルに埋め込まれている Jinja2 テンプレートとメタデータを Wasm 側（llama-server の server-context）で自動解釈し、OpenAI 互換のメッセージ配列（messages: [{ role, content }]）から正しいプロンプト文字列を動的に組み立てます。
    `,
  },
];
