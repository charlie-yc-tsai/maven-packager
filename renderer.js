const repoListEl = document.getElementById('repoList');
const envSelect = document.getElementById('envSelect');
const refreshEnvBtn = document.getElementById('refreshEnvBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const runBtn = document.getElementById('runBtn');
const stopBtn = document.getElementById('stopBtn');
const bannerEl = document.getElementById('banner');
const tabBarEl = document.getElementById('tabBar');
const logPanelsEl = document.getElementById('logPanels');
const addRepoBtn = document.getElementById('addRepoBtn');
const addRepoForm = document.getElementById('addRepoForm');
const addRepoFormTitle = document.getElementById('addRepoFormTitle');
const repoFormSubmitBtn = document.getElementById('repoFormSubmitBtn');
const cancelAddRepoBtn = document.getElementById('cancelAddRepoBtn');
const newRepoName = document.getElementById('newRepoName');
const newRepoPath = document.getElementById('newRepoPath');
const newRepoBundleModule = document.getElementById('newRepoBundleModule');
const newRepoBundleProfile = document.getElementById('newRepoBundleProfile');
const newRepoPackageModule = document.getElementById('newRepoPackageModule');
const newRepoPackageProfile = document.getElementById('newRepoPackageProfile');
const skipTestsChk = document.getElementById('skipTestsChk');
const extraArgsInput = document.getElementById('extraArgsInput');
const githubRootInput = document.getElementById('githubRootInput');
const saveGithubRootBtn = document.getElementById('saveGithubRootBtn');
const autoDetectBtn = document.getElementById('autoDetectBtn');

let repos = [];
let activeTabId = null;
let editingRepoId = null;
const runningRepoIds = new Set();

// ---------- 打包設定記憶（環境、安裝方式、跳過測試、額外參數） ----------
// 存 localStorage，重開 app 後沿用上次的選擇
const PREFS_KEY = 'aemPackagerToolbarPrefs';

function savePrefs() {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      profile: envSelect.value,
      installType: document.querySelector('input[name="installType"]:checked')?.value,
      skipTests: skipTestsChk.checked,
      extraArgs: extraArgsInput.value,
    })
  );
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

// ---------- 拖拉排序（repo 清單、log 分頁共用） ----------
// container 的直接子元素若有 draggable="true" 就可拖，axis 決定用垂直還是水平位置判斷插入點
function makeSortable(container, axis, onDrop) {
  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest('[draggable="true"]');
    if (item && item.parentElement === container) {
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    }
  });
  container.addEventListener('dragend', (e) => {
    e.target.closest('[draggable="true"]')?.classList.remove('dragging');
  });
  container.addEventListener('dragover', (e) => {
    const dragging = container.querySelector('.dragging');
    if (!dragging) return;
    e.preventDefault();
    const pos = axis === 'x' ? e.clientX : e.clientY;
    const items = [...container.querySelectorAll('[draggable="true"]:not(.dragging)')];
    const after = items.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = axis === 'x' ? pos - box.left - box.width / 2 : pos - box.top - box.height / 2;
      return offset < 0 && offset > closest.offset ? { offset, element: child } : closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
    if (after == null) container.appendChild(dragging);
    else container.insertBefore(dragging, after);
  });
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    onDrop?.();
  });
}

// repo 清單順序是個人偏好，存 localStorage，不動 repos.json（那是團隊共用設定）
const REPO_ORDER_KEY = 'aemPackagerRepoOrder';
function loadRepoOrder() {
  try {
    return JSON.parse(localStorage.getItem(REPO_ORDER_KEY)) || [];
  } catch {
    return [];
  }
}
function applyRepoOrder(orderedIds) {
  const rank = new Map(orderedIds.map((id, i) => [id, i]));
  repos = [...repos].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
}
function onRepoReorder() {
  const orderedIds = [...repoListEl.children].map((el) => el.dataset.repoId).filter(Boolean);
  localStorage.setItem(REPO_ORDER_KEY, JSON.stringify(orderedIds));
  applyRepoOrder(orderedIds);
}
makeSortable(repoListEl, 'y', onRepoReorder);
makeSortable(tabBarEl, 'x');

function showBanner(message, type = 'error') {
  bannerEl.textContent = message;
  bannerEl.classList.toggle('info', type === 'info');
  bannerEl.classList.remove('hidden');
}
function hideBanner() {
  bannerEl.classList.add('hidden');
}

// ---------- GitHub 根目錄 ----------
async function loadGithubRoot() {
  const res = await window.packagerAPI.getSettings();
  if (res.ok && res.settings.githubRoot) githubRootInput.value = res.settings.githubRoot;
}

saveGithubRootBtn.addEventListener('click', async () => {
  const res = await window.packagerAPI.setGithubRoot(githubRootInput.value);
  if (!res.ok) {
    showBanner(res.error);
    return;
  }
  showBanner('已儲存 GitHub 根目錄', 'info');
});

autoDetectBtn.addEventListener('click', async () => {
  const res = await window.packagerAPI.autoDetectPaths();
  if (!res.ok) {
    showBanner(res.error);
    return;
  }
  repos = res.repos;
  applyRepoOrder(loadRepoOrder());
  renderRepoList();
  showBanner(res.matched > 0 ? `自動配對成功 ${res.matched} 個 repo 路徑` : '沒有找到符合的新路徑', 'info');
});

// ---------- Repo 清單 ----------
async function loadRepos() {
  const res = await window.packagerAPI.listRepos();
  if (!res.ok) {
    repoListEl.innerHTML = `<div class="empty-hint">${res.error}</div>`;
    return;
  }
  repos = res.repos;
  applyRepoOrder(loadRepoOrder());
  renderRepoList();
}

function renderRepoList() {
  repoListEl.innerHTML = '';
  repos.forEach((repo) => {
    if (!repo.localPath) {
      repoListEl.appendChild(buildMissingPathRow(repo));
      return;
    }
    const row = document.createElement('label');
    row.className = 'repo-item';
    row.title = repo.localPath;
    row.draggable = true;
    row.dataset.repoId = repo.id;
    row.innerHTML = `
      <input type="checkbox" data-repo-id="${repo.id}" />
      <span class="status-dot" id="dot-${repo.id}"></span>
      <span class="repo-item-name">${repo.displayName}</span>
      <button type="button" class="link-btn repo-edit-btn" title="編輯此 repo">✎</button>
    `;
    row.querySelector('input').addEventListener('change', updateRunButtonState);
    row.querySelector('.repo-edit-btn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openEditForm(repo);
    });
    repoListEl.appendChild(row);
  });
}

// 既有 repo 用同一個表單編輯（新增/編輯共用），送出時用 editingRepoId 判斷要 add 還是 update
function openEditForm(repo) {
  editingRepoId = repo.id;
  addRepoFormTitle.textContent = `編輯 Repo：${repo.displayName}`;
  repoFormSubmitBtn.textContent = '更新';
  newRepoName.value = repo.displayName;
  newRepoPath.value = repo.localPath || '';
  newRepoBundleModule.value = repo.installTargets?.bundle?.workingModule || '';
  newRepoBundleProfile.value = repo.installTargets?.bundle?.profile || '';
  newRepoPackageModule.value = repo.installTargets?.package?.workingModule || '';
  newRepoPackageProfile.value = repo.installTargets?.package?.profile || '';
  addRepoForm.classList.remove('hidden');
  newRepoName.focus();
}

function closeRepoForm() {
  editingRepoId = null;
  addRepoFormTitle.textContent = '新增 Repo';
  repoFormSubmitBtn.textContent = '新增';
  addRepoForm.reset();
  addRepoForm.classList.add('hidden');
}

// repos.json 分享給同仁後，對方那台電腦沒有這個 repo 的本機路徑，
// 用這行內建的欄位讓他填一次，存進只留在本機的 repos.local.json
function buildMissingPathRow(repo) {
  const row = document.createElement('div');
  row.className = 'repo-item repo-item-nopath';
  row.draggable = true;
  row.dataset.repoId = repo.id;
  row.innerHTML = `
    <span class="repo-item-name">${repo.displayName}</span>
    <button type="button" class="link-btn repo-edit-btn" title="編輯此 repo">✎</button>
    <input type="text" class="repo-path-input" placeholder="設定本機路徑…" />
    <button type="button" class="link-btn repo-path-save">存</button>
  `;
  row.querySelector('.repo-edit-btn').addEventListener('click', () => openEditForm(repo));
  const input = row.querySelector('.repo-path-input');
  const save = async () => {
    if (!input.value.trim()) return;
    const res = await window.packagerAPI.setRepoPath(repo.id, input.value);
    if (!res.ok) {
      showBanner(res.error);
      return;
    }
    repos = res.repos;
    applyRepoOrder(loadRepoOrder());
    renderRepoList();
  };
  row.querySelector('.repo-path-save').addEventListener('click', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
  });
  return row;
}

addRepoBtn.addEventListener('click', () => {
  if (!addRepoForm.classList.contains('hidden') && !editingRepoId) {
    closeRepoForm();
    return;
  }
  editingRepoId = null;
  addRepoFormTitle.textContent = '新增 Repo';
  repoFormSubmitBtn.textContent = '新增';
  addRepoForm.reset();
  addRepoForm.classList.remove('hidden');
  newRepoName.focus();
});
cancelAddRepoBtn.addEventListener('click', closeRepoForm);
addRepoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    displayName: newRepoName.value,
    localPath: newRepoPath.value,
    bundleModule: newRepoBundleModule.value,
    bundleProfile: newRepoBundleProfile.value,
    packageModule: newRepoPackageModule.value,
    packageProfile: newRepoPackageProfile.value,
  };
  const res = editingRepoId
    ? await window.packagerAPI.updateRepo({ id: editingRepoId, ...payload })
    : await window.packagerAPI.addRepo(payload);
  if (!res.ok) {
    showBanner(res.error);
    return;
  }
  repos = res.repos;
  applyRepoOrder(loadRepoOrder());
  renderRepoList();
  closeRepoForm();
});

selectAllBtn.addEventListener('click', () => {
  const boxes = repoListEl.querySelectorAll('input[type="checkbox"]');
  const allChecked = [...boxes].every((b) => b.checked);
  boxes.forEach((b) => (b.checked = !allChecked));
  updateRunButtonState();
});

function getSelectedRepoIds() {
  return [...repoListEl.querySelectorAll('input[type="checkbox"]:checked')].map(
    (b) => b.dataset.repoId
  );
}

// ---------- 環境（Maven profile） ----------
async function loadEnvironments() {
  envSelect.disabled = true;
  envSelect.innerHTML = '<option>讀取中…</option>';
  hideBanner();

  const res = await window.packagerAPI.listEnvironments();
  const profiles = res.ok ? res.profiles : [];
  if (!res.ok) showBanner(`讀取 Maven settings.xml 失敗：${res.error}（仍可用本機安裝）`);

  // 本機安裝不需要 settings.xml，就算讀取失敗也一定有得選
  const options = ['<option value="">本機安裝（不需選 profile）</option>']
    .concat(profiles.map((p) => `<option value="${p}">${p}</option>`));
  envSelect.innerHTML = options.join('');

  const savedProfile = loadPrefs().profile;
  envSelect.value = profiles.includes(savedProfile) ? savedProfile : ''; // 沒有存過或選項已消失就退回本機安裝
  envSelect.disabled = false;
  updateRunButtonState();
}

refreshEnvBtn.addEventListener('click', loadEnvironments);
envSelect.addEventListener('change', savePrefs);

function updateRunButtonState() {
  const hasRepo = getSelectedRepoIds().length > 0;
  runBtn.disabled = !(hasRepo && !envSelect.disabled);
}
envSelect.addEventListener('change', updateRunButtonState);

// ---------- 狀態燈號 ----------
function setStatus(repoId, status) {
  [`dot-${repoId}`, `tab-dot-${repoId}`].forEach((id) => {
    const dot = document.getElementById(id);
    if (!dot) return;
    dot.classList.remove('running', 'success', 'fail');
    if (status) dot.classList.add(status);
  });
}

// ---------- Log Tabs ----------
function ensureTab(repoId, command) {
  const existing = document.getElementById(`tab-${repoId}`);
  if (existing) {
    if (command) {
      const cmdEl = document.querySelector(`#panel-${repoId} .log-panel-cmd`);
      if (cmdEl) cmdEl.textContent = command;
    }
    return;
  }

  const repo = repos.find((r) => r.id === repoId);
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.id = `tab-${repoId}`;
  tab.draggable = true;
  tab.dataset.repoId = repoId;
  tab.innerHTML = `
    <span class="status-dot" id="tab-dot-${repoId}"></span>
    <span class="tab-label">${repo ? repo.displayName : repoId}</span>
    <button type="button" class="tab-action tab-start" title="開始／重新開始">▶</button>
    <button type="button" class="tab-action tab-stop" title="停止此 repo">■</button>
  `;
  tab.addEventListener('click', () => activateTab(repoId));
  tab.querySelector('.tab-start').addEventListener('click', (e) => {
    e.stopPropagation();
    const body = document.getElementById(`body-${repoId}`);
    if (body) body.innerHTML = '';
    startRepos([repoId]);
  });
  tab.querySelector('.tab-stop').addEventListener('click', (e) => {
    e.stopPropagation();
    window.packagerAPI.cancelPackage(repoId);
  });
  tabBarEl.appendChild(tab);

  const panel = document.createElement('div');
  panel.className = 'log-panel';
  panel.id = `panel-${repoId}`;
  panel.innerHTML = `
    <div class="log-panel-cmd">${command || ''}</div>
    <div class="log-panel-body" id="body-${repoId}"></div>
  `;
  logPanelsEl.appendChild(panel);

  setTabRunning(repoId, runningRepoIds.has(repoId));
  if (runningRepoIds.has(repoId)) setStatus(repoId, 'running');
  if (!activeTabId) activateTab(repoId);
}

function setTabRunning(repoId, running) {
  const tab = document.getElementById(`tab-${repoId}`);
  if (!tab) return;
  tab.querySelector('.tab-start').disabled = running;
  tab.querySelector('.tab-stop').disabled = !running;
}

function activateTab(repoId) {
  activeTabId = repoId;
  document.querySelectorAll('.tab').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.log-panel').forEach((el) => el.classList.remove('active'));
  document.getElementById(`tab-${repoId}`)?.classList.add('active');
  document.getElementById(`panel-${repoId}`)?.classList.add('active');
}

function appendLog(repoId, line, isError) {
  const body = document.getElementById(`body-${repoId}`);
  if (!body) return;
  const div = document.createElement('div');
  const level = /\[(ERROR|FATAL)\]/i.test(line) || isError
    ? 'error'
    : /\[WARN(ING)?\]/i.test(line)
    ? 'warn'
    : '';
  div.className = 'log-line' + (level ? ` ${level}` : '');
  div.textContent = line;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

// ---------- 執行打包 ----------
// 共用邏輯：分頁上的 ▶ 跟側邊欄的「開始打包」都走這裡，
// 讓已經在跑的 repo 可以跳過，也讓單一 repo 可以獨立重新開始
async function startRepos(repoIds) {
  const toStart = repoIds.filter((id) => !runningRepoIds.has(id));
  const profileId = envSelect.value || null;
  const installType = document.querySelector('input[name="installType"]:checked').value;
  if (toStart.length === 0) return;

  hideBanner();
  stopBtn.classList.remove('hidden');

  toStart.forEach((id) => {
    runningRepoIds.add(id);
    setStatus(id, 'running');
    setTabRunning(id, true);
  });

  await window.packagerAPI.runPackage(toStart, profileId, installType, {
    skipTests: skipTestsChk.checked,
    extraArgs: extraArgsInput.value,
  });

  if (runningRepoIds.size === 0) stopBtn.classList.add('hidden');
}

runBtn.addEventListener('click', () => startRepos(getSelectedRepoIds()));

stopBtn.addEventListener('click', () => {
  runningRepoIds.forEach((id) => window.packagerAPI.cancelPackage(id));
});

window.packagerAPI.onBuildStart(({ repoId, command }) => {
  ensureTab(repoId, command);
});
window.packagerAPI.onBuildLog(({ repoId, line, isError }) => {
  ensureTab(repoId);
  appendLog(repoId, line, isError);
});
window.packagerAPI.onBuildDone(({ repoId, success, error }) => {
  runningRepoIds.delete(repoId);
  setStatus(repoId, success ? 'success' : 'fail');
  setTabRunning(repoId, false);
  if (error) appendLog(repoId, `[錯誤] ${error}`, true);
});

// ---------- 初始化 ----------
(function restorePrefs() {
  const prefs = loadPrefs();
  if (prefs.installType) {
    const radio = document.querySelector(`input[name="installType"][value="${prefs.installType}"]`);
    if (radio) radio.checked = true;
  }
  if (typeof prefs.skipTests === 'boolean') skipTestsChk.checked = prefs.skipTests;
  if (typeof prefs.extraArgs === 'string') extraArgsInput.value = prefs.extraArgs;
})();
document.querySelectorAll('input[name="installType"]').forEach((r) => r.addEventListener('change', savePrefs));
skipTestsChk.addEventListener('change', savePrefs);
extraArgsInput.addEventListener('change', savePrefs);

loadRepos();
loadEnvironments();
loadGithubRoot();
