# Web-GGUF Studio (WebGPU & WebAssembly ローカル推論)

ブラウザ・ローカル環境で GGUF 形式の LLM モデルを読み込み、完全オフラインでチャット推論ができる Web アプリケーションです。
WebGPU による GPU 並列演算および WebAssembly (SIMD + Multi-threading) を活用しています。

👉 github pagesで公開しています: [https://chaoyinreherb.github.io/Web-GGUF/](https://chaoyinreherb.github.io/Web-GGUF/)

---

## 🚀 クイックスタート

### 1. 開発サーバーの起動
```bash
npm install
npm run dev
```
起動後、ブラウザで `http://localhost:3000` を開きます。

> **重要**: WebAssembly のマルチスレッド機能（`SharedArrayBuffer`）を有効化するため、Vite 開発サーバーでは以下の HTTP レスポンスヘッダーが自動設定されています。
> - `Cross-Origin-Opener-Policy: same-origin`
> - `Cross-Origin-Embedder-Policy: require-corp`

### 2. プロダクションビルド・プレビュー
```bash
npm run build
npm run preview
```

---

## ✨ 主な機能

1. **柔軟な GGUF モデルロード**:
   - **ローカルファイル読み込み**: お手持ちの `.gguf` ファイルをドラッグ＆ドロップまたはファイルダイアログから直接選択（ブラウザ外へのデータ送信一切なし）。
   - **分割ファイル (Shard) 対応**: `llama-gguf-split` で分割されたモデルファイルの一括ロードに対応。
   - **ワンクリック・プリセット**: SmolLM2 (135M, 360M), Qwen2.5 (0.5B), TinyLlama (1.1B), Llama 3.2 (1B) 等のブラウザ動作に最適な小型 GGUF を即座にダウンロード＆キャッシュ。
   - **任意の Hugging Face リポジトリ指定**: リポジトリ名とファイル名を指定して直接ロード。

2. **WebGPU & WebAssembly 最適化**:
   - **WebGPU オフロード**: `n_gpu_layers` パラメータにより GPU への層オフロード数を柔軟に調整可能。
   - **CPU Wasm SIMD + マルチスレッド**: `SharedArrayBuffer` と Web Workers により CPU コアをフル活用。
   - **環境診断ツール**: ブラウザの WebGPU サポート状況、GPU アダプタ情報、バッファ上限値、Wasm SIMD/マルチスレッドの状態をリアルタイム診断。

3. **快適なチャット UI**:
   - リアルタイム・ストリーミング出力
   - 速度メトリクス（tokens/sec, TTFT, 生成トークン数, 所要時間）
   - Markdown & シンタックスハイライト表示
   - 生成パラメータ調整（Temperature, Top-P, Max Tokens, System Prompt）
   - 中断（Abort）およびチャット履歴のクリア

---

## 🧠 ブラウザ・ローカルで GGUF を動かす「実装の難所・技術的課題」

GGUF モデルをブラウザ上で WebGPU / WebAssembly を用いて動作させるにあたり、ネイティブ実行環境と比較して直面する技術的ハードルは以下の 5 点です。

### 1. WebAssembly 32-bit のメモリ上限 (最大 4GB / 実質 2〜3GB)
- **問題**: 現在主流の WebAssembly は 32-bit アドレス空間であり、1 インスタンスで扱えるメモリは最大 4GB（ブラウザの実装上限により実質 2〜3GB）に制限されます。3B〜8B クラスのモデルを直接ロードすると、KV キャッシュや作業メモリを含めて即座に OOM（クラッシュ）となります。
- **対策**:
  - 0.5B〜1.5B 程度の超小型量子化モデル（Q4_K_M など）を使用する。
  - `llama-gguf-split` で 512MB 程度に分割して段階的に読み込む。
  - 将来的な WebAssembly Memory64 の標準化・普及を待つ。

### 2. ディスクアクセスと `mmap` の欠如
- **問題**: ネイティブの `llama.cpp` は OS の `mmap`（メモリマップド I/O）を利用し、モデルウェイト全体をメモリにロードせず、ディスクから必要な部分だけを仮想メモリにマップします。しかし、ブラウザサンドボックス環境には真の `mmap` API が存在しません。
- **対策**:
  - OPFS (Origin Private File System) の `FileSystemSyncAccessHandle` を用い、Web Worker 内でブロック単位で同期的に必要なテンソルをオンデマンド読み込みする疑似 mmap 機構を構築する（本アプリで使用している `@wllama/wllama` がこのアプローチを採用）。

### 3. WebGPU と GGUF の量子化フォーマットの相性
- **問題**: GGUF は多種多様な高密度ブロック量子化（Q4_0, Q4_K_M, Q5_K_M, Q8_0, IQ4 など）を採用しています。これらを GPU で高速演算するには、各量子化形式のアンパック・逆量子化および行列積（GEMM / GEMV）の専用シェーダーを WGSL (WebGPU Shading Language) で個別最適化して記述する必要があります。
- **問題（バッファ制限）**: WebGPU には `maxBufferSize`（環境により 256MB〜2GB）や `maxStorageBufferBindingSize`（128MB〜1GB）といった厳しいバインディング制限があり、巨大なテンソルを単一バッファで扱うことができません。

### 4. マルチスレッド (SharedArrayBuffer) と Cross-Origin Isolation
- **問題**: CPU (Wasm SIMD) で快適な推論速度（毎秒数トークン以上）を達成するには `SharedArrayBuffer` によるマルチスレッドが必須です。しかし Spectre 脆弱性対策のため、サーバー側で以下の HTTP レスポンスヘッダーが付与されていない場合、ブラウザは共有メモリを完全に無効化し、シングルスレッドに強制フォールバックします。
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
- **対策**: ローカルサーバー（Vite / Express 等）でこれらヘッダーを必ず送信する設計とする。

### 5. チャットテンプレート (Jinja2) とトークナイザーの互換性
- **問題**: Llama-3, Qwen, ChatML 等、モデルごとに制御トークン（`<|im_start|>`, `<|begin_of_text|>` など）や対話フォーマットが異なります。フォーマットが崩れると、AI のハルシネーションや自己対話ループが発生します。
- **対策**: GGUF ファイル内のメタデータに格納されている Jinja テンプレートを Wasm 側（`server-context`）で自動解析し、OpenAI 互換のメッセージ配列から動的に正しいプロンプトシーケンスを生成する。
