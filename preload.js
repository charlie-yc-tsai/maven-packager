const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('packagerAPI', {
  listRepos: () => ipcRenderer.invoke('list-repos'),
  addRepo: (repo) => ipcRenderer.invoke('add-repo', repo),
  updateRepo: (repo) => ipcRenderer.invoke('update-repo', repo),
  setRepoPath: (repoId, localPath) => ipcRenderer.invoke('set-repo-path', { repoId, localPath }),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setGithubRoot: (githubRoot) => ipcRenderer.invoke('set-github-root', { githubRoot }),
  autoDetectPaths: () => ipcRenderer.invoke('auto-detect-paths'),
  listEnvironments: () => ipcRenderer.invoke('list-environments'),
  runPackage: (repoIds, profileId, installType, options) =>
    ipcRenderer.invoke('run-package', { repoIds, profileId, installType, ...options }),
  cancelPackage: (repoId) => ipcRenderer.invoke('cancel-package', { repoId }),

  onBuildStart: (callback) => ipcRenderer.on('build-start', (_e, payload) => callback(payload)),
  onBuildLog: (callback) => ipcRenderer.on('build-log', (_e, payload) => callback(payload)),
  onBuildDone: (callback) => ipcRenderer.on('build-done', (_e, payload) => callback(payload)),
});
