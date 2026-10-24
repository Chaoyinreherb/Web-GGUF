import { WllamaEngine } from './wllama-engine.js';
import { detectWebGPU, detectWasmEnvironment, formatBytes } from './webgpu-detector.js';
import { UIController } from './ui-controller.js';
import { PRESET_MODELS } from './presets.js';
import { TECHNICAL_CHALLENGES } from './challenges-content.js';

// Application State
const state = {
  engine: new WllamaEngine({ wasmPath: `${import.meta.env.BASE_URL}wllama.wasm` }),
  ui: null,
  chatHistory: [],
  selectedLocalFiles: [],
  webGPUInfo: null,
  wasmInfo: null,
  currentAiMsgId: null,
};

// Initialize the Application
async function init() {
  state.ui = new UIController();

  // Run diagnostics for WebGPU & Wasm
  state.wasmInfo = detectWasmEnvironment();
  state.ui.setWasmState(state.wasmInfo);

  state.webGPUInfo = await detectWebGPU();
  state.ui.setWebGPUState(state.webGPUInfo);

  // Set initial engine state
  state.ui.setEngineState({ loaded: false });

  // Update thread slider default
  const threadSlider = document.getElementById('param-threads');
  const threadVal = document.getElementById('param-threads-val');
  if (threadSlider && state.wasmInfo.concurrency) {
    const recommendedThreads = Math.min(Math.max(1, state.wasmInfo.concurrency - 1), 8);
    threadSlider.value = recommendedThreads;
    threadVal.textContent = recommendedThreads;
  }

  setupEventListeners();
  renderChallengesModal();
}

function setupEventListeners() {
  // Tabs switching
  const tabBtnModel = document.getElementById('tab-btn-model');
  const tabBtnParams = document.getElementById('tab-btn-params');
  const tabContentModel = document.getElementById('tab-content-model');
  const tabContentParams = document.getElementById('tab-content-params');

  tabBtnModel.addEventListener('click', () => {
    tabBtnModel.className = 'tab-btn active';
    tabBtnParams.className = 'tab-btn';
    tabContentModel.classList.remove('hidden');
    tabContentParams.classList.add('hidden');
  });

  tabBtnParams.addEventListener('click', () => {
    tabBtnParams.className = 'tab-btn active';
    tabBtnModel.className = 'tab-btn';
    tabContentParams.classList.remove('hidden');
    tabContentModel.classList.add('hidden');
  });

  // Slider value displays
  setupSlider('param-gpu-layers', 'param-gpu-val', (v) => v === '99' ? '99 (全層)' : v);
  setupSlider('param-threads', 'param-threads-val');
  setupSlider('param-temp', 'param-temp-val');
  setupSlider('param-topp', 'param-topp-val');
  setupSlider('param-maxtokens', 'param-maxtokens-val');

  // Drag and Drop for local GGUF
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('local-file-input');
  const loadLocalBtn = document.getElementById('load-local-btn');
  const selectedFilesList = document.getElementById('selected-files-list');

  dropZone.addEventListener('click', () => fileInput.click());

  ['dragenter', 'dragover'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.gguf'));
    if (files.length > 0) {
      handleFilesSelected(files);
    } else {
      alert('.gguf 拡張子のファイルを選択してください。');
    }
  });

  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      handleFilesSelected(files);
    }
  });

  function handleFilesSelected(files) {
    state.selectedLocalFiles = files;
    selectedFilesList.classList.remove('hidden');
    loadLocalBtn.classList.remove('hidden');
    selectedFilesList.innerHTML = `
      <div class="font-medium text-slate-300 mb-1">選択されたファイル (${files.length}件):</div>
      ${files.map(f => `<div class="truncate text-[11px] text-slate-400">• ${f.name} (${formatBytes(f.size)})</div>`).join('')}
    `;
  }

  loadLocalBtn.addEventListener('click', async () => {
    if (!state.selectedLocalFiles || state.selectedLocalFiles.length === 0) return;
    await loadModel(() => state.engine.loadLocalModel(state.selectedLocalFiles, getLoadOptions()));
  });

  // Preset model selection
  document.querySelectorAll('.preset-card').forEach(card => {
    card.addEventListener('click', async () => {
      const presetId = card.dataset.id;
      const preset = PRESET_MODELS.find(p => p.id === presetId);
      if (!preset) return;

      const confirmLoad = confirm(`プリセット「${preset.name}」(${preset.size}) をダウンロード（既にキャッシュにある場合はキャッシュから）して読み込みますか？\n※ダウンロードしたモデルはブラウザキャッシュに保存されます。`);
      if (!confirmLoad) return;

      await loadModel(() => state.engine.loadHFModel(preset.repo, preset.file, getLoadOptions()));
    });
  });

  // Custom HF model load
  document.getElementById('load-hf-btn').addEventListener('click', async () => {
    const repo = document.getElementById('hf-repo-input').value.trim();
    const file = document.getElementById('hf-file-input').value.trim();
    if (!repo || !file) {
      alert('リポジトリ名とファイル名の両方を入力してください。');
      return;
    }
    await loadModel(() => state.engine.loadHFModel(repo, file, getLoadOptions()));
  });

  // Model Unload
  document.getElementById('unload-model-btn').addEventListener('click', async () => {
    if (confirm('モデルをアンロードしてメモリを解放しますか？')) {
      await state.engine.unload();
      state.ui.setEngineState({ loaded: false });
      document.getElementById('active-model-card').classList.add('hidden');
    }
  });

  // Chat input and sending
  const promptInput = document.getElementById('prompt-input');
  const sendBtn = document.getElementById('send-btn');
  const stopBtn = document.getElementById('stop-btn');
  const clearChatBtn = document.getElementById('clear-chat-btn');
  const undoLastBtn = document.getElementById('undo-last-btn');

  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing /*&& e.KeyCode !== 229*/) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  // Auto resize textarea
  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';
  });

  sendBtn.addEventListener('click', () => handleSendMessage());

  stopBtn.addEventListener('click', () => {
    state.engine.abort();
    const currentAiId = state.currentAiMsgId;
    state.ui.finishAssistantMessage({ id: currentAiId });
    if (currentAiId) {
      const currentText = state.ui.messagesMap.get(currentAiId)?.content || '';
      state.chatHistory.push({ id: currentAiId, role: 'assistant', content: currentText });
    }
  });

  clearChatBtn.addEventListener('click', () => {
    if (state.chatHistory.length > 0 && !confirm('すべてのチャット履歴を消去しますか？')) {
      return;
    }
    state.chatHistory = [];
    state.ui.clearChat();
  });

  if (undoLastBtn) {
    undoLastBtn.addEventListener('click', () => {
      handleUndoLast();
    });
  }

  // Setup UIController action callbacks
  setupChatActionCallbacks();

  // Modals
  setupModal('diagnostics-modal', 'open-diagnostics-btn', ['close-diagnostics-btn', 'close-diagnostics-btn-2'], populateDiagnostics);
  setupModal('challenges-modal', 'open-challenges-btn', ['close-challenges-btn', 'close-challenges-btn-2']);
}

function setupChatActionCallbacks() {
  // 1. Delete message
  state.ui.onDeleteMessage = (id) => {
    const index = state.chatHistory.findIndex(m => m.id === id);
    if (index === -1) return;

    const targetMsg = state.chatHistory[index];
    if (targetMsg.role === 'user') {
      // If user message is deleted, delete the user message and its corresponding assistant response (if any)
      const nextMsg = state.chatHistory[index + 1];
      if (nextMsg && nextMsg.role === 'assistant') {
        state.ui.removeMessage(nextMsg.id);
        state.chatHistory.splice(index + 1, 1);
      }
      state.ui.removeMessage(targetMsg.id);
      state.chatHistory.splice(index, 1);
    } else {
      // Just delete the assistant message
      state.ui.removeMessage(targetMsg.id);
      state.chatHistory.splice(index, 1);
    }
  };

  // 2. Edit message (Undo user prompt and populate input)
  state.ui.onEditMessage = (id, text) => {
    const index = state.chatHistory.findIndex(m => m.id === id);
    if (index === -1) {
      state.ui.setInputValue(text);
      return;
    }

    // Remove all messages from this message onward
    const toRemove = state.chatHistory.slice(index);
    toRemove.forEach(m => state.ui.removeMessage(m.id));
    state.chatHistory.splice(index);

    // Restore text to input
    state.ui.setInputValue(text);
  };

  // 3. Regenerate assistant response
  state.ui.onRegenerateMessage = (id) => {
    if (state.engine.isGenerating) return;

    const index = state.chatHistory.findIndex(m => m.id === id);
    if (index === -1) return;

    // Find the preceding user message
    let userMsg = null;
    for (let i = index - 1; i >= 0; i--) {
      if (state.chatHistory[i].role === 'user') {
        userMsg = state.chatHistory[i];
        break;
      }
    }

    if (!userMsg) return;

    // Remove the current assistant message
    state.ui.removeMessage(id);
    state.chatHistory.splice(index, 1);

    // Re-generate response
    executeInferenceOnly(userMsg.content);
  };
}

function handleUndoLast() {
  if (state.chatHistory.length === 0 || state.engine.isGenerating) return;

  // Find last assistant and user message
  const lastIndex = state.chatHistory.length - 1;
  const lastMsg = state.chatHistory[lastIndex];

  if (lastMsg.role === 'assistant') {
    state.ui.removeMessage(lastMsg.id);
    state.chatHistory.pop();

    if (state.chatHistory.length > 0) {
      const prevMsg = state.chatHistory[state.chatHistory.length - 1];
      if (prevMsg.role === 'user') {
        state.ui.removeMessage(prevMsg.id);
        state.chatHistory.pop();
        state.ui.setInputValue(prevMsg.content);
      }
    }
  } else if (lastMsg.role === 'user') {
    state.ui.removeMessage(lastMsg.id);
    state.chatHistory.pop();
    state.ui.setInputValue(lastMsg.content);
  }
}

function setupSlider(sliderId, labelId, transform = (v) => v) {
  const slider = document.getElementById(sliderId);
  const label = document.getElementById(labelId);
  if (slider && label) {
    slider.addEventListener('input', (e) => {
      label.textContent = transform(e.target.value);
    });
  }
}

function getLoadOptions() {
  const nGpuLayers = parseInt(document.getElementById('param-gpu-layers').value, 10);
  const nThreads = parseInt(document.getElementById('param-threads').value, 10);
  const nCtx = parseInt(document.getElementById('param-nctx').value, 10);

  const progressContainer = document.getElementById('loading-progress-container');
  const progressBar = document.getElementById('loading-progress-bar');
  const progressPercent = document.getElementById('loading-percent');
  const progressText = document.getElementById('loading-status-text');

  progressContainer.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressPercent.textContent = '0%';
  progressText.textContent = 'モデルを準備中...';

  return {
    nGpuLayers,
    nThreads,
    nCtx,
    onProgress: ({ loaded, total, percent }) => {
      progressBar.style.width = `${percent}%`;
      progressPercent.textContent = `${percent}% (${formatBytes(loaded)} / ${formatBytes(total)})`;
      progressText.textContent = 'ダウンロード & キャッシュ中...';
    },
  };
}

async function loadModel(loaderFn) {
  const progressContainer = document.getElementById('loading-progress-container');
  const progressText = document.getElementById('loading-status-text');
  const activeModelCard = document.getElementById('active-model-card');
  const activeModelName = document.getElementById('active-model-name');
  const activeModelInfo = document.getElementById('active-model-info');

  try {
    const res = await loaderFn();
    progressText.textContent = 'コンテキストを初期化中...';

    state.ui.setEngineState({
      loaded: true,
      modelName: res.name,
      multithread: res.multithread,
      threads: res.threads,
    });

    // Show active model card
    activeModelCard.classList.remove('hidden');
    activeModelName.textContent = res.name;
    activeModelInfo.innerHTML = `
      <div>スレッド数: <span class="text-slate-200">${res.threads}</span></div>
      <div>マルチスレッド: <span class="text-slate-200">${res.multithread ? '有効' : '単一'}</span></div>
      <div>ボキャブラリ: <span class="text-slate-200">${res.metadata?.hparams?.nVocab || 'N/A'}</span></div>
      <div>埋め込み次元: <span class="text-slate-200">${res.metadata?.hparams?.nEmbd || 'N/A'}</span></div>
    `;

    setTimeout(() => {
      progressContainer.classList.add('hidden');
    }, 1000);
  } catch (err) {
    console.error('Failed to load model:', err);
    alert(`モデルの読み込みに失敗しました:\n${err.message || err}`);
    progressContainer.classList.add('hidden');
    state.ui.setEngineState({ loaded: false });
  }
}

function createMsgId() {
  return 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

async function handleSendMessage(customPrompt = null) {
  const promptInput = document.getElementById('prompt-input');
  const text = (customPrompt !== null ? customPrompt : promptInput.value).trim();
  if (!text || !state.engine.isLoaded || state.engine.isGenerating) return;

  if (customPrompt === null) {
    promptInput.value = '';
    promptInput.style.height = 'auto';
    const clearInputBtn = document.getElementById('clear-input-btn');
    if (clearInputBtn) clearInputBtn.classList.add('hidden');
  }

  const userMsgId = createMsgId();
  state.ui.addUserMessage({ id: userMsgId, text });
  state.chatHistory.push({ id: userMsgId, role: 'user', content: text });

  await runInference();
}

async function executeInferenceOnly() {
  await runInference();
}

async function runInference() {
  const systemPrompt = document.getElementById('param-system-prompt').value.trim();
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  // Format history for Wllama engine
  state.chatHistory.forEach(msg => messages.push({ role: msg.role, content: msg.content }));

  // Sampling parameters
  const temperature = parseFloat(document.getElementById('param-temp').value);
  const top_p = parseFloat(document.getElementById('param-topp').value);
  const max_tokens = parseInt(document.getElementById('param-maxtokens').value, 10);

  const aiMsgId = createMsgId();
  state.currentAiMsgId = aiMsgId;
  state.ui.startAssistantMessage({ id: aiMsgId });

  try {
    const result = await state.engine.chatCompletion({
      messages,
      temperature,
      top_p,
      max_tokens,
      onToken: ({ delta, fullText, tokenCount, tokensPerSec, ttftMs, elapsedMs }) => {
        state.ui.updateAssistantMessage(fullText);
        state.ui.updateStats({
          tps: tokensPerSec,
          ttft: ttftMs,
          tokens: tokenCount,
          elapsed: elapsedMs,
        });
      },
    });

    state.ui.finishAssistantMessage({ id: aiMsgId, text: result.content });
    state.chatHistory.push({ id: aiMsgId, role: 'assistant', content: result.content });
    state.currentAiMsgId = null;
  } catch (err) {
    console.error('Inference error:', err);
    state.ui.updateAssistantMessage(`❌ **推論エラー**: ${err.message || '不明なエラーが発生しました。'}`);
    state.ui.finishAssistantMessage({ id: aiMsgId, text: `❌ 推論エラー: ${err.message || '不明なエラーが発生しました。'}` });
    state.currentAiMsgId = null;
  }
}

function setupModal(modalId, openBtnId, closeBtnIds, onOpen = null) {
  const modal = document.getElementById(modalId);
  const openBtn = document.getElementById(openBtnId);

  if (openBtn && modal) {
    openBtn.addEventListener('click', () => {
      modal.classList.remove('hidden');
      if (onOpen) onOpen();
    });
  }

  closeBtnIds.forEach(id => {
    const btn = document.getElementById(id);
    if (btn && modal) {
      btn.addEventListener('click', () => modal.classList.add('hidden'));
    }
  });

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  }
}

function populateDiagnostics() {
  const gpuStatus = document.getElementById('diag-gpu-status');
  const gpuAdapter = document.getElementById('diag-gpu-adapter');
  const gpuLimits = document.getElementById('diag-gpu-limits');

  const wasmThreads = document.getElementById('diag-wasm-threads');
  const wasmSimd = document.getElementById('diag-wasm-simd');
  const wasmIsolation = document.getElementById('diag-wasm-isolation');
  const wasmCores = document.getElementById('diag-wasm-cores');

  if (state.webGPUInfo?.supported) {
    gpuStatus.innerHTML = `ステータス: <span style="color: var(--accent-green-text); font-weight: 600;">利用可能 (Active)</span> | 疎通テスト: <span style="color: var(--accent-green-text);">${state.webGPUInfo.computeTestPassed ? '合格' : '不合格'}</span>`;
    gpuAdapter.innerHTML = `GPU: ${state.webGPUInfo.adapterInfo?.vendor} / ${state.webGPUInfo.adapterInfo?.architecture || 'Generic'}`;
    gpuLimits.innerHTML = `
      <div>• maxBufferSize: ${formatBytes(state.webGPUInfo.limits?.maxBufferSize)}</div>
      <div>• maxStorageBufferBindingSize: ${formatBytes(state.webGPUInfo.limits?.maxStorageBufferBindingSize)}</div>
      <div>• maxComputeWorkgroupStorageSize: ${formatBytes(state.webGPUInfo.limits?.maxComputeWorkgroupStorageSize)}</div>
    `;
  } else {
    gpuStatus.innerHTML = `ステータス: <span style="color: #f85149;">利用不可 / CPUフォールバック</span>`;
    gpuAdapter.textContent = state.webGPUInfo?.error || 'navigator.gpu が検出されませんでした。';
    gpuLimits.innerHTML = '<div>※WebAssembly (CPU SIMD) で推論を実行します。</div>';
  }

  wasmThreads.innerHTML = `マルチスレッド (SharedArrayBuffer): <span style="color: ${state.wasmInfo.threadsSupported ? 'var(--accent-green-text)' : 'var(--accent-amber)'}; font-weight: 600;">${state.wasmInfo.threadsSupported ? '有効' : '無効 (シングルスレッド)'}</span>`;
  wasmSimd.innerHTML = `SIMD 演算アクセラレーション: <span style="color: ${state.wasmInfo.simd ? 'var(--accent-green-text)' : '#f85149'}; font-weight: 600;">${state.wasmInfo.simd ? '対応' : '未対応'}</span>`;
  wasmIsolation.innerHTML = `Cross-Origin Isolation (COOP/COEP): <span style="color: ${state.wasmInfo.crossOriginIsolated ? 'var(--accent-green-text)' : 'var(--accent-amber)'}; font-weight: 600;">${state.wasmInfo.crossOriginIsolated ? 'true (隔離設定済み)' : 'false (未設定)'}</span>`;
  wasmCores.innerHTML = `論理CPUコア数: ${state.wasmInfo.concurrency} | 推定端末メモリ: ${state.wasmInfo.deviceMemory}`;
}

function renderChallengesModal() {
  const container = document.getElementById('challenges-container');
  if (!container) return;

  container.innerHTML = TECHNICAL_CHALLENGES.map(item => `
    <div style="background-color: var(--bg-card); padding: 14px; border-radius: 8px; border: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <h4 style="font-weight: 700; color: #fff; font-size: 13px;">${item.title}</h4>
        <span style="font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; background-color: rgba(99, 102, 241, 0.2); color: var(--primary-light); border: 1px solid rgba(99, 102, 241, 0.3);">
          ${item.badge}
        </span>
      </div>
      <p style="color: var(--text-primary); font-size: 12px; font-weight: 500;">${item.summary}</p>
      <div class="prose" style="color: var(--text-secondary); font-size: 11px; border-top: 1px solid var(--border-subtle); padding-top: 6px;">
        ${item.details.trim().replace(/\n/g, '<br/>')}
      </div>
    </div>
  `).join('');
}

// Prevent refresh
window.addEventListener('beforeunload', (event) => {
  event.preventDefault();
});

// Start application
window.addEventListener('DOMContentLoaded', init);
