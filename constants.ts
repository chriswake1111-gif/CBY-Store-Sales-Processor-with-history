
export const COL_HEADERS = {
  SALES_PERSON: '銷售人員',
  CUSTOMER_ID: '客戶編號',
  CUSTOMER_NAME: '客戶名稱',
  DEBT: '本次欠款',
  POINTS: '員工點數', // Sometimes just '點數'
  UNIT_PRICE: '單價',
  CAT_1: '品類一',
  UNIT: '單位',
  ITEM_ID: '品項編號',
  ITEM_NAME: '品項名稱',
  QUANTITY: '數量',
  TICKET_NO: '單號',
  SALES_DATE: '銷售日期',
  CAT_2: '品類二',
  SUBTOTAL: '小計',
  DISCOUNT_RATIO: '折扣比',
};

export const CAT_MAPPING: Record<string, string> = {
  '04-6': '小兒營養素',
  '04-7': '成人保健品',
  '05-1': '成人奶粉',
  '05-2': '成人奶水',
  '05-3': '現金-小兒銷售',
};

// 3. Sorting Order for Stage 1
export const STAGE1_SORT_ORDER: Record<string, number> = {
  '小兒營養素': 1,
  '成人奶粉': 2,
  '成人奶水': 3,
  '其他': 4,
  '成人保健品': 5,
  '嬰幼兒米麥精': 6,
  '現金-小兒銷售': 7,
  '退換貨': 999 // Put Returns at the end
};

// 5. Updated Cosmetic Codes (6291 -> 6292)
export const COSMETIC_CODES: Record<string, string> = {
  '6292': '理膚', // Changed from 6291 to 6292
  '6293': '適樂膚',
  '6294': '芙樂思',
  '467': 'Dr.Satin',
  '2089': '舒特膚',
};

// Fixed Display Order for Stage 3
export const COSMETIC_DISPLAY_ORDER = [
  '理膚',
  '芙樂思',
  '適樂膚',
  'Dr.Satin',
  '舒特膚'
];
