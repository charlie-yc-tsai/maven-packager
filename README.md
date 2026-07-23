# Maven Packager

跨 repo 一鍵打包工具。選擇 repo + 環境（Maven profile），一鍵執行 `mvn clean install -P{profile}`，
即時看每個 repo 的 build log 與成功/失敗狀態。

## 設計重點

- **環境清單完全動態讀取** `~/.m2/settings.xml` 裡的 `<profiles><profile><id>`，工具本身不寫死任何環境資訊。
  新增/修改 profile 後按右上角 ⟳ 重新整理即可看到最新清單，不用改工具、不用重開。
- **帳密不經手工具**：host/port/user/password 全部由 Maven 從 settings.xml 讀取並套用（`-P{profile}`），
  Electron 端完全不接觸密碼，GUI 與 log 都不會有外洩風險。
- **repo 清單**在 `repos.json`，目前無跨 repo 依賴順序，全部平行執行；之後若有依賴關係，
  可以在此檔案加 `dependsOn` 欄位並在 `main.js` 補拓撲排序邏輯。

## 安裝

```bash
npm install
```

## 設定 repo 路徑

打開 `repos.json`，把每個 repo 的 `localPath` 改成你電腦上實際的路徑（目前是佔位路徑 `C:\workspace\...`）。
`workingModule` 若某 repo 需要 `-pl` 指定子模組再填，不需要就留 `null`。

## 執行

```bash
npm start
```

## 使用方式

1. 左側勾選要打包的 repo（可多選，或按「全選」）。
2. 上方選擇環境（即 settings.xml 的 profile id，例如 `testing`）。
3. 按「開始打包」，右側會依 repo 各開一個 log tab，即時顯示 `mvn` 輸出。
4. 左側狀態燈號：灰＝待執行、黃（閃爍）＝執行中、綠＝成功、紅＝失敗。

## 已知限制 / 後續可擴充

- 目前假設所有 repo 都有標準的 Maven profile 可以直接 `-P{profile}` 完成上傳安裝（依你們現況確認過）。
  若之後有 repo 沒有這個機制，需要另外走 AEM Package Manager API 上傳，可以在 `main.js` 的
  `runMavenProcess` 旁邊加一個 `manual-package` 分支。
- 目前沒有取消整批執行的按鈕，只有 `cancel-package` 這個 IPC handler 可用（可在 UI 上補一顆「取消」按鈕接上去）。
- Windows 上 `spawn('mvn', ...)` 用 `shell: true` 以正確解析 `mvn.cmd`；若之後要打包成單一 exe 發佈，
  注意 `mvn` 仍須存在於執行環境的 PATH 中。
