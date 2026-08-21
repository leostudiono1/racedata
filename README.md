# JRA 中央競馬與 netkeiba 補充資料封存

這是一個不含前端的 JRA 賽事資料擷取與封存專案。GitHub Actions 會以低頻率讀取 JRA 公開頁面，保存原始 response body（gzip）及版本化 JSON，供個人、非商業研究與模型訓練使用。

JRA 是賽事事實的權威來源；netkeiba 只用於補充 race／horse ID 對照、馬匹主檔、五代血統及中央以外的公開出賽履歷。兩者資料分開保存，不以 netkeiba 覆蓋 JRA 官方結果。

## 保存範圍

- 歷史回補：執行當年與前 11 年的完整結果頁。
- 持續更新：出馬表、最終賠率、完整結果、特別登錄、開催公告及馬場資訊。
- 不下載圖片、影片或其他媒體檔案。
- typed 欄位之外，`document`／`pageDocuments` 會保留主內容區的標題、文字、清單、表格及連結；parser 改版時可由 raw HTML 重新產生 JSON。

## 本機使用

需求：Node.js 24 以上。

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run data:verify
```

資料指令：

```bash
npm run data:update
npm run data:bootstrap -- --year 2026
npm run data:reparse -- --year 2026
npm run data:verify -- --year 2026

# netkeiba：預設只處理 JRA 最近 35 天的已完賽賽事，每次最多 80 頁
npm run data:netkeiba:update
npm run data:netkeiba:update -- --year 2026 --max-pages 80
npm run data:netkeiba:reparse -- --year 2026
npm run data:netkeiba:verify -- --year 2026
```

可用 `--root DIRECTORY` 將資料寫入其他目錄。HTTP 行為可透過 `JRA_REQUEST_DELAY_MS`、`JRA_REQUEST_RETRIES` 與 `JRA_USER_AGENT` 調整；請勿將延遲設得過低。`npm run data:smoke` 必須明確設定 `JRA_LIVE_SMOKE=1`，且不會在一般 CI 執行。

## 資料配置

```text
data/
  archive/YYYY/MM/DD/{meetingId}/
    meeting.json
    races/NN/
      race.json
      manifest.json
      raw/{pageType}.html.gz
  index/YYYY.json
  failures/YYYY-MM-DD/{actionHash}/
```

`manifest.json` 記錄來源 action、HTTP metadata、charset、擷取時間、原始 byte 長度、SHA-256、raw 路徑及解析結果。相同內容不會重寫；gzip 輸出固定且可重現。

netkeiba 補充資料配置：

```text
data/netkeiba/
  races/YYYY/{netkeibaRaceId}/
    race.json
    manifest.json
    raw/race-result.html.gz
  horses/{idPrefix}/{horseId}/
    horse.json
    manifest.json
    raw/{horse-profile,horse-pedigree,horse-career}.html.gz
  index/races/YYYY.json
  index/horses.json
```

netkeiba HTTP client 僅允許 `db.netkeiba.com` 的公開 race result、horse profile、pedigree 與 career 路徑，不登入、不讀取 Premium 專頁、不抓圖片／影音／新聞／預測／調教評論／留言，也不保存賠率時間序列。預設單執行緒、每次請求至少間隔 3.5 秒；`403`、`429` 或頁面型存取限制會立即停止。可用 `NETKEIBA_REQUEST_DELAY_MS`、`NETKEIBA_REQUEST_RETRIES`、`NETKEIBA_MAX_PAGES` 與 `NETKEIBA_USER_AGENT` 調整，但不應降低節流或嘗試繞過限制。

## GitHub Actions

`Update JRA race archive` 支援：

- `update`：增量更新本週與最近 35 天。
- `bootstrap`：回補指定年度。
- `bootstrap-all`：以最多兩個年度並行回補最近 12 年。
- `reparse`：不連線 JRA，使用既有 raw 檔重建指定年度 JSON。

排程沿用東京時區的週四／週五預抓與週六、週日、週一賽事時段。單頁解析失敗時 raw 和錯誤資訊仍會先由 Action bot 提交，之後 workflow 以失敗狀態告警。

`Update netkeiba enrichment archive` 每天東京時間 22:17 執行一次，預設最多取得 80 個公開頁面。手動執行可指定 JRA 來源年度逐批補齊；刻意不提供 12 年全量高併發回補。

## 使用限制

本專案不代表 JRA，也不提供投注建議。使用者應自行確認 JRA 使用條款、著作權與資料再利用限制。資料量會持續增加；repository 接近 GitHub 容量限制時，應將 raw 檔遷移到物件儲存，不應刪除或降低請求節流來規避問題。

netkeiba 明確表示大量存取可能在未預告下受到通信限制，且其條款限制資料複製、公開與商業利用。本 repository 必須維持 private，僅限個人、非商業研究；若要共享、公開、商業使用或進行十二年全量回補，應先取得書面授權。私有 repository 只降低公開散布風險，並不取代服務條款或授權。
