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
npm run data:repair-jra-manifests -- --year 2026
npm run data:verify -- --year 2026

# netkeiba：預設只處理 JRA 最近 35 天的已完賽賽事，每次最多 80 頁
npm run data:netkeiba:update
npm run data:netkeiba:update -- --year 2026 --max-pages 80
npm run data:netkeiba:reparse -- --year 2026
npm run data:netkeiba:verify -- --year 2026
npm run data:netkeiba:verify -- --require-complete-horses
```

一般 netkeiba 驗證會回報馬匹覆蓋統計，但只將 schema、manifest、索引及 raw hash 問題視為錯誤。加入 `--require-complete-horses` 後，賽事引用但沒有記錄，或缺少 profile、pedigree、career 任一頁的馬匹，也會讓指令失敗。

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

HTTP 失敗會輸出結構化診斷，包含 entity ID、page type、request/final URL、HTTP status、命中的限制訊號、頁面標題、body SHA-256 與 byte length。`404`／`410` 會分類為單頁不存在，不會誤觸全域冷卻；timeout、網路／redirect 與 5xx 也會分開標示。

## GitHub Actions

`Complete JRA and netkeiba archive gaps` 每 6 小時檢查一次缺漏。若任一馬匹分片收到 403、429 或限制頁面，該次執行會保存已完成資料並建立冷卻標記，其餘分片停止送出請求；至少冷卻 6 小時後，再由下一個排程從仍缺漏的頁面續抓。完整度達標後，後續排程只執行驗證，不再請求 netkeiba。

`Update JRA race archive` 支援：

- `update`：增量更新本週與最近 35 天。
- `bootstrap`：回補指定年度。
- `bootstrap-all`：以最多兩個年度並行回補最近 12 年。
- `reparse`：不連線 JRA，使用既有 raw 檔重建指定年度 JSON。

JRA 排程全部使用 `Asia/Tokyo`：週四 16:00、週五 10:00 完整預抓；週六、週日、週一 09:00–18:45 每 15 分鐘（每小時 :00、:15、:30、:45）執行 `data:update -- --scope intraday`；每天 19:00 執行完整收尾更新，複查最近 35 天的結果修正。09:00–19:00 的涵蓋範圍依 [JRA 2026 年夏季官方發走時刻](https://www.jra.go.jp/news/202606/061501.html) 設定，包含最早 09:40 與最晚 18:30 的延長賽程。

日間模式每次重新探索官方選單，依已封存的當日 `startTime` 選取未來 30 分鐘內的出馬表；未發現紀錄或時間不明的場次會直接抓取。已過發走時間但尚未取得最終結果的場次仍更新出馬表，以處理延遲開賽。當日結果在發走後 70 分鐘內複查；缺少結果或任一最終賠率頁的場次即使超過此窗口也繼續補抓。未知是否提供的投注法留待每日收尾與後續更新確認，不視為已完整。沒有當日賽事時只探索選單，不重抓歷史賽事及馬場頁面。完整模式仍抓取所有已發現出馬表，作為發走時間異動與延後公布資料的兜底。

GitHub Actions 排程可能延遲或漏觸發，checkout 與排隊也需要時間，因此每 15 分鐘是喚醒頻率，不保證精準賽前 15 分鐘取得資料；同組工作不會中斷正在執行的更新。單頁解析失敗時 raw 和錯誤資訊仍會先由 Action bot 提交，之後 workflow 以失敗狀態告警。手動 `npm run data:update` 預設仍為完整模式。

`Update netkeiba enrichment archive` 每天東京時間 22:17 執行一次，預設最多取得 80 個公開頁面。手動執行可指定 JRA 來源年度逐批補齊；刻意不提供 12 年全量高併發回補。

`Complete JRA and netkeiba archive gaps` 用於離線對齊 JRA manifest ID，並以 8 個依序執行的 salted 分片補齊 netkeiba 缺少的馬匹記錄與三種馬匹頁面。每匹馬會依 profile、pedigree、career 順序完成後才處理下一匹；若遇存取限制，已成功資料仍會提交，未完成分片可在冷卻後重跑。

## 使用限制

本專案不代表 JRA，也不提供投注建議。使用者應自行確認 JRA 使用條款、著作權與資料再利用限制。資料量會持續增加；repository 接近 GitHub 容量限制時，應將 raw 檔遷移到物件儲存，不應刪除或降低請求節流來規避問題。

netkeiba 明確表示大量存取可能在未預告下受到通信限制，且其條款限制資料複製、公開與商業利用。本 repository 必須維持 private，僅限個人、非商業研究；若要共享、公開、商業使用或進行十二年全量回補，應先取得書面授權。私有 repository 只降低公開散布風險，並不取代服務條款或授權。
