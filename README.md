
# 分店獎金計算系統 (Store Sales Processor)

這是一個協助總部對各家分店人員進行獎金計算的 PWA 應用程式。支援 Excel 匯入、資料篩選、歷史回購判定以及匯出報表功能。

## 功能特色

*   **Excel 資料處理**：支援匯入銷售報表、藥師點數設定、現金獎勵設定。
*   **自動化計算**：依據職位（門市/藥師）自動套用不同的點數與獎金規則。
*   **歷史資料庫**：內建 Local Database (IndexedDB)，可累積歷史銷售紀錄，自動判定回購狀態。
*   **回購驗證**：視覺化顯示回購紀錄（日期、數量、分店），輔助判斷。
*   **PWA 支援**：可安裝於桌面或手機，支援離線開啟（需先載入過一次）。

## 專案結構

*   `*.tsx` (root): 主要 React 程式碼與入口點
*   `components/`: UI 元件
*   `utils/`: 資料處理邏輯 (Excel 解析、計算規則、資料庫操作)
*   `public/`: 靜態資源 (Service Worker, Manifest)

## 本地開發 (Local Development)

1.  安裝相依套件：
    ```bash
    npm install
    ```

2.  啟動開發伺服器：
    ```bash
    npm run dev
    ```

## 部署至 Vercel

本專案已設定好 `vercel.json` 與 `vite.config.ts`，可直接部署。

1.  將專案上傳至 GitHub。
2.  登入 [Vercel](https://vercel.com/) 並選擇 "Add New Project"。
3.  匯入此 GitHub Repository。
4.  Framework Preset 選擇 **Vite**。
5.  點擊 **Deploy**。

## 系統需求

*   Node.js 18+
*   瀏覽器需支援 Modern Web API (IndexedDB, File API)
