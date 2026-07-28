const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { XMLParser } = require('fast-xml-parser');

// repos.json：可分享的部署設定（deploy profile、module），跟每個人的本機路徑無關
// repos.local.json：只存這台電腦的 checkout 路徑，不分享、不進版控
// settings.local.json：本機其他個人化設定（目前只有 GitHub 根目錄），也不分享
const REPOS_CONFIG_PATH = path.join(__dirname, 'repos.json');
const REPOS_LOCAL_PATH = path.join(__dirname, 'repos.local.json');
const SETTINGS_LOCAL_PATH = path.join(__dirname, 'settings.local.json');
const MAVEN_SETTINGS_PATH = path.join(os.homedir(), '.m2', 'settings.xml');

let mainWindow;
// repoId -> ChildProcess，用來支援「取消執行」
const runningProcesses = new Map();

// electron 啟動時就凍結一份 process.env，之後使用者改了 JAVA_HOME 不會反映進來，
// 所以每次執行都直接向 Windows 登錄檔問目前實際值
function getCurrentJavaHome() {
  const queries = [
    'reg query "HKCU\\Environment" /v JAVA_HOME',
    'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v JAVA_HOME',
  ];
  for (const cmd of queries) {
    try {
      const out = execSync(cmd, { encoding: 'utf-8' });
      const match = out.match(/JAVA_HOME\s+REG_\w+\s+(.+)/);
      if (match) return match[1].trim();
    } catch {
      // 該登錄檔位置沒設，換下一個查
    }
  }
  return process.env.JAVA_HOME;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1b1d1f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- Repo 清單 ----------
function loadLocalPaths() {
  if (!fs.existsSync(REPOS_LOCAL_PATH)) return {};
  return JSON.parse(fs.readFileSync(REPOS_LOCAL_PATH, 'utf-8'));
}

function saveLocalPaths(map) {
  fs.writeFileSync(REPOS_LOCAL_PATH, JSON.stringify(map, null, 2) + '\n', 'utf-8');
}

function loadRepoProfiles() {
  const raw = fs.readFileSync(REPOS_CONFIG_PATH, 'utf-8');
  const repos = JSON.parse(raw);
  const localPaths = loadLocalPaths();
  return repos.map((repo) => ({ ...repo, localPath: localPaths[repo.id] || null }));
}

function loadLocalSettings() {
  if (!fs.existsSync(SETTINGS_LOCAL_PATH)) return {};
  return JSON.parse(fs.readFileSync(SETTINGS_LOCAL_PATH, 'utf-8'));
}

function saveLocalSettings(settings) {
  fs.writeFileSync(SETTINGS_LOCAL_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

ipcMain.handle('get-settings', () => {
  try {
    return { ok: true, settings: loadLocalSettings() };
  } catch (err) {
    return { ok: false, error: `Failed to read settings: ${err.message}` };
  }
});

ipcMain.handle('set-github-root', (event, { githubRoot }) => {
  try {
    const settings = loadLocalSettings();
    settings.githubRoot = githubRoot?.trim() || null;
    saveLocalSettings(settings);
    return { ok: true, settings };
  } catch (err) {
    return { ok: false, error: `Failed to save: ${err.message}` };
  }
});

// 只補「還沒設路徑」的 repo：猜 <githubRoot>\<repo id> 存在就採用，已有路徑的不覆蓋
ipcMain.handle('auto-detect-paths', () => {
  try {
    const { githubRoot } = loadLocalSettings();
    if (!githubRoot) return { ok: false, error: 'GitHub root folder is not set yet' };

    const shareable = JSON.parse(fs.readFileSync(REPOS_CONFIG_PATH, 'utf-8'));
    const localPaths = loadLocalPaths();
    let matched = 0;
    shareable.forEach((repo) => {
      if (localPaths[repo.id]) return;
      const guess = path.join(githubRoot, repo.id);
      if (fs.existsSync(guess)) {
        localPaths[repo.id] = guess;
        matched += 1;
      }
    });
    saveLocalPaths(localPaths);

    return { ok: true, matched, repos: loadRepoProfiles() };
  } catch (err) {
    return { ok: false, error: `Auto-detect failed: ${err.message}` };
  }
});

ipcMain.handle('list-repos', () => {
  try {
    return { ok: true, repos: loadRepoProfiles() };
  } catch (err) {
    return { ok: false, error: `Failed to read repos.json: ${err.message}` };
  }
});

function slugifyRepoId(name, existingRepos) {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'repo';
  const ids = new Set(existingRepos.map((r) => r.id));
  let id = base;
  let i = 2;
  while (ids.has(id)) id = `${base}-${i++}`;
  return id;
}

ipcMain.handle(
  'add-repo',
  (event, { displayName, localPath, bundleModule, bundleProfile, packageModule, packageProfile }) => {
    try {
      if (!displayName?.trim() || !localPath?.trim()) {
        return { ok: false, error: 'Display name and local path are required' };
      }
      const shareable = JSON.parse(fs.readFileSync(REPOS_CONFIG_PATH, 'utf-8'));
      const repo = {
        id: slugifyRepoId(displayName, shareable),
        displayName: displayName.trim(),
        installTargets: {
          bundle: {
            workingModule: bundleModule?.trim() || null,
            profile: bundleProfile?.trim() || null,
          },
          package: {
            workingModule: packageModule?.trim() || null,
            profile: packageProfile?.trim() || null,
          },
        },
      };
      shareable.push(repo);
      fs.writeFileSync(REPOS_CONFIG_PATH, JSON.stringify(shareable, null, 2) + '\n', 'utf-8');

      const localPaths = loadLocalPaths();
      localPaths[repo.id] = localPath.trim();
      saveLocalPaths(localPaths);

      return { ok: true, repos: loadRepoProfiles() };
    } catch (err) {
      return { ok: false, error: `Failed to add repo: ${err.message}` };
    }
  }
);

ipcMain.handle(
  'update-repo',
  (event, { id, displayName, localPath, bundleModule, bundleProfile, packageModule, packageProfile }) => {
    try {
      if (!displayName?.trim() || !localPath?.trim()) {
        return { ok: false, error: 'Display name and local path are required' };
      }
      const shareable = JSON.parse(fs.readFileSync(REPOS_CONFIG_PATH, 'utf-8'));
      const repo = shareable.find((r) => r.id === id);
      if (!repo) return { ok: false, error: 'Repo not found in repos.json' };

      repo.displayName = displayName.trim();
      repo.installTargets = {
        bundle: {
          workingModule: bundleModule?.trim() || null,
          profile: bundleProfile?.trim() || null,
        },
        package: {
          workingModule: packageModule?.trim() || null,
          profile: packageProfile?.trim() || null,
        },
      };
      fs.writeFileSync(REPOS_CONFIG_PATH, JSON.stringify(shareable, null, 2) + '\n', 'utf-8');

      const localPaths = loadLocalPaths();
      localPaths[id] = localPath.trim();
      saveLocalPaths(localPaths);

      return { ok: true, repos: loadRepoProfiles() };
    } catch (err) {
      return { ok: false, error: `Failed to update repo: ${err.message}` };
    }
  }
);

ipcMain.handle('delete-repo', (event, { id }) => {
  try {
    if (runningProcesses.has(id)) {
      return { ok: false, error: 'This repo is running, stop it before deleting' };
    }
    const shareable = JSON.parse(fs.readFileSync(REPOS_CONFIG_PATH, 'utf-8'));
    const next = shareable.filter((r) => r.id !== id);
    fs.writeFileSync(REPOS_CONFIG_PATH, JSON.stringify(next, null, 2) + '\n', 'utf-8');

    const localPaths = loadLocalPaths();
    delete localPaths[id];
    saveLocalPaths(localPaths);

    return { ok: true, repos: loadRepoProfiles() };
  } catch (err) {
    return { ok: false, error: `Failed to delete repo: ${err.message}` };
  }
});

ipcMain.handle('set-repo-path', (event, { repoId, localPath }) => {
  try {
    if (!localPath?.trim()) return { ok: false, error: 'Local path is required' };
    const localPaths = loadLocalPaths();
    localPaths[repoId] = localPath.trim();
    saveLocalPaths(localPaths);
    return { ok: true, repos: loadRepoProfiles() };
  } catch (err) {
    return { ok: false, error: `Failed to set path: ${err.message}` };
  }
});

// ---------- Git 分支切換 ----------
ipcMain.handle('list-branches', (event, { repoId }) => {
  try {
    const repo = loadRepoProfiles().find((r) => r.id === repoId);
    if (!repo?.localPath) return { ok: false, error: 'Local path is not set yet' };
    const local = execFileSync('git', ['branch', '--format=%(refname:short)'], {
      cwd: repo.localPath,
      encoding: 'utf-8',
    }).split('\n').map((s) => s.trim()).filter(Boolean);
    // 遠端分支：origin/xxx 去掉字首跟本機分支合併顯示，才選得到「本機還沒 checkout 過」的分支
    const remote = execFileSync('git', ['branch', '-r', '--format=%(refname:short)'], {
      cwd: repo.localPath,
      encoding: 'utf-8',
    })
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && !s.endsWith('/HEAD'))
      .map((s) => s.replace(/^origin\//, ''));
    const branches = [...new Set([...local, ...remote])];
    const current = execFileSync('git', ['branch', '--show-current'], {
      cwd: repo.localPath,
      encoding: 'utf-8',
    }).trim();
    return { ok: true, branches, current };
  } catch (err) {
    return { ok: false, error: `Failed to read branches: ${err.message}` };
  }
});

// git fetch 用 spawn（而非 execFileSync）才能邊跑邊把 --progress 輸出串給前端，
// 讓使用者看得到「正在抓」而不是整個 UI 卡住等一個看不到進度的 IPC
ipcMain.handle('fetch-repo', (event, { repoId }) => {
  const repo = loadRepoProfiles().find((r) => r.id === repoId);
  const sender = event.sender;
  if (!repo?.localPath) return Promise.resolve({ ok: false, error: 'Local path is not set yet' });

  return new Promise((resolve) => {
    sender.send('fetch-start', { repoId });
    const proc = spawn('git', ['fetch', '--all', '--prune', '--progress'], {
      cwd: repo.localPath,
      shell: true,
    });
    // git 的 --progress 輸出是寫到 stderr，不代表是錯誤
    proc.stdout.on('data', (d) => sender.send('fetch-log', { repoId, line: d.toString() }));
    proc.stderr.on('data', (d) => sender.send('fetch-log', { repoId, line: d.toString() }));
    proc.on('error', (err) => {
      sender.send('fetch-done', { repoId, success: false, error: err.message });
      resolve({ ok: false, error: `Failed to start git: ${err.message}` });
    });
    proc.on('close', (code) => {
      const success = code === 0;
      sender.send('fetch-done', { repoId, success });
      resolve(success ? { ok: true } : { ok: false, error: `git fetch exit code ${code}` });
    });
  });
});

ipcMain.handle('checkout-branch', (event, { repoId, branch }) => {
  try {
    if (!branch?.trim()) return { ok: false, error: 'Branch name is required' };
    if (runningProcesses.has(repoId)) return { ok: false, error: 'This repo is running, stop it before switching branches' };
    const repo = loadRepoProfiles().find((r) => r.id === repoId);
    if (!repo?.localPath) return { ok: false, error: 'Local path is not set yet' };
    execFileSync('git', ['checkout', branch], { cwd: repo.localPath, encoding: 'utf-8' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Failed to switch branch: ${err.message}` };
  }
});

// ---------- 動態解析 Maven settings.xml 的 profile id ----------
function listMavenProfileIds() {
  if (!fs.existsSync(MAVEN_SETTINGS_PATH)) {
    throw new Error(`${MAVEN_SETTINGS_PATH} not found, check that Maven settings.xml exists`);
  }
  const xml = fs.readFileSync(MAVEN_SETTINGS_PATH, 'utf-8');
  const parsed = new XMLParser().parse(xml);

  const rawProfiles = parsed.settings?.profiles?.profile;
  if (!rawProfiles) return [];
  const profiles = Array.isArray(rawProfiles) ? rawProfiles : [rawProfiles];

  // adobe-public 是 repository/proxy 設定用的 profile，不是部署環境，不列出來給人選
  return profiles.map((p) => p.id).filter((id) => id && id !== 'adobe-public');
}

ipcMain.handle('list-environments', () => {
  try {
    return { ok: true, profiles: listMavenProfileIds() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------- 執行打包 ----------
const INSTALL_TYPE_LABELS = { bundle: 'Bundle only', package: 'Whole project' };

// repoIds: string[], profileId: string, installType: 'bundle' | 'package',
// skipTests: boolean, extraArgs: string（使用者手動輸入，如 "-T 24"）
ipcMain.handle('run-package', async (event, { repoIds, profileId, installType, skipTests, extraArgs }) => {
  const repos = loadRepoProfiles();
  const sender = event.sender;
  const extraArgList = extraArgs?.trim() ? extraArgs.trim().split(/\s+/) : [];

  // 目前無 dependsOn，全部平行執行
  const tasks = repoIds.map((repoId) => {
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) {
      sender.send('build-done', { repoId, success: false, error: 'Repo not found in repos.json' });
      return Promise.resolve();
    }
    return runMavenProcess(repo, profileId, installType, skipTests, extraArgList, sender).catch(() => {
      /* 個別 repo 失敗不中斷其他 repo，錯誤已透過 build-done 送出 */
    });
  });

  await Promise.all(tasks);
  return { ok: true };
});

function runMavenProcess(repo, profileId, installType, skipTests, extraArgList, sender) {
  return new Promise((resolve, reject) => {
    if (!repo.localPath || !fs.existsSync(repo.localPath)) {
      const msg = repo.localPath ? `Path does not exist: ${repo.localPath}` : 'Local path is not set for this repo yet';
      sender.send('build-log', { repoId: repo.id, line: msg, isError: true });
      sender.send('build-done', { repoId: repo.id, success: false, error: msg });
      return reject(new Error(msg));
    }

    const target = repo.installTargets?.[installType];
    if (!target?.profile) {
      const msg = `This repo has no deploy profile configured for "${INSTALL_TYPE_LABELS[installType] || installType}"`;
      sender.send('build-log', { repoId: repo.id, line: msg, isError: true });
      sender.send('build-done', { repoId: repo.id, success: false, error: msg });
      return reject(new Error(msg));
    }

    const javaHome = getCurrentJavaHome();
    if (!javaHome || !fs.existsSync(path.join(javaHome, 'bin', 'java.exe'))) {
      const msg = `Invalid JAVA_HOME: ${javaHome || '(not set)'}`;
      sender.send('build-log', { repoId: repo.id, line: msg, isError: true });
      sender.send('build-done', { repoId: repo.id, success: false, error: msg });
      return reject(new Error(msg));
    }

    const profiles = [profileId, target.profile].filter(Boolean);
    const args = ['clean', 'install'];
    if (profiles.length) args.push(`-P${profiles.join(',')}`);
    if (target.workingModule) args.push('-pl', target.workingModule, '-am');
    if (skipTests) args.push('-DskipTests');
    args.push(...extraArgList);

    sender.send('build-start', { repoId: repo.id, command: `mvn ${args.join(' ')}` });

    // shell: true 是為了在 Windows 上正確解析 mvn.cmd；env 用即時查到的 JAVA_HOME 覆蓋，
    // 避免吃到 electron 啟動當下就凍結、可能過期的 process.env.JAVA_HOME
    const proc = spawn('mvn', args, {
      cwd: repo.localPath,
      shell: true,
      env: { ...process.env, JAVA_HOME: javaHome },
    });
    runningProcesses.set(repo.id, proc);

    proc.stdout.on('data', (data) => {
      sender.send('build-log', { repoId: repo.id, line: data.toString() });
    });
    proc.stderr.on('data', (data) => {
      sender.send('build-log', { repoId: repo.id, line: data.toString(), isError: true });
    });
    proc.on('error', (err) => {
      sender.send('build-log', { repoId: repo.id, line: `Failed to start mvn: ${err.message}`, isError: true });
    });
    proc.on('close', (code) => {
      runningProcesses.delete(repo.id);
      const success = code === 0;
      sender.send('build-done', { repoId: repo.id, success, exitCode: code });
      success ? resolve() : reject(new Error(`${repo.id} exit code ${code}`));
    });
  });
}

ipcMain.handle('cancel-package', (event, { repoId }) => {
  const proc = runningProcesses.get(repoId);
  if (!proc) return { ok: false, error: 'No running process found' };

  event.sender.send('build-log', { repoId, line: '[Stop requested by user]', isError: true });
  try {
    // Windows 上直接 kill 子行程有時殺不掉整個 mvn.cmd 樹，改用 taskkill 較穩；
    // 用同步版本才能知道是否真的成功，避免刪掉行程卻沒發現失敗
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${proc.pid} /T /F`);
    } else {
      proc.kill('SIGTERM');
    }
    return { ok: true };
  } catch (err) {
    const msg = `Failed to stop: ${err.message}`;
    event.sender.send('build-log', { repoId, line: msg, isError: true });
    return { ok: false, error: msg };
  }
});
