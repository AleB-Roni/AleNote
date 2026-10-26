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
  setTitleBar: call('window:titlebar'),
  openExternal: call('open:external'),
  platform: process.platform
});
