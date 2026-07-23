# Maven Packager

跨 repo 一鍵打包工具（Electron app）。勾選 repo、選環境、選安裝方式，一鍵平行執行
`mvn clean install`，每個 repo 各自一個 log 分頁即時看輸出，可單獨/整批停止、重新開始。

## 安裝與執行

```bash
npm install
npm start
```

Windows 上若透過公司代理上網，`npm install` 需要先讓 electron 的二進位下載走代理：

```bash
set ELECTRON_GET_USE_PROXY=true
npm install
```

## 設定檔（重要：分兩份）

- **`repos.json`**：可分享、進版控的部署設定。每個 repo 記 `id`、`displayName`，以及
  `installTargets.bundle` / `installTargets.package` 各自的 `workingModule`（要 `-pl` 的子模組，不需要留 `null`）
  跟 `profile`（該專案 pom.xml 自己定義的 deploy profile，如 `autoInstallBundle`、`autoInstallPackage`、
  `autoInstallSinglePackage`）。**不含任何本機路徑**，可以直接分享/上傳給同仁用。
- **`repos.local.json`**：只存這台電腦每個 repo 的本機 checkout 路徑（`{ "repoId": "C:\\path\\to\\repo" }`）。
  不進版控（`.gitignore` 已排除），每個人各自維護自己的路徑。
- **`settings.local.json`**：本機個人化設定，目前只存 GitHub 根目錄（見下方「自動偵測路徑」）。同樣不進版控。

App 啟動時會自動合併 `repos.json` + `repos.local.json`；缺路徑的 repo 會在側邊欄顯示成一個可以直接填路徑的欄位。

### 補路徑的三種方式

1. 側邊欄看到「未設路徑」的 repo，直接輸入路徑按存。
2. 側邊欄最上方設定「GitHub 根目錄」，按「自動偵測 repo 路徑」——會對每個還沒設路徑的 repo 猜
   `<根目錄>\<repo id>`，資料夾存在就自動填（Windows 路徑不分大小寫，`g6` 猜得到 `G6`）。
3. 點 repo 名稱旁的 ✎ 開編輯表單，手動填。

### 新增 / 編輯 repo

側邊欄「+ 新增」開表單，填顯示名稱、本機路徑，以及 Bundle / Package 各自的 workingModule + profile
（哪個 repo 需要看它自己的 `pom.xml` 有哪些 `autoInstall*` profile，定義在哪個模組）。
既有 repo 可點 ✎ 用同一個表單編輯（id 不可改）。

## 使用方式

1. 左側勾選要打包的 repo（可多選、可拖曳排序、可按「全選」）。
2. 上方選「環境」（`~/.m2/settings.xml` 裡的 profile id，如 `testing`／`staging`；預設「本機安裝」不吃
   settings.xml，直接用 repo 自己 profile 裡設好的預設值）。`adobe-public` 是 repository/proxy 設定用的，
   不會出現在清單。
3. 選「安裝方式」：整個專案（`autoInstallPackage`/`autoInstallSinglePackage`）或只裝 Bundle
   （`autoInstallBundle`）。
4. 需要的話勾「跳過測試」（加 `-DskipTests`）、填「額外 Maven 參數」（如 `-T 1C` 全核心平行編譯，逐字接在
   指令最後）。
5. 按「▶ 開始打包」，右側依 repo 各開一個 log 分頁，即時顯示 `mvn` 輸出；`[ERROR]` 紅字、`[WARNING]` 黃字。
6. 每個分頁自己有 ▶（開始/重新開始，只影響這個 repo）跟 ■（停止這個 repo）；也可以在某些 repo 還在跑時
   額外勾選別的 repo 再按開始，不用等前面跑完。上方「■ 停止全部」一次停掉所有正在跑的。
7. 左側狀態燈號（分頁上也有）：灰＝待執行、黃（閃爍）＝執行中、綠＝成功、紅＝失敗。

環境、安裝方式、跳過測試、額外參數這些選擇會記在瀏覽器 `localStorage`，重開 app 不會消失。

## 打包成單一 exe 發佈

```bash
npm run dist
```

用 `electron-builder` 產出免安裝的 portable exe（`dist/Maven-Packager.exe`），複製給同仁雙擊就能跑。
Windows 需要開啟「開發人員模式」（設定 → 隱私權與安全性 → 開發人員專用）才能正常解壓縮打包工具用到的資源，
否則會因為建立symbolic link 沒權限而失敗。

## 設計重點

- **環境清單動態讀取** `~/.m2/settings.xml`，工具本身不寫死任何環境資訊，按 ⟳ 重新整理即可看到最新清單。
- **JAVA_HOME 即時查登錄檔**：每次執行都直接向 Windows 登錄檔（`HKCU\Environment` / `HKLM...\Environment`）
  問目前實際值，不會吃到 Electron 啟動當下就凍結、可能過期的 `process.env.JAVA_HOME`。
- **帳密不經手工具**：host/port/user/password 由 Maven 從 settings.xml 讀取套用，Electron 端不接觸密碼。
- **repo 之間目前無依賴順序**，全部平行執行；之後若有依賴關係，可以在 `repos.json` 加 `dependsOn` 欄位，
  在 `main.js` 補拓撲排序邏輯。
- Windows 上 `spawn('mvn', ...)` 用 `shell: true` 解析 `mvn.cmd`；停止行程用 `taskkill /T /F` 才能連
  `mvn.cmd` 底下的子行程一起砍掉。

## 已知限制

- 假設每個 repo 都有標準 Maven profile 可以 `-P{profile}` 完成安裝。若之後有 repo 沒有這個機制，需要另外
  走 AEM Package Manager API 上傳，可以在 `main.js` 的 `runMavenProcess` 旁邊加一個分支處理。
- 沒有「暫停/繼續」，`■ 停止` 是直接 kill 整個行程樹。
- 重新執行一個「已完成」的 repo 會沿用同一個 log 分頁（清空舊 log），但如果是在它還在跑的時候點重新開始，
  按鈕會被停用擋掉，不會出現兩個行程搶同一個 repo 的狀況。
