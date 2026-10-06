const repoListEl = document.getElementById('repoList');
const envSelect = document.getElementById('envSelect');
const refreshEnvBtn = document.getElementById('refreshEnvBtn');
const javaSelect = document.getElementById('javaSelect');
const refreshJavaBtn = document.getElementById('refreshJavaBtn');
const copyJavaPathBtn = document.getElementById('copyJavaPathBtn');
const branchBarEl = document.getElementById('branchBar');
const branchBarRepoNameEl = document.getElementById('branchBarRepoName');
const branchInput = document.getElementById('branchInput');
const branchListOptions = document.getElementById('branchListOptions');
const switchBranchBtn = document.getElementById('switchBranchBtn');
const pullBranchBtn = document.getElementById('pullBranchBtn');
const refreshBranchBtn = document.getElementById('refreshBranchBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const runBtn = document.getElementById('runBtn');
const stopBtn = document.getElementById('stopBtn');
const bannerEl = document.getElementById('banner');
const bannerMsgEl = document.getElementById('bannerMsg');
const bannerCloseBtn = document.getElementById('bannerCloseBtn');
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
// pull 跟 mvn 用同一個資料夾，pull 中的 repo 不能開始打包，打包中的也不能 pull
const pullingRepoIds = new Set();

// ---------- 打包設定記憶（環境、安裝方式、跳過測試、額外參數） ----------
// 存 localStorage，重開 app 後沿用上次的選擇
const PREFS_KEY = 'aemPackagerToolbarPrefs';

function savePrefs() {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      profile: envSelect.value,
      javaHome: javaSelect.value,
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

// info 訊息（成功、完成通知）幾秒後自動收掉；錯誤訊息留著等使用者處理完自己關或做下一步操作
let bannerTimer = null;
function showBanner(message, type = 'error') {
  clearTimeout(bannerTimer);
  bannerMsgEl.textContent = message;
  bannerEl.classList.toggle('info', type === 'info');
  bannerEl.classList.remove('hidden');
  if (type === 'info') bannerTimer = setTimeout(hideBanner, 4000);
}
function hideBanner() {
  clearTimeout(bannerTimer);
  bannerEl.classList.add('hidden');
}
bannerCloseBtn.addEventListener('click', hideBanner);

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
  showBanner('GitHub root folder saved', 'info');
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
  showBanner(res.matched > 0 ? `Auto-matched ${res.matched} repo path(s)` : 'No new matching paths found', 'info');
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

let showMissingRepos = false;

function renderRepoList() {
  repoListEl.innerHTML = '';
  const missing = [];
  repos.forEach((repo) => {
    if (!repo.localPath) {
      missing.push(repo);
      if (showMissingRepos) repoListEl.appendChild(buildMissingPathRow(repo));
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
      <button type="button" class="link-btn repo-edit-btn" title="Edit this repo">✎</button>
      <button type="button" class="link-btn repo-delete-btn" title="Delete this repo">🗑</button>
    `;
    row.querySelector('input[type="checkbox"]').addEventListener('change', updateRunButtonState);
    row.querySelector('.repo-edit-btn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openEditForm(repo);
    });
    row.querySelector('.repo-delete-btn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteRepo(repo);
    });
    repoListEl.appendChild(row);
  });
  if (missing.length > 0) {
    const hint = document.createElement('button');
    hint.type = 'button';
    hint.className = 'link-btn repo-missing-hint';
    hint.textContent = showMissingRepos
      ? `Hide ${missing.length} repo(s) not found locally`
      : `${missing.length} repo(s) not found locally · Show`;
    hint.addEventListener('click', () => {
      showMissingRepos = !showMissingRepos;
      renderRepoList();
    });
    repoListEl.appendChild(hint);
  }
  updateBranchField();
}

// ---------- Git 分支 ----------
// 這是獨立的 contextual bar：只在左側「剛好勾一個 repo」時浮出來，
// 跟上面「怎麼打包」的 toolbar 是兩件事，不擠在同一排搶對齊
// branchInput 搭配 <datalist> 用瀏覽器原生的輸入時篩選/搜尋，不用另外寫下拉元件
let branchFieldRepoId = null;
let branchFieldOptions = [];
let branchFieldCurrent = null; // 讀取成功時的目前分支；null 代表還沒讀好，不給 pull / switch

// 打包中或 pull 中都不能 pull / 切分支（同一個資料夾）
function syncBranchButtons() {
  const id = branchFieldRepoId;
  const blocked = branchFieldCurrent === null || runningRepoIds.has(id) || pullingRepoIds.has(id);
  pullBranchBtn.disabled = blocked;
  switchBranchBtn.disabled = blocked;
  branchInput.disabled = blocked;
}

function resetBranchField() {
  branchFieldRepoId = null;
  branchBarEl.classList.add('hidden');
}

function updateBranchField() {
  const ids = getSelectedRepoIds();
  if (ids.length !== 1) return resetBranchField();
  branchBarEl.classList.remove('hidden');
  const repo = repos.find((r) => r.id === ids[0]);
  branchBarRepoNameEl.textContent = repo ? repo.displayName : ids[0];
  if (ids[0] !== branchFieldRepoId) loadBranchField(ids[0]); // 已經是這個 repo 就不用重讀
}

async function loadBranchField(repoId) {
  branchFieldRepoId = repoId;
  branchFieldCurrent = null;
  refreshBranchBtn.disabled = true;
  syncBranchButtons();
  branchInput.value = '';
  branchInput.placeholder = 'Loading…';
  const res = await window.packagerAPI.listBranches(repoId);
  if (branchFieldRepoId !== repoId) return; // 讀取途中使用者換了勾選，結果作廢
  refreshBranchBtn.disabled = false;
  if (!res.ok) {
    branchInput.placeholder = res.error;
    return;
  }
  // GitHub Desktop 目前選的是這個 repo 的 worktree 時，git/mvn 都在那個資料夾跑，標出來避免搞混
  const repo = repos.find((r) => r.id === repoId);
  branchBarRepoNameEl.textContent = (repo ? repo.displayName : repoId) + (res.isWorktree ? ` (worktree: ${res.workPath})` : '');
  branchFieldOptions = res.branches;
  branchListOptions.innerHTML = res.branches.map((b) => `<option value="${b}"></option>`).join('');
  branchFieldCurrent = res.current;
  branchInput.value = res.current;
  branchInput.placeholder = res.current ? 'Search branches…' : '(detached HEAD) Search branches…';
  syncBranchButtons();
}

refreshBranchBtn.addEventListener('click', () => {
  if (branchFieldRepoId) loadBranchField(branchFieldRepoId);
});

// 從 GitHub Desktop 切回來（可能換了 repo/worktree/分支）就自動重讀，畫面才不會顯示過期的分支；
// 使用者已經打了別的分支名稱還沒按 Switch 的話不重讀，免得打的字被蓋掉
window.addEventListener('focus', () => {
  const id = branchFieldRepoId;
  if (!id || pullingRepoIds.has(id)) return;
  if (branchFieldCurrent !== null && branchInput.value.trim() !== branchFieldCurrent) return;
  loadBranchField(id);
});

switchBranchBtn.addEventListener('click', async () => {
  const repoId = branchFieldRepoId;
  const branch = branchInput.value.trim();
  if (!repoId || !branch || branch === branchFieldCurrent) return;
  if (!branchFieldOptions.includes(branch)) {
    showBanner(`Branch not found: "${branch}"`);
    return;
  }
  switchBranchBtn.disabled = true;
  const res = await window.packagerAPI.checkoutBranch(repoId, branch);
  if (!res.ok) showBanner(res.error);
  else showBanner(`${repoName(repoId)} switched to ${branch}`, 'info');
  loadBranchField(repoId);
});
branchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') switchBranchBtn.click();
});

// git pull：把目前分支更新到最新
pullBranchBtn.addEventListener('click', async () => {
  const repoId = branchFieldRepoId;
  if (!repoId || runningRepoIds.has(repoId) || pullingRepoIds.has(repoId)) return;
  pullingRepoIds.add(repoId);
  syncTabButtons(repoId);
  refreshBranchBtn.disabled = true;
  syncBranchButtons();
  const res = await window.packagerAPI.pullRepo(repoId);
  pullingRepoIds.delete(repoId);
  syncTabButtons(repoId);
  if (branchFieldRepoId !== repoId) return; // pull 途中使用者換了勾選，結果作廢
  if (!res.ok) showBanner(res.error);
  else showBanner(`${repos.find((r) => r.id === repoId)?.displayName || repoId} git pull done`, 'info');
  loadBranchField(repoId);
});

// Existing repos share the same form for add/edit; editingRepoId decides add vs update on submit
function openEditForm(repo) {
  editingRepoId = repo.id;
  addRepoFormTitle.textContent = `Edit Repo: ${repo.displayName}`;
  repoFormSubmitBtn.textContent = 'Update';
  newRepoName.value = repo.displayName;
  newRepoPath.value = repo.localPath || '';
  newRepoBundleModule.value = repo.installTargets?.bundle?.workingModule || '';
  newRepoBundleProfile.value = repo.installTargets?.bundle?.profile || '';
  newRepoPackageModule.value = repo.installTargets?.package?.workingModule || '';
  newRepoPackageProfile.value = repo.installTargets?.package?.profile || '';
  addRepoForm.classList.remove('hidden');
  newRepoName.focus();
}

async function deleteRepo(repo) {
  if (runningRepoIds.has(repo.id)) {
    showBanner('This repo is running, stop it before deleting');
    return;
  }
  if (!confirm(`Delete repo "${repo.displayName}"? This cannot be undone.`)) return;
  const res = await window.packagerAPI.deleteRepo(repo.id);
  if (!res.ok) {
    showBanner(res.error);
    return;
  }
  if (editingRepoId === repo.id) closeRepoForm();
  repos = res.repos;
  applyRepoOrder(loadRepoOrder());
  renderRepoList();
}

function closeRepoForm() {
  editingRepoId = null;
  addRepoFormTitle.textContent = 'Add Repo';
  repoFormSubmitBtn.textContent = 'Add';
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
    <button type="button" class="link-btn repo-edit-btn" title="Edit this repo">✎</button>
    <button type="button" class="link-btn repo-delete-btn" title="Delete this repo">🗑</button>
    <input type="text" class="repo-path-input" placeholder="Set local path…" />
    <button type="button" class="link-btn repo-path-save">Save</button>
  `;
  row.querySelector('.repo-edit-btn').addEventListener('click', () => openEditForm(repo));
  row.querySelector('.repo-delete-btn').addEventListener('click', () => deleteRepo(repo));
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
  addRepoFormTitle.textContent = 'Add Repo';
  repoFormSubmitBtn.textContent = 'Add';
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
  envSelect.innerHTML = '<option>Loading…</option>';
  hideBanner();

  const res = await window.packagerAPI.listEnvironments();
  const profiles = res.ok ? res.profiles : [];
  if (!res.ok) showBanner(`Failed to read Maven settings.xml: ${res.error} (local install still works)`);

  // Local install doesn't need settings.xml, so there's always an option even if reading it failed
  const options = ['<option value="">Local install (no profile needed)</option>']
    .concat(profiles.map((p) => `<option value="${p}">${p}</option>`));
  envSelect.innerHTML = options.join('');

  const savedProfile = loadPrefs().profile;
  envSelect.value = profiles.includes(savedProfile) ? savedProfile : ''; // fall back to local install if nothing saved or the option is gone
  envSelect.disabled = false;
  updateRunButtonState();
}

refreshEnvBtn.addEventListener('click', loadEnvironments);
envSelect.addEventListener('change', savePrefs);

// ---------- Java 版本 ----------
// 掃常見安裝路徑挑 JDK；"System default" 走現有的即時查登錄檔邏輯，不覆蓋 JAVA_HOME
let systemDefaultJavaHome = '';

async function loadJavaHomes() {
  javaSelect.disabled = true;
  javaSelect.innerHTML = '<option>Loading…</option>';

  const res = await window.packagerAPI.listJavaHomes();
  const homes = res.ok ? res.homes : [];
  if (!res.ok) showBanner(res.error);

  systemDefaultJavaHome = (res.ok && res.current) || '';
  const defaultTitle = systemDefaultJavaHome || 'JAVA_HOME not detected';
  const options = [`<option value="" title="${defaultTitle}">System default</option>`].concat(
    homes.map((h) => `<option value="${h.path}" title="${h.path}">${h.version}</option>`)
  );
  javaSelect.innerHTML = options.join('');

  const savedJavaHome = loadPrefs().javaHome;
  javaSelect.value = homes.some((h) => h.path === savedJavaHome) ? savedJavaHome : '';
  javaSelect.disabled = false;
}

refreshJavaBtn.addEventListener('click', loadJavaHomes);
javaSelect.addEventListener('change', savePrefs);

copyJavaPathBtn.addEventListener('click', async () => {
  const path = javaSelect.value || systemDefaultJavaHome;
  if (!path) return showBanner('No JAVA_HOME path to copy');
  await navigator.clipboard.writeText(path);
  showBanner(`Copied: ${path}`, 'info');
});

function updateRunButtonState() {
  const hasRepo = getSelectedRepoIds().length > 0;
  runBtn.disabled = !(hasRepo && !envSelect.disabled);
  updateBranchField();
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
    <button type="button" class="tab-action tab-start" title="Start / restart">▶</button>
    <button type="button" class="tab-action tab-stop" title="Stop this repo">■</button>
    <button type="button" class="tab-action tab-close" title="Close this tab">✕</button>
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
  tab.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(repoId);
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

  syncTabButtons(repoId);
  if (runningRepoIds.has(repoId)) setStatus(repoId, 'running');
  if (!activeTabId) activateTab(repoId);
}

function syncTabButtons(repoId) {
  const tab = document.getElementById(`tab-${repoId}`);
  if (!tab) return;
  const running = runningRepoIds.has(repoId);
  const busy = running || pullingRepoIds.has(repoId);
  tab.querySelector('.tab-start').disabled = busy;
  tab.querySelector('.tab-stop').disabled = !running;
  // 跑的時候不給關，不然 log/done 事件晚點到會把分頁重新生出來
  tab.querySelector('.tab-close').disabled = busy;
}

// 關掉分頁：跑中或 pull 中的不能關（syncTabButtons 已擋掉點擊），關掉後如果原本是 active tab 就切去旁邊那個
function closeTab(repoId) {
  if (runningRepoIds.has(repoId) || pullingRepoIds.has(repoId)) return;
  document.getElementById(`tab-${repoId}`)?.remove();
  document.getElementById(`panel-${repoId}`)?.remove();
  if (activeTabId === repoId) {
    activeTabId = null;
    const next = tabBarEl.firstElementChild;
    if (next) activateTab(next.dataset.repoId);
  }
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
  // 使用者往上捲在看前面的 log 時不要硬拉回底部，原本就在底部才跟著捲
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
  body.appendChild(div);
  if (atBottom) body.scrollTop = body.scrollHeight;
}

// ---------- 執行打包 ----------
// 共用邏輯：分頁上的 ▶ 跟側邊欄的「開始打包」都走這裡，
// 讓已經在跑的 repo 可以跳過，也讓單一 repo 可以獨立重新開始
// 一批打包（從閒置到全部跑完）的結果，全部結束時彙整成一則通知
const batchResults = new Map();

async function startRepos(repoIds) {
  const pulling = repoIds.filter((id) => pullingRepoIds.has(id));
  const toStart = repoIds.filter((id) => !runningRepoIds.has(id) && !pullingRepoIds.has(id));
  const profileId = envSelect.value || null;
  const installType = document.querySelector('input[name="installType"]:checked').value;
  if (pulling.length) showBanner(`Skipped while git pull is running: ${pulling.map(repoName).join(', ')}`);
  if (toStart.length === 0) return;

  if (!pulling.length) hideBanner();
  if (runningRepoIds.size === 0) batchResults.clear();
  stopBtn.classList.remove('hidden');

  toStart.forEach((id) => {
    runningRepoIds.add(id);
    setStatus(id, 'running');
    syncTabButtons(id);
  });
  syncBranchButtons();

  await window.packagerAPI.runPackage(toStart, profileId, installType, {
    skipTests: skipTestsChk.checked,
    extraArgs: extraArgsInput.value,
    javaHome: javaSelect.value || null,
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
  batchResults.set(repoId, success);
  setStatus(repoId, success ? 'success' : 'fail');
  syncTabButtons(repoId);
  syncBranchButtons();
  if (error) appendLog(repoId, `[Error] ${error}`, true);
  if (runningRepoIds.size === 0) showBatchSummary();
});

function repoName(id) {
  return repos.find((r) => r.id === id)?.displayName || id;
}

// 打包常要好幾分鐘，使用者多半切去做別的事；全部跑完時給總結，視窗不在前景就另外跳系統通知
function showBatchSummary() {
  const failed = [...batchResults].filter(([, ok]) => !ok).map(([id]) => repoName(id));
  const okCount = batchResults.size - failed.length;
  const msg = failed.length
    ? `Packaging finished: ${okCount} succeeded, ${failed.length} failed or stopped (${failed.join(', ')})`
    : `Packaging finished: ${okCount} succeeded`;
  showBanner(msg, failed.length ? 'error' : 'info');
  if (!document.hasFocus()) new Notification('Maven Packager', { body: msg });
}

// pull 進度借用同一套 log tab 顯示；不改狀態燈，燈號只代表打包結果，避免 pull 成功被看成打包成功
window.packagerAPI.onPullStart(({ repoId }) => {
  ensureTab(repoId, 'git pull --ff-only');
  activateTab(repoId);
  syncTabButtons(repoId);
});
window.packagerAPI.onPullLog(({ repoId, line }) => {
  ensureTab(repoId);
  appendLog(repoId, line, false);
});
window.packagerAPI.onPullDone(({ repoId, success, error }) => {
  appendLog(repoId, success ? '[git pull done]' : `[git pull failed] ${error || ''}`, !success);
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
loadJavaHomes();
loadGithubRoot();
