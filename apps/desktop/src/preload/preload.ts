import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '@docsteward/contracts';

const bridge: DesktopBridge = {
  getAuthState: () => ipcRenderer.invoke('docsteward:get-auth-state'),
  login: (email, password) => ipcRenderer.invoke('docsteward:login', { email, password }),
  logout: () => ipcRenderer.invoke('docsteward:logout'),
  selectWorkspace: () => ipcRenderer.invoke('docsteward:select-workspace'),
  removeWorkspace: (workspaceId) => ipcRenderer.invoke('docsteward:remove-workspace', workspaceId),
  getAppInfo: () => ipcRenderer.invoke('docsteward:get-app-info'),
  openLogsDirectory: () => ipcRenderer.invoke('docsteward:open-logs'),
  retryServer: () => ipcRenderer.invoke('docsteward:retry-server'),
};

contextBridge.exposeInMainWorld('docSteward', bridge);
