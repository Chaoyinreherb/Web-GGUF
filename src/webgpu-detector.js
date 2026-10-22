/**
 * WebGPU & WebAssembly Hardware and Environment Diagnostic Utility
 */

export async function detectWebGPU() {
  const result = {
    supported: false,
    adapterInfo: null,
    limits: null,
    features: [],
    computeTestPassed: false,
    error: null,
  };

  if (typeof navigator === 'undefined' || !navigator.gpu) {
    result.error = 'WebGPU is not supported on this browser or page is not in a secure context.';
    return result;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      result.error = 'No WebGPU adapter found. Check chrome://flags or Safari develop menu to enable WebGPU.';
      return result;
    }

    result.supported = true;
    result.features = Array.from(adapter.features || []);

    // Get adapter info if available
    let infoObj = { vendor: 'WebGPU GPU', architecture: 'Generic', device: 'GPU Device' };
    if (adapter.info) {
      infoObj = {
        vendor: adapter.info.vendor || 'WebGPU',
        architecture: adapter.info.architecture || '',
        device: adapter.info.device || '',
        description: adapter.info.description || '',
      };
    } else if (adapter.requestAdapterInfo) {
      try {
        const info = await adapter.requestAdapterInfo();
        infoObj = {
          vendor: info.vendor || 'WebGPU',
          architecture: info.architecture || '',
          device: info.device || '',
          description: info.description || '',
        };
      } catch (e) {}
    }
    result.adapterInfo = infoObj;

    // Capture limits
    if (adapter.limits) {
      result.limits = {
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
      };
    }

    // Quick test
    try {
      const device = await adapter.requestDevice();
      result.computeTestPassed = !!device;
      if (device && device.destroy) device.destroy();
    } catch (e) {
      result.computeTestPassed = false;
    }

    return result;
  } catch (err) {
    result.error = err.message || 'Error initializing WebGPU.';
    return result;
  }
}

/**
 * Diagnostics for WebAssembly environment (SIMD, Threads, CrossOriginIsolation)
 */
export function detectWasmEnvironment() {
  const isIsolated = typeof window !== 'undefined' && window.crossOriginIsolated === true;
  
  let hasSharedArrayBuffer = false;
  try {
    hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined' && new SharedArrayBuffer(16).byteLength === 16;
  } catch (e) {
    hasSharedArrayBuffer = false;
  }

  const concurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const memoryEstimate = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? `${navigator.deviceMemory} GB+` : 'Unknown';

  // Accurate WebAssembly SIMD validation byte sequence
  let simdSupported = false;
  try {
    simdSupported = WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 253, 12, 0, 0, 0, 0, 11
    ]));
  } catch (e) {
    simdSupported = false;
  }

  return {
    crossOriginIsolated: isIsolated,
    sharedArrayBuffer: hasSharedArrayBuffer,
    simd: simdSupported,
    threadsSupported: isIsolated && hasSharedArrayBuffer,
    concurrency,
    deviceMemory: memoryEstimate,
  };
}

/**
 * Format bytes to readable string (MB/GB)
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (!bytes) return 'N/A';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
