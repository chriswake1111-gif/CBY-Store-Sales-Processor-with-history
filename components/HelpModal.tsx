
import React, { useState } from 'react';
import { X, BookOpen, Filter, AlertCircle, CheckCircle2 } from 'lucide-react';

interface HelpModalProps {
  onClose: () => void;
}

type Tab = 'INSTRUCTIONS' | 'RULES';

const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<Tab>('INSTRUCTIONS');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 transition-opacity">
      <div className="bg-white w-full max-w-4xl h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold tracking-wide flex items-center gap-2">
            系統說明中心
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 rounded-full hover:bg-slate-800">
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 bg-gray-50 shrink-0">
          <button
            onClick={() => setActiveTab('INSTRUCTIONS')}
            className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition-colors relative ${
              activeTab === 'INSTRUCTIONS' 
                ? 'text-blue-600 bg-white' 
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            <BookOpen size={18} />
            操作說明
            {activeTab === 'INSTRUCTIONS' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>}
          </button>
          <button
            onClick={() => setActiveTab('RULES')}
            className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition-colors relative ${
              activeTab === 'RULES' 
                ? 'text-emerald-600 bg-white' 
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Filter size={18} />
            篩選與計算規則
            {activeTab === 'RULES' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600"></div>}
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-white scroll-smooth">
          
          {activeTab === 'INSTRUCTIONS' && (
            <div className="space-y-8 max-w-3xl mx-auto">
              <section>
                <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <span className="bg-blue-100 text-blue-600 w-8 h-8 rounded-full flex items-center justify-center text-sm">1</span>
                  資料匯入流程
                </h3>
                <div className="pl-10 space-y-3 text-slate-600 leading-relaxed">
                  <p>請依照畫面上方的順序匯入檔案：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><strong className="text-slate-800">1. 藥師點數清單：</strong>包含品項編號與分類的 Excel 檔，用於判斷哪些品項屬於藥師調劑或特殊分類。</li>
                    <li><strong className="text-slate-800">2. 現金獎勵表：</strong>包含品項與對應獎金的 Excel 檔，用於第二階段計算。</li>
                    <li><strong className="text-slate-800">3. 銷售報表：</strong>系統匯出的原始銷售明細。</li>
                  </ul>
                  <div className="bg-blue-50 p-3 rounded text-sm text-blue-800 border border-blue-100 flex gap-2 mt-2">
                    <AlertCircle size={16} className="shrink-0 mt-0.5"/>
                    <p>注意：若要重新匯入銷售報表，目前的篩選進度將會被重置。</p>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <span className="bg-blue-100 text-blue-600 w-8 h-8 rounded-full flex items-center justify-center text-sm">2</span>
                  人員職位設定
                </h3>
                <div className="pl-10 text-slate-600 leading-relaxed">
                  <p>匯入銷售報表後，系統會自動跳出人員清單。請務必正確設定每位員工的職位：</p>
                  <ul className="mt-2 space-y-2">
                    <li className="flex items-center gap-2"><span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs font-bold rounded">門市</span> 一般銷售人員，計算銷售點數與現金獎勵。</li>
                    <li className="flex items-center gap-2"><span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs font-bold rounded">藥師</span> 藥師人員，計算調劑點數、奶粉點數與調劑件數。</li>
                    <li className="flex items-center gap-2"><span className="px-2 py-0.5 bg-red-100 text-red-800 text-xs font-bold rounded">無獎金</span> 該人員的資料將完全不列入計算（適合離職或不計薪人員）。</li>
                  </ul>
                </div>
              </section>

              <section>
                <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <span className="bg-blue-100 text-blue-600 w-8 h-8 rounded-full flex items-center justify-center text-sm">3</span>
                  資料檢視與編輯
                </h3>
                <div className="pl-10 space-y-4 text-slate-600 leading-relaxed">
                  <div>
                    <h4 className="font-bold text-slate-700 mb-1">第一階段：點數表</h4>
                    <p>您可以針對每一筆交易修改狀態：</p>
                    <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
                      <li><strong>開發 (預設)：</strong>正常計算全額點數。</li>
                      <li><strong>隔半年：</strong>正常計算全額點數（標記用）。</li>
                      <li><strong>回購：</strong>點數減半計算。</li>
                      <li><strong>刪除：</strong>該筆資料不計分。</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-700 mb-1">第二階段：獎勵表</h4>
                    <p>您可以暫時剔除某筆獎勵（點擊垃圾桶圖示），或手動修改該筆獎勵的金額（直接點擊金額數字）。</p>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <span className="bg-blue-100 text-blue-600 w-8 h-8 rounded-full flex items-center justify-center text-sm">4</span>
                  儲存與匯出
                </h3>
                <div className="pl-10 text-slate-600 leading-relaxed">
                  <p>完成篩選後，勾選左側要匯出的人員（可多選），點擊右上角的「匯出報表」即可下載 Excel 檔。</p>
                  <p className="mt-2 text-sm text-gray-500">系統提供「手動儲存」功能，可將目前進度存在瀏覽器中，防止意外關閉視窗導致做白工。</p>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'RULES' && (
            <div className="space-y-8 max-w-3xl mx-auto">
              
              {/* Sales Rules */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-emerald-50 px-6 py-3 border-b border-emerald-100 flex items-center gap-2">
                   <h3 className="text-lg font-bold text-emerald-800">門市人員 (Sales) 規則</h3>
                </div>
                <div className="p-6 space-y-6 bg-white">
                  <div>
                    <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500"/> 基本排除條件</h4>
                    <ul className="list-disc pl-8 space-y-1 text-slate-600 text-sm">
                      <li><strong>本次欠款：</strong>必須為 0 (無欠款)。</li>
                      <li><strong>原始點數：</strong>必須大於 0。</li>
                      <li><strong>單價：</strong>必須大於 0。</li>
                      <li><strong>特定品項：</strong>品類一為 "05-2" (成人奶水) 且單位為 "罐" 或 "瓶" 者排除。</li>
                      <li><strong>藥師排除清單：</strong>若品項存在於「藥師點數清單」且分類為「調劑點數」，則排除。</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500"/> 點數計算邏輯</h4>
                    <ul className="list-disc pl-8 space-y-1 text-slate-600 text-sm">
                      <li><strong>一般品項：</strong>維持原始點數。</li>
                      <li><strong>數量除算：</strong>若分類為「成人奶粉」、「成人奶水」或「嬰幼兒米麥精」，點數會除以數量 (無條件捨去)。</li>
                      <li><strong>現金-小兒銷售：</strong>點數強制歸零 (不計分)。</li>
                      <li><strong>回購狀態：</strong>若手動標記為「回購」，最終點數減半。</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Pharmacist Rules */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-blue-50 px-6 py-3 border-b border-blue-100 flex items-center gap-2">
                   <h3 className="text-lg font-bold text-blue-800">藥師人員 (Pharmacist) 規則</h3>
                </div>
                <div className="p-6 space-y-6 bg-white">
                   <div>
                    <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><CheckCircle2 size={16} className="text-blue-500"/> 第一階段：點數篩選</h4>
                    <ul className="list-disc pl-8 space-y-1 text-slate-600 text-sm">
                      <li><strong>基本條件：</strong>無欠款、原始點數 &gt; 0。</li>
                      <li><strong>成人奶粉 (05-1)：</strong>優先判定。點數需除以數量。</li>
                      <li><strong>調劑點數：</strong>若品項在「藥師點數清單」中分類為「調劑點數」，全額計分。</li>
                      <li><strong>其他：</strong>若品項在「藥師點數清單」中，全額計分。</li>
                      <li><strong>不在清單內：</strong>不列入計算。</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><CheckCircle2 size={16} className="text-blue-500"/> 第二階段：調劑件數統計</h4>
                    <ul className="list-disc pl-8 space-y-1 text-slate-600 text-sm">
                      <li><strong>自費調劑：</strong>統計品項編號為 <code>001727</code> 的總數量 (單位：件)。</li>
                      <li><strong>調劑藥事服務費：</strong>統計品項編號為 <code>001345</code> 的總數量 (單位：組)。</li>
                      <li>此階段不計算金額，僅統計數量。</li>
                    </ul>
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 flex justify-end">
          <button onClick={onClose} className="px-6 py-2 bg-slate-800 text-white font-bold rounded hover:bg-slate-700 transition-colors">
            關閉
          </button>
        </div>

      </div>
    </div>
  );
};

export default HelpModal;
