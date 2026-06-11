function createMemoryStorage(): Storage {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key: string) {
      return values.get(key) ?? null
    },
    key(index: number) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
}

function ensureStorage(name: "localStorage" | "sessionStorage") {
  try {
    if (window[name]) return
  } catch {
    // Access can throw for opaque origins; replace it below.
  }

  Object.defineProperty(window, name, {
    configurable: true,
    value: createMemoryStorage(),
  })
}

if (typeof window !== "undefined") {
  ensureStorage("localStorage")
  ensureStorage("sessionStorage")

  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }
}
