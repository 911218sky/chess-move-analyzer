(function initExtensionApi(global: ExtensionHostGlobal) {
  const globalApi = global;
  const browserApi =
    typeof globalApi.browser !== "undefined" ? globalApi.browser : globalApi.chrome;

  if (!browserApi) {
    throw new Error("No browser extension API found.");
  }

  const isPromiseNative = typeof globalApi.browser !== "undefined";

  // Wrap callback-style browser APIs into promises while preserving the
  // native promise path used by Firefox.
  function wrapMethod<
    TContext extends object,
    TResult = unknown
  >(context: TContext | undefined, methodName: keyof TContext & string) {
    if (!context || typeof context[methodName] !== "function") {
      return (..._args: unknown[]) =>
        Promise.reject(
          new Error(`Extension API method unavailable: ${methodName}`)
        );
    }

    const method = context[methodName] as (...args: unknown[]) => unknown;

    if (isPromiseNative) {
      return (...args: unknown[]) => method.call(context, ...args) as Promise<TResult>;
    }

    return (...args: unknown[]) =>
      new Promise<TResult>((resolve, reject) => {
        try {
          method.call(context, ...args, (result: TResult) => {
            const error = globalApi.chrome?.runtime?.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }

            resolve(result);
          });
        } catch (error) {
          reject(error);
        }
      });
  }

  globalApi.extensionAPI = {
    raw: browserApi,
    runtime: {
      getURL: browserApi.runtime.getURL.bind(browserApi.runtime),
      onMessage: browserApi.runtime.onMessage,
      sendMessage: wrapMethod(browserApi.runtime, "sendMessage"),
    },
    storage: {
      local: {
        get: wrapMethod(browserApi.storage.local, "get"),
        set: wrapMethod(browserApi.storage.local, "set"),
      },
    },
    tabs: {
      query: wrapMethod(browserApi.tabs, "query"),
      sendMessage: wrapMethod(browserApi.tabs, "sendMessage"),
    },
  };
})(globalThis as ExtensionHostGlobal);
