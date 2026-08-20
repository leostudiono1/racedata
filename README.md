# JRA 中央競馬資料封存

這是一個不含前端的 JRA 賽事資料擷取與封存專案。GitHub Actions 會以低頻率讀取 JRA 公開頁面，保存原始 response body（gzip）及版本化 JSON，供個人、非商業研究與模型訓練使用。

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

## GitHub Actions

`Update JRA race archive` 支援：

- `update`：增量更新本週與最近 35 天。
- `bootstrap`：回補指定年度。
- `bootstrap-all`：以最多兩個年度並行回補最近 12 年。
- `reparse`：不連線 JRA，使用既有 raw 檔重建指定年度 JSON。

排程沿用東京時區的週四／週五預抓與週六、週日、週一賽事時段。單頁解析失敗時 raw 和錯誤資訊仍會先由 Action bot 提交，之後 workflow 以失敗狀態告警。

## 使用限制

本專案不代表 JRA，也不提供投注建議。使用者應自行確認 JRA 使用條款、著作權與資料再利用限制。資料量會持續增加；repository 接近 GitHub 容量限制時，應將 raw 檔遷移到物件儲存，不應刪除或降低請求節流來規避問題。
