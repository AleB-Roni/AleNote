// Sichere Brücke zwischen Oberfläche und Hauptprozess
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('alenoteNative', {
  getSettings: call('settings:get'),
  setSettings: call('settings:set'),
  getVault: call('vault:get'),
  chooseVault: call('vault:choose'),
  revealInExplorer: call('vault:reveal'),
  openFolder: call('vault:openFolder'),
  tree: call('tree'),
  readNote: call('note:read'),
  writeNote: call('note:write'),
  createNote: call('note:create'),
  createFolder: call('folder:create'),
  ensureFolder: call('folder:ensure'),
  rename: call('item:rename'),
  move: call('item:move'),
  remove: call('item:delete'),
  duplicate: call('item:duplicate'),
  search: call('search'),
  saveAsset: call('asset:save'),
  pickImages: call('asset:pick'),
  listPlugins: call('plugins:list'),
  openPluginFolder: call('plugins:openFolder'),
  saveTextFile: call('file:saveText'),
  saveFile: call('file:save'),
  printNote: call('export:pdf'),
  setTitleBar: call('window:titlebar'),
  openExternal: call('open:external'),
  focusWindow: call('window:focus'),
  fetchCalendar: call('ical:fetch'),
  // Konto & Synchronisierung
  getAccount: call('account:get'),
  probeServer: call('account:probe'),
  changeServer: call('account:changeServer'),
  login: call('account:login'),
  logout: call('account:logout'),
  accountInfo: call('account:me'),
  changePassword: call('account:password'),
  syncNow: call('sync:now'),
  noteVersions: call('history:list'),
  noteVersion: call('history:get'),
  syncStart: call('sync:start'),
  syncResolve: call('sync:resolve'),
  syncMark: call('sync:mark'),
  liveCredentials: call('account:live'),
  // Updates
  appVersion: call('app:version'),
  updateStatus: call('update:get'),
  checkUpdate: call('update:check'),
  installUpdate: call('update:install'),
  // Schnellnotiz-Fenster
  quickSubmit: call('quick:submit'),
  quickHide: call('quick:hide'),
  quickResize: call('quick:resize'),
  quickShortcutStatus: call('quick:shortcut'),
  openQuickWindow: call('quick:open'),
  on: (channel, fn) => {
    const allowed = ['sync:status', 'sync:changed', 'sync:conflicts', 'account:authLost', 'update:status', 'quicknote:add', 'quicknote:show'];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  platform: process.platform
});
