interface BreevRuntime {
  getLocalApiUrl(): Promise<string>;
}

interface Window {
  readonly breevRuntime: BreevRuntime;
}
