/// <reference lib="webworker" />
/** Language-neutral serialized worker transport for the generic host ABI. */
export function serveWasmHost(
  url: string,
  scope = self as unknown as DedicatedWorkerGlobalScope,
) {
  type Exports = {
    memory: WebAssembly.Memory;
    input_buffer(length: number): number;
    execute(): number;
    output_buffer(): number;
  };
  const ready = (async () => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Build the language WASM first (${url})`);
    const result = await WebAssembly.instantiate(
      await response.arrayBuffer(),
      {},
    );
    const wasm = result.instance.exports as unknown as Exports;
    if (
      !(wasm.memory instanceof WebAssembly.Memory) ||
      [wasm.input_buffer, wasm.execute, wasm.output_buffer].some(
        (f) => typeof f !== "function",
      )
    )
      throw new Error("Invalid generic host WASM exports");
    return wasm;
  })();
  let queue = Promise.resolve();
  scope.onmessage = ({ data }) => {
    queue = queue.then(async () => {
      try {
        const wasm = await ready,
          bytes = new TextEncoder().encode(
            JSON.stringify({ method: data.method, params: data.params }),
          );
        const pointer = wasm.input_buffer(bytes.length);
        if (!pointer) throw new Error("Request exceeds WASM input limit");
        new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
        const length = wasm.execute(),
          result = JSON.parse(
            new TextDecoder().decode(
              new Uint8Array(wasm.memory.buffer, wasm.output_buffer(), length),
            ),
          );
        if (result.error) throw new Error(result.error);
        scope.postMessage({ id: data.id, result });
      } catch (error) {
        scope.postMessage({ id: data.id, error: String(error) });
      }
    });
  };
}
