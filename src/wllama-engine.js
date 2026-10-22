import { Wllama } from '@wllama/wllama';

/**
 * Wrapper class managing the wllama Wasm/WebGPU runtime
 */
export class WllamaEngine {
  constructor(options = {}) {
    this.wasmPath = options.wasmPath || '/wllama.wasm';
    this.wllama = null;
    this.isLoaded = false;
    this.currentModelName = '';
    this.modelMetadata = null;
    this.abortController = null;
    this.isGenerating = false;
  }

  /**
   * Initializes the wllama instance
   */
  async init() {
    if (this.wllama) return;

    const configPaths = {
      default: this.wasmPath,
    };

    this.wllama = new Wllama(configPaths, {
      suppressNativeLog: false,
      logger: {
        debug: () => {},
        log: (...args) => console.log('[Wllama]', ...args),
        warn: (...args) => console.warn('[Wllama]', ...args),
        error: (...args) => console.error('[Wllama]', ...args),
      },
    });
  }

  /**
   * Checks if WebGPU is supported by the wllama binary
   */
  isWebGPUSupported() {
    if (!this.wllama) return false;
    try {
      return this.wllama.isSupportWebGPU();
    } catch (e) {
      return false;
    }
  }

  /**
   * Loads a local GGUF File or Blob
   * @param {File[]|Blob[]} files
   * @param {Object} options
   */
  async loadLocalModel(files, options = {}) {
    await this.init();
    if (this.isLoaded) {
      await this.unload();
    }

    const {
      nGpuLayers = 0,
      nThreads = Math.min(navigator.hardwareConcurrency || 4, 8),
      nCtx = 2048,
      onProgress = null,
    } = options;

    const fileList = Array.isArray(files) ? files : [files];
    this.currentModelName = fileList.map(f => f.name || 'local.gguf').join(', ');

    const loadParams = {
      n_ctx: nCtx,
      n_threads: nThreads,
      n_gpu_layers: nGpuLayers,
      warmup: true,
      cont_batching: true,
    };

    // Load model from blobs
    await this.wllama.loadModel(fileList, loadParams);
    this.isLoaded = true;

    try {
      this.modelMetadata = this.wllama.getModelMetadata();
    } catch (e) {
      console.warn('Failed to fetch model metadata:', e);
      this.modelMetadata = null;
    }

    return {
      name: this.currentModelName,
      metadata: this.modelMetadata,
      multithread: this.wllama.isMultithread(),
      threads: this.wllama.getNumThreads(),
    };
  }

  /**
   * Loads a model from Hugging Face repository
   */
  async loadHFModel(repo, file, options = {}) {
    await this.init();
    if (this.isLoaded) {
      await this.unload();
    }

    const {
      nGpuLayers = 0,
      nThreads = Math.min(navigator.hardwareConcurrency || 4, 8),
      nCtx = 2048,
      onProgress = null,
    } = options;

    this.currentModelName = `${repo}/${file}`;

    const loadParams = {
      n_ctx: nCtx,
      n_threads: nThreads,
      n_gpu_layers: nGpuLayers,
      warmup: true,
      cont_batching: true,
      progressCallback: ({ loaded, total }) => {
        if (onProgress && total > 0) {
          onProgress({ loaded, total, percent: Math.round((loaded / total) * 100) });
        }
      },
    };

    await this.wllama.loadModelFromHF({ repo, file }, loadParams);
    this.isLoaded = true;

    try {
      this.modelMetadata = this.wllama.getModelMetadata();
    } catch (e) {
      this.modelMetadata = null;
    }

    return {
      name: this.currentModelName,
      metadata: this.modelMetadata,
      multithread: this.wllama.isMultithread(),
      threads: this.wllama.getNumThreads(),
    };
  }

  /**
   * Loads a model from a direct URL
   */
  async loadModelFromUrl(url, options = {}) {
    await this.init();
    if (this.isLoaded) {
      await this.unload();
    }

    const {
      nGpuLayers = 0,
      nThreads = Math.min(navigator.hardwareConcurrency || 4, 8),
      nCtx = 2048,
      onProgress = null,
    } = options;

    this.currentModelName = url.split('/').pop() || 'remote.gguf';

    const loadParams = {
      n_ctx: nCtx,
      n_threads: nThreads,
      n_gpu_layers: nGpuLayers,
      warmup: true,
      cont_batching: true,
      progressCallback: ({ loaded, total }) => {
        if (onProgress && total > 0) {
          onProgress({ loaded, total, percent: Math.round((loaded / total) * 100) });
        }
      },
    };

    await this.wllama.loadModelFromUrl(url, loadParams);
    this.isLoaded = true;

    try {
      this.modelMetadata = this.wllama.getModelMetadata();
    } catch (e) {
      this.modelMetadata = null;
    }

    return {
      name: this.currentModelName,
      metadata: this.modelMetadata,
      multithread: this.wllama.isMultithread(),
      threads: this.wllama.getNumThreads(),
    };
  }

  /**
   * Run chat completion with streaming support
   */
  async chatCompletion({
    messages,
    temperature = 0.7,
    top_p = 0.9,
    top_k = 40,
    max_tokens = 512,
    repeat_penalty = 1.1,
    onToken = null,
  }) {
    if (!this.wllama || !this.isLoaded) {
      throw new Error('No model loaded.');
    }

    this.isGenerating = true;
    let fullResponse = '';
    let tokenCount = 0;
    const startTime = performance.now();
    let firstTokenTime = null;

    try {
      // Use streaming chat completion
      const stream = await this.wllama.createChatCompletion({
        messages,
        temperature,
        top_p,
        top_k,
        max_tokens,
        repeat_penalty,
        stream: true,
      });

      for await (const chunk of stream) {
        if (!this.isGenerating) {
          // Aborted by user
          break;
        }

        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          if (tokenCount === 0) {
            firstTokenTime = performance.now();
          }
          tokenCount++;
          fullResponse += delta;

          const now = performance.now();
          const elapsedSec = (now - startTime) / 1000;
          const tokensPerSec = tokenCount / (elapsedSec || 1);
          const ttftMs = firstTokenTime ? Math.round(firstTokenTime - startTime) : 0;

          if (onToken) {
            onToken({
              delta,
              fullText: fullResponse,
              tokenCount,
              tokensPerSec: Math.round(tokensPerSec * 10) / 10,
              ttftMs,
              elapsedMs: Math.round(now - startTime),
            });
          }
        }
      }

      const totalElapsed = (performance.now() - startTime) / 1000;
      return {
        content: fullResponse,
        tokenCount,
        tokensPerSec: Math.round((tokenCount / (totalElapsed || 1)) * 10) / 10,
        ttftMs: firstTokenTime ? Math.round(firstTokenTime - startTime) : 0,
        totalTimeMs: Math.round(totalElapsed * 1000),
      };
    } finally {
      this.isGenerating = false;
    }
  }

  /**
   * Abort ongoing generation
   */
  abort() {
    this.isGenerating = false;
  }

  /**
   * Unload model and free resources
   */
  async unload() {
    if (this.wllama && this.isLoaded) {
      try {
        await this.wllama.exit();
      } catch (e) {
        console.warn('Error during unload:', e);
      }
      this.isLoaded = false;
      this.currentModelName = '';
      this.modelMetadata = null;
      // Re-instantiate wllama after exit
      this.wllama = null;
      await this.init();
    }
  }
}
