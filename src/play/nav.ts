/** Minimal history-based navigation; App.svelte listens for popstate. */
export function nav(path: string) {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}
