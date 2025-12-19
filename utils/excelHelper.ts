
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { ProcessedData, Stage1Status, Stage1Row } from '../types';
import { getTemplate, TEMPLATE_IDS, TemplateRecord, TemplateMapping } from './db';
import { recalculateStage1Points } from './processor';

// Helper for reading input files
export const readExcelFile = (file: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data || !(data instanceof ArrayBuffer)) throw new Error("File read failed");
        const workbook = XLSX.read(data, { type: 'array', cellFormula: false, cellHTML: false });
        if (!workbook.SheetNames.length) throw new Error("Excel file is empty");
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(sheet));
      } catch (err: any) {
        if (err.message && (err.message.includes("Record") || err.message.includes("0x"))) {
            reject("無法讀取此舊版 Excel (.xls) 格式。請將檔案另存為 .xlsx 格式後再試一次。");
        } else {
            reject(`讀取失敗: ${err.message || "未知錯誤"}`);
        }
      }
    };
    reader.onerror = () => reject("檔案讀取錯誤");
    reader.readAsArrayBuffer(file);
  });
};

const safeVal = (val: any) => (val === undefined || val === null) ? "" : val;
const sanitizeSheetName = (name: string): string => name.replace(/[\[\]\:\*\?\/\\\\]/g, '_').substring(0, 31) || "Unknown";

// --- EXPORT LOGIC WITH EXCELJS ---

export const exportToExcel = async (processedData: ProcessedData, defaultFilename: string, selectedPersons: Set<string>) => {
  // 1. Load All Templates
  const salesTmpl = await getTemplate(TEMPLATE_IDS.SALES);
  const pharmTmpl = await getTemplate(TEMPLATE_IDS.PHARMACIST);
  const repTmpl = await getTemplate(TEMPLATE_IDS.REPURCHASE);

  // Pre-load Template Workbooks to access their sheets later
  const loadTmplWB = async (tmpl: TemplateRecord | undefined) => {
      if (!tmpl || !tmpl.data) return null;
      try {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(tmpl.data);
          return wb;
      } catch (e) { console.error("Tmpl load fail", e); return null; }
  };

  const salesWB = await loadTmplWB(salesTmpl);
  const pharmWB = await loadTmplWB(pharmTmpl);
  const repWB = await loadTmplWB(repTmpl);

  const outWorkbook = new ExcelJS.Workbook();

  // Sort Logic: SALES (1) -> PHARMACIST (2) -> OTHERS (3), then by Name
  const sortedPersons = Object.keys(processedData).sort((a, b) => {
    const roleA = processedData[a].role;
    const roleB = processedData[b].role;
    const pA = roleA === 'SALES' ? 1 : (roleA === 'PHARMACIST' ? 2 : 3);
    const pB = roleB === 'SALES' ? 1 : (roleB === 'PHARMACIST' ? 2 : 3);
    
    if (pA !== pB) return pA - pB;
    return a.localeCompare(b, 'zh-TW');
  });

  // --- 1. STAFF SHEETS ---
  for (const person of sortedPersons) {
    if (!selectedPersons.has(person)) continue;
    const data = processedData[person];
    if (data.role === 'NO_BONUS') continue;

    const sheetName = sanitizeSheetName(person);
    
    // Determine which template to use
    let tmplRecord: TemplateRecord | undefined;
    let tmplSourceSheet: ExcelJS.Worksheet | undefined;

    if (data.role === 'PHARMACIST') {
        tmplRecord = pharmTmpl;
        tmplSourceSheet = pharmWB?.worksheets[0];
    } else {
        tmplRecord = salesTmpl;
        tmplSourceSheet = salesWB?.worksheets[0];
    }

    let sheet: ExcelJS.Worksheet;

    if (tmplSourceSheet) {
        // Create sheet and attempt to copy styles
        sheet = outWorkbook.addWorksheet(sheetName);
        copySheetModel(tmplSourceSheet, sheet);
    } else {
        // No Template: Create basic sheet
        sheet = outWorkbook.addWorksheet(sheetName);
        sheet.columns = [
            { width: 18 }, { width: 12 }, { width: 15 }, { width: 15 }, { width: 30 }, { width: 10 }, { width: 12 }, { width: 25 }, { width: 15 }
        ];
    }

    // --- WRITE DATA (Logic branching for Template vs No Template) ---
    const config = tmplRecord?.config;

    if (config) {
        // TEMPLATE MODE
        let currentRow = config.startRow || 2;
        
        const put = (col: string | undefined, val: any) => {
            if (!col) return;
            const cell = sheet.getCell(`${col}${currentRow}`);
            cell.value = val;
            
            // Re-apply style from template row if exists (helps if adding many rows)
            if (tmplSourceSheet) {
               const tmplRowIdx = config.startRow || 2;
               const templateCell = tmplSourceSheet.getCell(`${col}${tmplRowIdx}`);
               if (templateCell) {
                   applyCellStyle(cell, templateCell);
               }
            }
        };

        // 1. Stage 1 Data
        data.stage1.forEach(row => {
            if (row.status === Stage1Status.DELETE) return;
            
            const note = data.role === 'PHARMACIST' ? (row.category === '調劑點數' ? '' : row.status) : row.status;
            const pts = (data.role !== 'PHARMACIST' && row.category === '現金-小兒銷售') ? '' : row.calculatedPoints;

            put(config.category, safeVal(row.category));
            put(config.date, safeVal(row.date));
            put(config.customerID, safeVal(row.customerID));
            put(config.itemID, safeVal(row.itemID));
            put(config.itemName, safeVal(row.itemName));
            put(config.quantity, safeVal(row.quantity));
            put(config.amount, safeVal(row.amount)); 
            put(config.note, safeVal(note));
            put(config.points, safeVal(pts));
            
            currentRow++;
        });

        // Append Stage 2 below
        currentRow += 2;
        const addSimpleRow = (vals: any[]) => {
             const r = sheet.getRow(currentRow++);
             r.values = vals;
             r.commit();
        };

        if (data.stage2.length > 0) {
             addSimpleRow(["--- 第二階段：獎勵/調劑 ---"]);
             data.stage2.forEach(r => {
                 if (r.isDeleted) return;
                 let reward = r.format === '禮券' ? `${r.quantity}張` : `${r.customReward ?? (r.quantity * r.reward)}元`;
                 addSimpleRow([r.category, r.displayDate, r.customerID, r.itemID, r.itemName, r.quantity, reward]);
             });
             
             if (data.role === 'PHARMACIST') {
                const dispensingQty = data.stage2.find(r => r.itemID === '001727')?.quantity || 0;
                const bonus = Math.max(0, (dispensingQty - 300) * 10);
                addSimpleRow(["", "自費調劑獎金", "", `${bonus}元`]);
             }
        }
    } else {
        // NO TEMPLATE MODE (Default Layout)
        let startRow = 1;
        const addRow = (values: any[], isHeader = false, isSectionTitle = false) => {
            const row = sheet.getRow(startRow++);
            row.values = values;
            if (isSectionTitle) {
                row.font = { bold: true, size: 12, color: { argb: 'FF000000' } };
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }; 
            } else if (isHeader) {
                row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
                row.alignment = { horizontal: 'center' };
            }
            row.commit();
        };

        const s1Total = data.stage1.reduce((sum, row) => {
            if (row.status === Stage1Status.DEVELOP || row.status === Stage1Status.HALF_YEAR || row.status === Stage1Status.REPURCHASE) {
                return sum + row.calculatedPoints;
            }
            return sum;
        }, 0);

        addRow([`【第一階段：點數表】 總計：${s1Total} 點`], false, true);
        
        const header = data.role === 'PHARMACIST' 
             ? ["分類", "日期", "客戶編號", "品項編號", "品名", "數量", "金額", "備註", "點數"]
             : ["分類", "日期", "客戶編號", "品項編號", "品名", "數量", "金額", "備註", "計算點數"];
        addRow(header, true);

        data.stage1.forEach(row => {
            if (row.status === Stage1Status.DELETE) return;
            const note = data.role === 'PHARMACIST' ? (row.category === '調劑點數' ? '' : row.status) : row.status;
            const pts = (data.role !== 'PHARMACIST' && row.category === '現金-小兒銷售') ? '' : row.calculatedPoints;
            addRow([
                safeVal(row.category), safeVal(row.date), safeVal(row.customerID),
                safeVal(row.itemID), safeVal(row.itemName), safeVal(row.quantity),
                safeVal(row.amount), safeVal(note), safeVal(pts)
            ]);
        });
        
        startRow++; 

        // STAGE 2 & 3 (Same legacy logic...)
        if (data.role === 'PHARMACIST') {
            addRow([`【第二階段：當月調劑件數】`], false, true);
            addRow(["品項編號", "品名", "數量"], true);
            data.stage2.forEach(row => {
                const label = row.itemID === '001727' ? '件' : '組';
                addRow([safeVal(row.itemID), safeVal(row.itemName), `${safeVal(row.quantity)}${label}`]);
            });
            const dispensingQty = data.stage2.find(r => r.itemID === '001727')?.quantity || 0;
            const bonus = Math.max(0, (dispensingQty - 300) * 10);
            addRow(["自費調劑獎金", "", `${bonus}元`]);

        } else {
            const s2Totals = data.stage2.reduce((acc, row) => {
                if (row.isDeleted) return acc;
                if (row.format === '禮券') acc.vouchers += row.quantity;
                else {
                    const amount = row.customReward !== undefined ? row.customReward : (row.quantity * row.reward);
                    acc.cash += amount;
                }
                return acc;
            }, { cash: 0, vouchers: 0 });

            addRow([`【第二階段：現金獎勵表】 現金$${s2Totals.cash.toLocaleString()} 禮券${s2Totals.vouchers}張`], false, true);
            addRow(["類別", "日期", "客戶編號", "品項編號", "品名", "數量", "備註", "獎勵"], true);
            data.stage2.forEach(row => {
                if (row.isDeleted) return;
                let rewardDisplay = "";
                if (row.format === '禮券') rewardDisplay = `${row.quantity}張${safeVal(row.rewardLabel)}`;
                else {
                    const amount = row.customReward !== undefined ? row.customReward : (row.quantity * row.reward);
                    rewardDisplay = `${amount}元`;
                }
                addRow([
                    safeVal(row.category), safeVal(row.displayDate), safeVal(row.customerID),
                    safeVal(row.itemID), safeVal(row.itemName), safeVal(row.quantity),
                    safeVal(row.note), safeVal(rewardDisplay)
                ]);
            });

            startRow++;
            addRow(["【第三階段：美妝金額】"], false, true);
            addRow(["品牌分類", "金額"], true);
            data.stage3.rows.forEach(row => addRow([safeVal(row.categoryName), safeVal(row.subTotal)]));
            const totalRow = sheet.getRow(startRow++);
            totalRow.values = ["總金額", safeVal(data.stage3.total)];
            totalRow.font = { bold: true };
        }
    }
  }

  // --- 2. REPURCHASE SHEET (GLOBAL) ---
  const repurchaseMap: Record<string, { role: string, rows: Stage1Row[], totalPoints: number }> = {};
  for (const person of sortedPersons) {
     if (!selectedPersons.has(person)) continue;
     const data = processedData[person];
     data.stage1.forEach(row => {
         if (row.status === Stage1Status.REPURCHASE) {
             if (!repurchaseMap[person]) repurchaseMap[person] = { role: data.role as string, rows: [], totalPoints: 0 };
             repurchaseMap[person].rows.push(row);
             repurchaseMap[person].totalPoints += row.calculatedPoints;
         }
     });
  }

  if (Object.keys(repurchaseMap).length > 0) {
      const repSheetName = "回購總表";
      let repSheet: ExcelJS.Worksheet;
      const repSourceSheet = repWB?.worksheets[0];
      const repConfig = repTmpl?.config;

      if (repSourceSheet) {
          repSheet = outWorkbook.addWorksheet(repSheetName);
          copySheetModel(repSourceSheet, repSheet);
      } else {
          repSheet = outWorkbook.addWorksheet(repSheetName);
          repSheet.columns = [
            { width: 25 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 25 }, { width: 8 }, { width: 10 }, { width: 15 }, { width: 10 }
          ];
      }

      // WRITE REPURCHASE DATA
      if (repConfig) {
          // Template Mode
          let currentRow = repConfig.startRow || 2;
          
          Object.keys(repurchaseMap).sort().forEach(person => {
              const group = repurchaseMap[person];
              // Optional: Add Header Row for Person if needed, but template usually just wants raw rows. 
              // If user wants groupings, they have to check manually or we assume raw list.
              // For simplicity, we just list all rows. 
              
              group.rows.forEach(row => {
                 const fullPoints = recalculateStage1Points({ ...row, status: Stage1Status.DEVELOP }, group.role as any);
                 const devPoints = fullPoints - row.calculatedPoints;
                 const showDev = row.originalDeveloper && row.originalDeveloper !== '無';
                 
                 const put = (col: string | undefined, val: any) => {
                    if (!col) return;
                    const cell = repSheet.getCell(`${col}${currentRow}`);
                    cell.value = val;
                    if (repSourceSheet) {
                        const templateCell = repSourceSheet.getCell(`${col}${repConfig.startRow || 2}`);
                        if (templateCell) applyCellStyle(cell, templateCell);
                    }
                 };

                 // Map Person Name somewhere? Usually Category Col A in non-template mode. 
                 // If template mode, maybe we put Person Name in 'Category' or Note? 
                 // Let's assume standard mapping:
                 put(repConfig.category, person); // Reuse Category Col for Sales Person Name
                 put(repConfig.date, safeVal(row.date));
                 put(repConfig.customerID, safeVal(row.customerID));
                 put(repConfig.itemID, safeVal(row.itemID));
                 put(repConfig.itemName, safeVal(row.itemName));
                 put(repConfig.quantity, safeVal(row.quantity));
                 put(repConfig.repurchasePoints, safeVal(row.calculatedPoints));
                 put(repConfig.originalDeveloper, showDev ? safeVal(row.originalDeveloper) : '');
                 put(repConfig.devPoints, showDev ? safeVal(devPoints) : '');
                 
                 currentRow++;
              });
              // Add spacer row?
              currentRow++;
          });
      } else {
          // Default Mode
          let rRow = 1;
          const addRepRow = (values: any[], style: 'header' | 'title' | 'data') => {
              const row = repSheet.getRow(rRow++);
              row.values = values;
              if (style === 'title') {
                  row.font = { bold: true, size: 12 };
                  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBAF' } };
              } else if (style === 'header') {
                  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA580C' } };
              }
          };

          Object.keys(repurchaseMap).sort().forEach(person => {
              const group = repurchaseMap[person];
              addRepRow([`${person}    回購總點數：${group.totalPoints}`], 'title');
              addRepRow(["分類", "日期", "客戶編號", "品項編號", "品名", "數量", "回購點數", "原開發者", "開發點數"], 'header');
              
              group.rows.forEach(row => {
                  const fullPoints = recalculateStage1Points({ ...row, status: Stage1Status.DEVELOP }, group.role as any);
                  const devPoints = fullPoints - row.calculatedPoints;
                  const showDev = row.originalDeveloper && row.originalDeveloper !== '無';
                  
                  addRepRow([
                      safeVal(row.category), safeVal(row.date), safeVal(row.customerID),
                      safeVal(row.itemID), safeVal(row.itemName), safeVal(row.quantity),
                      safeVal(row.calculatedPoints),
                      showDev ? safeVal(row.originalDeveloper) : '',
                      showDev ? safeVal(devPoints) : ''
                  ], 'data');
              });
              rRow++;
          });
      }
  }

  const buffer = await outWorkbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = defaultFilename.trim().replace(/\.xlsx$/i, '') + '.xlsx';
  anchor.click();
  window.URL.revokeObjectURL(url);
};

// Helper: Copy Sheet Structure (Columns, Merges, Styles)
function copySheetModel(source: ExcelJS.Worksheet, target: ExcelJS.Worksheet) {
    if (source.columns) {
        target.columns = source.columns.map(col => ({ 
            header: col.header, key: col.key, width: col.width, style: col.style 
        }));
    }
    
    // Copy Page Setup
    target.pageSetup = { ...source.pageSetup };
    
    // Copy Header Rows (approx first 10 rows just in case)
    source.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        if (rowNumber > 20) return; // Limit header copy range
        const newRow = target.getRow(rowNumber);
        newRow.height = row.height;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
             const newCell = newRow.getCell(colNumber);
             newCell.value = cell.value;
             applyCellStyle(newCell, cell);
        });
    });

    // Copy Merges (Crude attempt, might fail if ranges overlap in weird ways but usually fine for templates)
    const merges = (source as any)._merges;
    if (merges) {
        Object.keys(merges).forEach(merge => {
            try { target.mergeCells(merge); } catch (e) {}
        });
    }
}

function applyCellStyle(target: ExcelJS.Cell, source: ExcelJS.Cell) {
   target.style = { ...source.style };
   if (source.border) target.border = JSON.parse(JSON.stringify(source.border));
   if (source.font) target.font = JSON.parse(JSON.stringify(source.font));
   if (source.alignment) target.alignment = JSON.parse(JSON.stringify(source.alignment));
   if (source.fill) target.fill = JSON.parse(JSON.stringify(source.fill));
   if (source.numFmt) target.numFmt = source.numFmt;
}
