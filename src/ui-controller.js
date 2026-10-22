import { marked } from 'marked';
import { PRESET_MODELS } from './presets.js';

// SVG Icons for Chat Actions
const ICONS = {
  copy: `<svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`,
  check: `<svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>`,
  edit: `<svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>`,
  delete: `<svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>`,
  regenerate: `<svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>`,
  aiAvatar: `<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>`,
  userAvatar: `<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>`
};

// Configure marked with custom code block renderer for copyable code
marked.setOptions({
  breaks: true,
  gfm: true,
});

const customRenderer = {
  code({ text, lang }) {
    const rawLang = lang || 'code';
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
    
    return `
      <div class="code-block-wrapper">
        <div class="code-block-header">
          <span class="code-block-lang">${rawLang}</span>
          <button class="code-copy-btn" data-code="${encodeURIComponent(text)}" type="button" title="コードをコピー">
            ${ICONS.copy}
            <span class="copy-label">コピー</span>
          </button>
        </div>
        <pre><code class="language-${rawLang}">${escaped}</code></pre>
      </div>
    `;
  }
};
marked.use({ renderer: customRenderer });

export class UIController {
  constructor() {
    this.messagesContainer = document.getElementById('chat-messages');
    this.emptyState = document.getElementById('chat-empty-state');
    this.promptInput = document.getElementById('prompt-input');
    this.clearInputBtn = document.getElementById('clear-input-btn');
    this.sendBtn = document.getElementById('send-btn');
    this.stopBtn = document.getElementById('stop-btn');
    this.modelStatusBadge = document.getElementById('model-status-badge');
    this.gpuBadge = document.getElementById('gpu-status-badge');
    this.wasmBadge = document.getElementById('wasm-status-badge');
    
    // Stats elements
    this.statsContainer = document.getElementById('perf-stats');
    this.statTokensPerSec = document.getElementById('stat-tps');
    this.statTtft = document.getElementById('stat-ttft');
    this.statTotalTokens = document.getElementById('stat-tokens');
    this.statElapsed = document.getElementById('stat-elapsed');

    // Preset container
    this.presetList = document.getElementById('preset-models-list');

    // Current streaming message elements
    this.currentAssistantMessageEl = null;
    this.currentContentEl = null;
    this.currentRawText = '';

    // Message store by id: { id, role, content, element }
    this.messagesMap = new Map();

    // Callbacks
    this.onDeleteMessage = null;
    this.onEditMessage = null;
    this.onRegenerateMessage = null;

    this.renderPresets();
    this.setupChatEventDelegation();
    this.setupInputClear();
  }

  setupInputClear() {
    if (!this.promptInput || !this.clearInputBtn) return;

    const toggleClearBtn = () => {
      if (this.promptInput.value.length > 0) {
        this.clearInputBtn.classList.remove('hidden');
      } else {
        this.clearInputBtn.classList.add('hidden');
      }
    };

    this.promptInput.addEventListener('input', toggleClearBtn);

    this.clearInputBtn.addEventListener('click', () => {
      this.promptInput.value = '';
      this.promptInput.style.height = 'auto';
      toggleClearBtn();
      this.promptInput.focus();
    });

    this.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.promptInput.value) {
        e.preventDefault();
        this.promptInput.value = '';
        this.promptInput.style.height = 'auto';
        toggleClearBtn();
      }
    });
  }

  setupChatEventDelegation() {
    if (!this.messagesContainer) return;

    this.messagesContainer.addEventListener('click', async (e) => {
      // 1. Code block copy button
      const codeCopyBtn = e.target.closest('.code-copy-btn');
      if (codeCopyBtn) {
        e.preventDefault();
        const encodedCode = codeCopyBtn.dataset.code;
        if (encodedCode) {
          const codeText = decodeURIComponent(encodedCode);
          await this.copyToClipboard(codeText, codeCopyBtn, 'コピー', '完了');
        }
        return;
      }

      // 2. Message action button: Copy
      const copyBtn = e.target.closest('.msg-action-copy');
      if (copyBtn) {
        e.preventDefault();
        const row = copyBtn.closest('.chat-row');
        const id = row?.dataset?.id;
        const msg = this.messagesMap.get(id);
        const textToCopy = msg ? msg.content : (row?.dataset?.rawContent || '');
        if (textToCopy) {
          await this.copyToClipboard(textToCopy, copyBtn, 'コピー', 'コピー完了');
        }
        return;
      }

      // 3. Message action button: Undo / Edit (user message)
      const editBtn = e.target.closest('.msg-action-edit');
      if (editBtn) {
        e.preventDefault();
        const row = editBtn.closest('.chat-row');
        const id = row?.dataset?.id;
        const msg = this.messagesMap.get(id);
        const text = msg ? msg.content : (row?.dataset?.rawContent || '');
        if (this.onEditMessage && id) {
          this.onEditMessage(id, text);
        }
        return;
      }

      // 4. Message action button: Delete / Undo
      const deleteBtn = e.target.closest('.msg-action-delete');
      if (deleteBtn) {
        e.preventDefault();
        const row = deleteBtn.closest('.chat-row');
        const id = row?.dataset?.id;
        if (this.onDeleteMessage && id) {
          this.onDeleteMessage(id);
        }
        return;
      }

      // 5. Message action button: Regenerate (assistant message)
      const regenBtn = e.target.closest('.msg-action-regenerate');
      if (regenBtn) {
        e.preventDefault();
        const row = regenBtn.closest('.chat-row');
        const id = row?.dataset?.id;
        if (this.onRegenerateMessage && id) {
          this.onRegenerateMessage(id);
        }
        return;
      }
    });
  }

  async copyToClipboard(text, btnElement, normalLabel = 'コピー', successLabel = 'コピー完了') {
    try {
      await navigator.clipboard.writeText(text);
      const labelSpan = btnElement.querySelector('.action-label, .copy-label');
      const originalSvg = btnElement.querySelector('svg')?.outerHTML || ICONS.copy;
      
      btnElement.classList.add('copied');
      if (labelSpan) labelSpan.textContent = successLabel;
      
      const svgContainer = btnElement.querySelector('svg');
      if (svgContainer) {
        svgContainer.outerHTML = ICONS.check;
      }

      setTimeout(() => {
        btnElement.classList.remove('copied');
        if (labelSpan) labelSpan.textContent = normalLabel;
        const currentSvg = btnElement.querySelector('svg');
        if (currentSvg) {
          currentSvg.outerHTML = originalSvg;
        }
      }, 1800);
    } catch (err) {
      console.error('Clipboard copy error:', err);
    }
  }

  renderPresets() {
    if (!this.presetList) return;
    this.presetList.innerHTML = PRESET_MODELS.map(model => `
      <div class="preset-card" data-id="${model.id}">
        <div class="preset-card-header">
          <span class="preset-card-title">${model.name}</span>
          <span class="preset-card-size">${model.size}</span>
        </div>
        <div class="preset-card-desc">${model.desc}</div>
        <div class="preset-card-footer">
          <span class="preset-card-quant">${model.quant}</span>
          <span class="preset-card-btn">選択 &amp; 読込 &rarr;</span>
        </div>
      </div>
    `).join('');
  }

  setEngineState({ loaded, modelName, multithread, threads }) {
    if (loaded) {
      this.modelStatusBadge.innerHTML = `
        <span class="status-dot dot-green"></span>
        <span style="color: var(--accent-green-text); font-weight: 600;" title="${modelName}">${modelName}</span>
      `;
      this.promptInput.disabled = false;
      this.sendBtn.disabled = false;
      this.promptInput.placeholder = 'メッセージを入力... (Shift+Enterで改行)';
      this.hideEmptyStatePromptGuide();
    } else {
      this.modelStatusBadge.innerHTML = `
        <span class="status-dot dot-amber"></span>
        <span>未ロード</span>
      `;
      this.promptInput.disabled = true;
      this.sendBtn.disabled = true;
      this.promptInput.placeholder = '左側のパネルからGGUFモデルを読み込んでください';
    }
  }

  setWebGPUState({ supported, adapterInfo, error }) {
    if (supported) {
      const vendor = adapterInfo?.vendor || 'WebGPU';
      this.gpuBadge.innerHTML = `
        <span class="status-dot dot-indigo"></span>
        <span style="color: var(--primary-light);" title="${adapterInfo?.device || vendor}">WebGPU: 有効 (${vendor})</span>
      `;
    } else {
      this.gpuBadge.innerHTML = `
        <span class="status-dot dot-gray"></span>
        <span title="${error || '未サポート'}">WebGPU: CPU/Wasm</span>
      `;
    }
  }

  setWasmState({ threadsSupported, concurrency, simd }) {
    if (threadsSupported && simd) {
      this.wasmBadge.innerHTML = `
        <span class="status-dot dot-green"></span>
        <span style="color: var(--accent-green-text);">Wasm: SIMD+Multi (${concurrency}コア)</span>
      `;
    } else if (simd) {
      this.wasmBadge.innerHTML = `
        <span class="status-dot dot-amber"></span>
        <span style="color: var(--accent-amber);">Wasm: SIMD (単一)</span>
      `;
    } else {
      this.wasmBadge.innerHTML = `
        <span class="status-dot dot-gray"></span>
        <span>Wasm: 標準</span>
      `;
    }
  }

  showEmptyStatePromptGuide() {
    if (this.emptyState) this.emptyState.classList.remove('hidden');
  }

  hideEmptyStatePromptGuide() {
    if (this.emptyState) this.emptyState.classList.add('hidden');
  }

  addUserMessage({ id, text }) {
    this.hideEmptyStatePromptGuide();

    const row = document.createElement('div');
    row.className = 'chat-row chat-row-user';
    row.dataset.id = id;
    row.dataset.rawContent = text;

    row.innerHTML = `
      <div class="bubble-wrapper">
        <div class="bubble bubble-user">
          <div class="bubble-text">${this.escapeHtml(text)}</div>
        </div>
        <div class="message-actions user-actions">
          <button class="msg-action-btn msg-action-copy" type="button" title="メッセージをコピー">
            ${ICONS.copy}
            <span class="action-label">コピー</span>
          </button>
          <button class="msg-action-btn msg-action-edit" type="button" title="取り消して再編集">
            ${ICONS.edit}
            <span class="action-label">取り消して編集</span>
          </button>
          <button class="msg-action-btn msg-action-delete" type="button" title="このメッセージを取り消す">
            ${ICONS.delete}
            <span class="action-label">削除</span>
          </button>
        </div>
      </div>
      <div class="avatar avatar-user" title="あなた">
        ${ICONS.userAvatar}
      </div>
    `;

    this.messagesContainer.appendChild(row);
    this.messagesMap.set(id, { id, role: 'user', content: text, element: row });
    this.scrollToBottom();
  }

  startAssistantMessage({ id }) {
    this.hideEmptyStatePromptGuide();

    const row = document.createElement('div');
    row.className = 'chat-row chat-row-ai';
    row.dataset.id = id;
    row.dataset.rawContent = '';

    row.innerHTML = `
      <div class="avatar avatar-ai" title="AI アシスタント">
        ${ICONS.aiAvatar}
      </div>
      <div class="bubble-wrapper">
        <div class="bubble bubble-ai">
          <div class="message-content prose">
            <span class="typing-cursor"></span>
          </div>
        </div>
        <div class="message-actions ai-actions hidden">
          <button class="msg-action-btn msg-action-copy" type="button" title="回答をコピー">
            ${ICONS.copy}
            <span class="action-label">コピー</span>
          </button>
          <button class="msg-action-btn msg-action-regenerate" type="button" title="回答を再生成">
            ${ICONS.regenerate}
            <span class="action-label">再生成</span>
          </button>
          <button class="msg-action-btn msg-action-delete" type="button" title="この回答を取り消す">
            ${ICONS.delete}
            <span class="action-label">取り消し</span>
          </button>
        </div>
      </div>
    `;

    this.messagesContainer.appendChild(row);
    this.currentAssistantMessageEl = row;
    this.currentContentEl = row.querySelector('.message-content');
    this.currentRawText = '';

    this.messagesMap.set(id, { id, role: 'assistant', content: '', element: row });
    this.scrollToBottom();

    // Toggle buttons
    this.sendBtn.classList.add('hidden');
    this.stopBtn.classList.remove('hidden');
    this.statsContainer.classList.remove('hidden');
    this.updateStats({ tps: 0, ttft: 0, tokens: 0, elapsed: 0 });
  }

  updateAssistantMessage(text) {
    if (!this.currentContentEl) return;
    this.currentRawText = text;
    this.currentContentEl.innerHTML = marked.parse(text);
    this.scrollToBottom();
  }

  finishAssistantMessage({ id, text }) {
    const finalContent = text !== undefined ? text : this.currentRawText;
    
    if (this.currentAssistantMessageEl) {
      this.currentAssistantMessageEl.dataset.rawContent = finalContent;
      const actionsEl = this.currentAssistantMessageEl.querySelector('.message-actions');
      if (actionsEl) {
        actionsEl.classList.remove('hidden');
      }
    }

    if (id && this.messagesMap.has(id)) {
      const msgObj = this.messagesMap.get(id);
      msgObj.content = finalContent;
    }

    this.currentAssistantMessageEl = null;
    this.currentContentEl = null;
    this.currentRawText = '';
    this.sendBtn.classList.remove('hidden');
    this.stopBtn.classList.add('hidden');
  }

  removeMessage(id) {
    const msgObj = this.messagesMap.get(id);
    if (msgObj && msgObj.element) {
      msgObj.element.remove();
      this.messagesMap.delete(id);
    }
    if (this.messagesMap.size === 0) {
      this.showEmptyStatePromptGuide();
      this.statsContainer.classList.add('hidden');
    }
  }

  setInputValue(text) {
    if (!this.promptInput) return;
    this.promptInput.value = text;
    this.promptInput.style.height = 'auto';
    this.promptInput.style.height = Math.min(this.promptInput.scrollHeight, 140) + 'px';
    if (this.clearInputBtn) {
      if (text) {
        this.clearInputBtn.classList.remove('hidden');
      } else {
        this.clearInputBtn.classList.add('hidden');
      }
    }
    this.promptInput.focus();
  }

  updateStats({ tps, ttft, tokens, elapsed }) {
    if (this.statTokensPerSec) this.statTokensPerSec.textContent = tps ? `${tps} t/s` : '--';
    if (this.statTtft) this.statTtft.textContent = ttft ? `${ttft} ms` : '--';
    if (this.statTotalTokens) this.statTotalTokens.textContent = tokens ? `${tokens}` : '--';
    if (this.statElapsed) this.statElapsed.textContent = elapsed ? `${(elapsed / 1000).toFixed(1)} s` : '--';
  }

  clearChat() {
    this.messagesContainer.innerHTML = '';
    this.messagesMap.clear();
    if (this.emptyState) {
      this.messagesContainer.appendChild(this.emptyState);
      this.showEmptyStatePromptGuide();
    }
    this.statsContainer.classList.add('hidden');
  }

  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
