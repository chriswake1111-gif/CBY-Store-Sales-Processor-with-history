import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
// @ts-ignore
import saveAs from 'file-saver';
import { ProcessedData, Stage1Status, Stage1Row, StaffRecord } from '../types';
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

// Helper to format Customer ID (strip leading '00')
const formatCID = (val: any) => {
  const str = String(safeVal(val));
  return str.startsWith('00') ? str.substring(2) : str;
};

// --- EXPORT LOGIC WITH EXCELJS ---

export const exportToExcel = async (
    processedData: ProcessedData, 
    defaultFilename: string, 
    selectedPersons: Set<string>,
    staffMasterList: StaffRecord[] = [],
    reportDate?: string
) => {
  // 1. Load All Templates
  const salesTmpl = await getTemplate(TEMPLATE_IDS.SALES);
  const pharmTmpl = await getTemplate(TEMPLATE_IDS.PHARMACIST);
  
  // Pre-load Template Workbooks
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
  
  const outWorkbook = new ExcelJS.Workbook();

  // Sort Logic: SALES (1) -> PHARMACIST (2) -> OTHERS (3), then by ID asc
  const sortedPersons = Object.keys(processedData).sort((a, b) => {
    const roleA = processedData[a].role;
    const roleB = processedData[b].role;
    const pA = roleA === 'SALES' ? 1 : (roleA === 'PHARMACIST' ? 2 : 3);
    const pB = roleB === 'SALES' ? 1 : (roleB === 'PHARMACIST' ? 2 : 3);
    
    if (pA !== pB) return pA - pB;

    const staffA = staffMasterList.find(s => s.name === a);
    const staffB = staffMasterList.find(s => s.name === b);
    const idA = staffA?.id || '999999';
    const idB = staffB?.id || '999999';

    if (idA !== idB) return idA.localeCompare(idB, undefined, { numeric: true });

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

    // Extract config early to determine header limit
    const config = tmplRecord?.config;
    let sheet: ExcelJS.Worksheet;

    if (tmplSourceSheet) {
        // Create sheet and attempt to copy styles
        sheet = outWorkbook.addWorksheet(sheetName);
        // Copy headers up to startRow (default 20 if not set)
        copySheetModel(tmplSourceSheet, sheet, config?.startRow || 20);
        
        // Write Report Date to A1 if available
        if (reportDate) {
            const cell = sheet.getCell('A1');
            cell.value = reportDate;
        }

    } else {
        // No Template: Create basic sheet
        sheet = outWorkbook.addWorksheet(sheetName);
        sheet.columns = [
            { width: 18 }, { width: 12 }, { width: 15 }, { width: 15 }, { width: 30 }, { width: 10 }, { width: 12 }, { width: 25 }, { width: 15 }
        ];
        if (reportDate) {
            sheet.mergeCells('A1:I1');
            sheet.getCell('A1').value = reportDate;
            sheet.getCell('A1').alignment = { horizontal: 'center' };
            sheet.getCell('A1').font = { bold: true, size: 14 };
        }
    }
    
    // GATHER DATA: COMBINE OWN DATA WITH INCOMING RETURNS
    const finalStage1 = data.stage1.filter(row => {
         if (row.status === Stage1Status.DELETE) return false;
         if (row.status === Stage1Status.RETURN && row.returnTarget) return false;
         
         // --- EXCLUSION LOGIC ---
         // Exclude Repurchase from individual sheet list as requested
         if (row.status === Stage1Status.REPURCHASE) return false;
         
         return true;
    });

    Object.keys(processedData).forEach(otherPerson => {
        if (otherPerson === person) return;
        processedData[otherPerson].stage1.forEach(row => {
            if (row.status === Stage1Status.RETURN && row.returnTarget === person) {
                finalStage1.push(row);
            }
        });
    });


    // --- WRITE DATA ---
    if (config) {
        // TEMPLATE MODE
        
        const staffInfo = staffMasterList.find(s => s.name === person);

        const writeToCell = (addr: string | undefined, val: any) => {
            if (addr && /^[A-Z]+[0-9]+$/.test(addr)) {
                 try { 
                     const cell = sheet.getCell(addr);
                     cell.value = val;
                     if (tmplSourceSheet) {
                         const tmplCell = tmplSourceSheet.getCell(addr);
                         applyCellStyle(cell, tmplCell);
                     }
                 } catch {}
            }
        };

        // --- WRITE BASIC INFO ---
        writeToCell(config.storeName, safeVal(staffInfo?.branch));
        writeToCell(config.staffID, safeVal(staffInfo?.id));
        writeToCell(config.staffName, person);

        // 1. STATS FILLING
        if (data.role !== 'PHARMACIST') {
            const pointsDev = finalStage1.reduce((acc, row) => {
                if (row.status === Stage1Status.DEVELOP || row.status === Stage1Status.HALF_YEAR || row.status === Stage1Status.RETURN) {
                    const pts = recalculateStage1Points(row, data.role);
                    return acc + pts;
                }
                return acc;
            }, 0);

            // Note: pointsRep will be 0 here because Repurchase rows are filtered out of finalStage1
            const pointsRep = finalStage1.reduce((acc, row) => {
                if (row.status === Stage1Status.REPURCHASE) return acc + row.calculatedPoints;
                return acc;
            }, 0);

            let pointsTableDev = 0;
            for (const otherPerson of Object.keys(processedData)) {
                if (otherPerson === person) continue; 
                const otherData = processedData[otherPerson];
                otherData.stage1.forEach(row => {
                    if (row.originalDeveloper === person && row.status === Stage1Status.REPURCHASE) {
                         const fullPoints = recalculateStage1Points({ ...row, status: Stage1Status.DEVELOP }, otherData.role);
                         const actualRepurchasePoints = row.calculatedPoints; 
                         pointsTableDev += (fullPoints - actualRepurchasePoints);
                    }
                    if (row.status === Stage1Status.RETURN && row.originalDeveloper === person) {
                        const fullPoints = recalculateStage1Points({ ...row, originalDeveloper: undefined }, otherData.role); 
                        const sellerShare = recalculateStage1Points(row, otherData.role); 
                        const devShare = fullPoints - sellerShare; 
                        pointsTableDev += devShare;
                    }
                });
            }

            const getAmt = (key: string) => data.stage3.rows.find(r => r.categoryName.includes(key))?.subTotal || 0;
            
            writeToCell(config.cell_pointsStd, staffInfo?.pointsStandard || ''); 
            writeToCell(config.cell_pointsDev, pointsDev); 
            writeToCell(config.cell_pointsRep, pointsRep); 
            writeToCell(config.cell_pointsTableDev, pointsTableDev); 
            
            writeToCell(config.cell_cosmeticStd, staffInfo?.cosmeticStandard || ''); 
            writeToCell(config.cell_cosmeticTotal, data.stage3.total);
            writeToCell(config.cell_amtLrp, getAmt('理膚'));
            writeToCell(config.cell_amtCerave, getAmt('適樂膚'));
            writeToCell(config.cell_amtDrSatin, getAmt('Dr.Satin'));
            writeToCell(config.cell_amtCetaphil, getAmt('舒特膚'));
            writeToCell(config.cell_amtFlora, getAmt('芙樂思'));

            let rewardCash = 0;
            let reward711 = 0;
            let rewardFamily = 0;
            let rewardPx = 0;

            data.stage2.forEach(row => {
                if (row.isDeleted) return;
                if (row.format === '禮券') {
                    const label = (row.rewardLabel || '').toLowerCase();
                    if (label.includes('7-11') || label.includes('seven')) reward711 += row.quantity;
                    else if (label.includes('全家')) rewardFamily += row.quantity;
                    else if (label.includes('全聯')) rewardPx += row.quantity;
                } else {
                    rewardCash += (row.customReward !== undefined ? row.customReward : (row.quantity * row.reward));
                }
            });

            writeToCell(config.cell_rewardCash, rewardCash);
            writeToCell(config.cell_reward711, reward711);
            writeToCell(config.cell_rewardFamily, rewardFamily);
            writeToCell(config.cell_rewardPx, rewardPx);
        }

        // 2. LIST DATA WRITING
        let currentRow = config.startRow || 2;
        
        const put = (col: string | undefined, val: any) => {
            if (!col) return;
            const cell = sheet.getCell(`${col}${currentRow}`);
            cell.value = val;
            if (tmplSourceSheet) {
               const tmplRowIdx = config.startRow || 2;
               const templateCell = tmplSourceSheet.getCell(`${col}${tmplRowIdx}`);
               if (templateCell) applyCellStyle(cell, templateCell);
            }
        };

        // 1. Stage 1 Data (List)
        finalStage1.forEach(row => {
            let note: string = row.status; 
            if (data.role === 'PHARMACIST') {
                if (row.category === '調劑點數') note = `${row.quantity}份`;
                else if (row.status === Stage1Status.REPURCHASE && row.repurchaseType) note = row.repurchaseType;
            } else {
                if (row.category === '現金-小兒銷售') note = `${row.quantity}罐`;
                else if (row.status === Stage1Status.REPURCHASE && row.repurchaseType) note = row.repurchaseType;
            }

            let pts = 0;
            if (data.role !== 'PHARMACIST' && row.category === '現金-小兒銷售') pts = 0;
            else pts = recalculateStage1Points(row, data.role);
            
            const ptsDisplay = (data.role !== 'PHARMACIST' && row.category === '現金-小兒銷售') ? '' : pts;

            put(config.category, safeVal(row.category));
            put(config.date, safeVal(row.date));
            put(config.customerID, formatCID(row.customerID)); 
            put(config.itemID, safeVal(row.itemID));
            put(config.itemName, safeVal(row.itemName));
            put(config.quantity, data.role === 'PHARMACIST' ? safeVal(row.quantity) : '');
            put(config.amount, safeVal(row.amount)); 
            put(config.note, safeVal(note));
            put(config.points, safeVal(ptsDisplay));
            currentRow++;
        });

        // Stage 2 Logic
        if (data.role === 'PHARMACIST') {
            const pointsDev = finalStage1.reduce((acc, row) => {
                if (row.status === Stage1Status.DEVELOP || row.status === Stage1Status.HALF_YEAR || row.status === Stage1Status.RETURN) {
                    return acc + recalculateStage1Points(row, data.role);
                }
                return acc;
            }, 0);

            // pointsRep will be 0
            const pointsRep = finalStage1.reduce((acc, row) => {
                if (row.status === Stage1Status.REPURCHASE) return acc + row.calculatedPoints;
                return acc;
            }, 0);

            let pointsTableDev = 0;
            for (const otherPerson of Object.keys(processedData)) {
                if (otherPerson === person) continue; 
                const otherData = processedData[otherPerson];
                otherData.stage1.forEach(row => {
                    if (row.originalDeveloper === person && row.status === Stage1Status.REPURCHASE) {
                         const fullPoints = recalculateStage1Points({ ...row, status: Stage1Status.DEVELOP }, otherData.role);
                         const actualRepurchasePoints = row.calculatedPoints; 
                         pointsTableDev += (fullPoints - actualRepurchasePoints);
                    }
                    if (row.status === Stage1Status.RETURN && row.originalDeveloper === person) {
                        const fullPoints = recalculateStage1Points({ ...row, originalDeveloper: undefined }, otherData.role); 
                        const sellerShare = recalculateStage1Points(row, otherData.role); 
                        const devShare = fullPoints - sellerShare; 
                        pointsTableDev += devShare;
                    }
                });
            }

            writeToCell(config.cell_pharm_points_dev, pointsDev);
            writeToCell(config.cell_pharm_points_rep, pointsRep);
            writeToCell(config.cell_pharm_points_table_dev, pointsTableDev);

            const qty1727 = data.stage2.find(r => r.itemID === '001727')?.quantity || 0;
            const qty1345 = data.stage2.find(r => r.itemID === '001345')?.quantity || 0;
            const bonus = Math.max(0, (qty1727 - 300) * 10);

            writeToCell(config.cell_pharm_qty_1727, qty1727);
            writeToCell(config.cell_pharm_qty_1345, qty1345);
            writeToCell(config.cell_pharm_bonus, bonus);
            
        } else {
            // SALES
            if (data.stage2.length > 0) {
                 const addSimpleRow = (vals: any[]) => {
                     const r = sheet.getRow(currentRow++);
                     r.values = vals;
                     r.commit();
                 };
                 addSimpleRow(["--- 現金獎勵清單 ---"]);
                 
                 // Add Header Row for Stage 2
                 const headerRow = sheet.getRow(currentRow);
                 const headers = [
                    { key: config.reward_category || config.category, label: '分類' },
                    { key: config.reward_date || config.date, label: '日期' },
                    { key: config.reward_customerID || config.customerID, label: '客戶編號' },
                    { key: config.reward_itemID || config.itemID, label: '品項編號' },
                    { key: config.reward_itemName || config.itemName, label: '品名' },
                    { key: config.reward_quantity || config.quantity, label: '數量' },
                    { key: config.reward_note || 'G', label: '備註' },
                    { key: config.reward_amount || 'H', label: '金額' }
                 ];
                 
                 headers.forEach(h => {
                     if (h.key) {
                         const cell = headerRow.getCell(h.key);
                         cell.value = h.label;
                         cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
                         cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }; // Light Grey
                         cell.alignment = { horizontal: 'center' };
                         cell.font = { bold: true };
                     }
                 });
                 headerRow.commit();
                 currentRow++;

                 data.stage2.forEach(r => {
                     if (r.isDeleted) return;
                     let reward = r.format === '禮券' ? `${r.quantity}張` : `${r.customReward ?? (r.quantity * r.reward)}元`;
                     
                     put(config.reward_category || config.category, r.category);
                     put(config.reward_date || config.date, r.displayDate);
                     put(config.reward_customerID || config.customerID, formatCID(r.customerID));
                     put(config.reward_itemID || config.itemID, r.itemID);
                     put(config.reward_itemName || config.itemName, r.itemName);
                     put(config.reward_quantity || config.quantity, r.quantity);
                     put(config.reward_note || 'G', r.note); 
                     put(config.reward_amount || 'H', reward); 
                     currentRow++;
                 });
            }
        }
    } else {
        // NO TEMPLATE MODE (Fallback)
        let startRow = 1;
        if (reportDate) startRow = 2;

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

        const s1Total = finalStage1.reduce((sum, row) => {
            if (row.status === Stage1Status.DEVELOP || row.status === Stage1Status.HALF_YEAR || row.status === Stage1Status.REPURCHASE || row.status === Stage1Status.RETURN) {
                return sum + recalculateStage1Points(row, data.role);
            }
            return sum;
        }, 0);

        addRow([`【第一階段：點數表】 總計：${s1Total} 點`], false, true);
        
        const header = data.role === 'PHARMACIST' 
             ? ["分類", "日期", "客戶編號", "品項編號", "品名", "數量", "金額", "備註", "點數"]
             : ["分類", "日期", "客戶編號", "品項編號", "品名", "數量", "金額", "備註", "計算點數"];
        addRow(header, true);

        finalStage1.forEach(row => {
            let note: string = row.status;
            if (data.role === 'PHARMACIST') {
                if (row.category === '調劑點數') note = `${row.quantity}份`;
                else if (row.status === Stage1Status.REPURCHASE && row.repurchaseType) note = row.repurchaseType;
            } else {
                if (row.category === '現金-小兒銷售') note = `${row.quantity}罐`;
                else if (row.status === Stage1Status.REPURCHASE && row.repurchaseType) note = row.repurchaseType;
            }

            const pts = (data.role !== 'PHARMACIST' && row.category === '現金-小兒銷售') ? '' : recalculateStage1Points(row, data.role);
            addRow([
                safeVal(row.category), safeVal(row.date), formatCID(row.customerID), 
                safeVal(row.itemID), safeVal(row.itemName), safeVal(row.quantity),
                safeVal(row.amount), safeVal(note), safeVal(pts)
            ]);
        });
        
        startRow++; 

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
                    safeVal(row.category), safeVal(row.displayDate), formatCID(row.customerID),
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

  // --- 2. REPURCHASE SHEET (MATRIX VIEW) ---
  interface RepurchaseRowData extends Stage1Row {
      actualSellerPoints: number;
      devPoints: number;
  }
  
  const matrixData: Record<string, RepurchaseRowData[]> = {};
  const developersSet = new Set<string>();

  for (const sellerName of sortedPersons) {
      if (!selectedPersons.has(sellerName)) continue;

      const sellerData = processedData[sellerName];
      const rows: RepurchaseRowData[] = [];

      sellerData.stage1.forEach(row => {
          const isRepurchase = row.status === Stage1Status.REPURCHASE;
          const isReturnSplit = row.status === Stage1Status.RETURN && row.originalDeveloper && row.originalDeveloper !== '無';
          
          if (isRepurchase || isReturnSplit) {
              const dev = row.originalDeveloper;
              if (dev) {
                  developersSet.add(dev);
                  let fullPoints = 0;
                  let sellerPoints = row.calculatedPoints;
                  let devPoints = 0;

                  if (isReturnSplit) {
                       fullPoints = recalculateStage1Points({ ...row, originalDeveloper: undefined }, sellerData.role);
                       devPoints = fullPoints - sellerPoints;
                  } else {
                       fullPoints = recalculateStage1Points({ ...row, status: Stage1Status.DEVELOP }, sellerData.role);
                       devPoints = fullPoints - sellerPoints;
                  }
                  rows.push({ ...row, actualSellerPoints: sellerPoints, devPoints: devPoints });
              }
          }
      });
      if (rows.length > 0) matrixData[sellerName] = rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  if (Object.keys(matrixData).length > 0) {
      const repSheet = outWorkbook.addWorksheet("回購總表");
      
      const sortedDevs = Array.from(developersSet).sort((a, b) => {
          const roleA = processedData[a]?.role || staffMasterList.find(s => s.name === a)?.role || 'SALES';
          const roleB = processedData[b]?.role || staffMasterList.find(s => s.name === b)?.role || 'SALES';
          const pA = roleA === 'SALES' ? 1 : (roleA === 'PHARMACIST' ? 2 : 3);
          const pB = roleB === 'SALES' ? 1 : (roleB === 'PHARMACIST' ? 2 : 3);
          if (pA !== pB) return pA - pB;
          const staffA = staffMasterList.find(s => s.name === a);
          const staffB = staffMasterList.find(s => s.name === b);
          const idA = staffA?.id || '999999';
          const idB = staffB?.id || '999999';
          if (idA !== idB) return idA.localeCompare(idB, undefined, { numeric: true });
          return a.localeCompare(b, 'zh-TW');
      });

      const cols: Partial<ExcelJS.Column>[] = [
          { width: 20 }, { width: 12 }, { width: 15 }, { width: 15 }, { width: 30 }, { width: 15 }, { width: 12 }
      ];
      sortedDevs.forEach(() => cols.push({ width: 12 }));
      repSheet.columns = cols;

      if (reportDate) {
          const titleRow = repSheet.addRow([reportDate]);
          repSheet.mergeCells(titleRow.number, 1, titleRow.number, 7 + sortedDevs.length);
          const cell = titleRow.getCell(1);
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.font = { bold: true, size: 14 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE7C6' } }; 
          titleRow.height = 30; 
      }

      const headerRow1 = repSheet.addRow(["分類", "日期", "客戶編號", "品項編號", "品名", "備註", "回購點數", "原開發者 (開發點數)"]);
      if (sortedDevs.length > 0) repSheet.mergeCells(headerRow1.number, 8, headerRow1.number, 8 + sortedDevs.length - 1);

      const headerRow2Values = ["", "", "", "", "", "", ""]; 
      sortedDevs.forEach(dev => headerRow2Values.push(dev));
      const headerRow2 = repSheet.addRow(headerRow2Values);

      [headerRow1, headerRow2].forEach(row => {
          row.font = { bold: true };
          row.alignment = { horizontal: 'center', vertical: 'middle' };
          row.eachCell((cell, colNum) => {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colNum <= 7 ? 'FFE2E8F0' : 'FFDDD6FE' } };
              cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
          });
      });
      headerRow1.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
      headerRow1.getCell(7).font = { bold: true, color: { argb: 'FFB45309' } };
      
      Object.keys(matrixData).sort().forEach(sellerName => {
          const rows = matrixData[sellerName];
          const totalSeller = rows.reduce((acc, r) => acc + r.actualSellerPoints, 0);
          
          const sectionRowValues: any[] = [sellerName, "", "", "", "", "", totalSeller];
          sortedDevs.forEach(dev => {
              const devTotal = rows.reduce((acc, r) => r.originalDeveloper === dev ? acc + r.devPoints : acc, 0);
              sectionRowValues.push(devTotal === 0 ? '' : devTotal);
          });

          const sectionRow = repSheet.addRow(sectionRowValues);
          repSheet.mergeCells(sectionRow.number, 1, sectionRow.number, 6);
          const nameCell = sectionRow.getCell(1);
          nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
          nameCell.font = { bold: true, size: 12 };
          nameCell.border = { top: {style:'medium'}, bottom: {style:'medium'}, right: {style: 'thin'} };

          sectionRow.eachCell((cell, colNum) => {
              if (colNum >= 7) {
                  cell.font = { bold: true };
                  cell.alignment = { horizontal: 'right' };
                  cell.border = { top: {style:'medium'}, bottom: {style:'medium'} };
                  if (colNum === 7) { 
                      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
                      cell.font = { bold: true, color: { argb: 'FFB45309' } };
                  } else if (cell.value) { 
                      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3FF' } };
                      cell.font = { bold: true, color: { argb: 'FF6D28D9' } };
                  }
              }
          });

          rows.forEach(row => {
              const isReturn = row.status === Stage1Status.RETURN;
              const textColor = isReturn ? 'FFDC2626' : 'FF000000'; 
              const rowValues = [row.category, row.date, formatCID(row.customerID), row.itemID, row.itemName, safeVal(row.repurchaseType), row.actualSellerPoints];
              sortedDevs.forEach(dev => rowValues.push(dev === row.originalDeveloper ? row.devPoints : ''));

              const r = repSheet.addRow(rowValues);
              r.eachCell((cell, colNum) => {
                  cell.font = { color: { argb: textColor } };
                  cell.border = { bottom: { style: 'dotted', color: { argb: 'FFCBD5E1' } } };
                  if (colNum === 7) {
                      cell.font = { bold: true, color: { argb: isReturn ? 'FFDC2626' : 'FFB45309' } };
                      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
                  }
                  if (colNum > 7) {
                       const devName = sortedDevs[colNum - 8];
                       if (devName === row.originalDeveloper) {
                            cell.font = { bold: true, color: { argb: isReturn ? 'FFDC2626' : 'FF6D28D9' } };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3FF' } };
                       }
                  }
              });
          });
          repSheet.addRow([]);
      });
  }

  const buffer = await outWorkbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, defaultFilename.trim().replace(/\.xlsx$/i, '') + '.xlsx');
};

function getStoreColorARGB(name: string): string { return 'FF334155'; }

function copySheetModel(source: ExcelJS.Worksheet, target: ExcelJS.Worksheet, maxRow: number = 20) {
    if (source.columns) {
        target.columns = source.columns.map(col => ({ header: col.header, key: col.key, width: col.width, style: col.style }));
    }
    target.pageSetup = { ...source.pageSetup };
    if (source.properties) target.properties = JSON.parse(JSON.stringify(source.properties));
    if (source.views) target.views = JSON.parse(JSON.stringify(source.views));
    
    source.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        const newRow = target.getRow(rowNumber);
        if (row.height) newRow.height = row.height;
        newRow.hidden = row.hidden;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
             const newCell = newRow.getCell(colNumber);
             applyCellStyle(newCell, cell);
             if (rowNumber < maxRow) newCell.value = cell.value;
        });
    });

    const model = (source as any).model;
    if (model && model.merges) {
        (model.merges as string[]).forEach(merge => { try { target.mergeCells(merge); } catch (e) {} });
    } else {
        const merges = (source as any)._merges;
        if (merges) Object.keys(merges).forEach(merge => { try { target.mergeCells(merge); } catch (e) {} });
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
