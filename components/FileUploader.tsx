
import React, { useRef } from 'react';
import { Upload, CheckCircle2, CircleDashed } from 'lucide-react';

interface FileUploaderProps {
  label: string;
  accept?: string;
  onFileSelect: (file: File) => void;
  disabled?: boolean;
  isLoaded?: boolean;
  icon?: string;
  compact?: boolean;
}

const FileUploader: React.FC<FileUploaderProps> = ({ label, accept = ".xlsx, .xls, .csv", onFileSelect, disabled, isLoaded, compact }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    if (!disabled && inputRef.current) {
      inputRef.current.click();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="h-full">
      <input type="file" ref={inputRef} accept={accept} onChange={handleChange} className="hidden" />
      <button
        onClick={handleClick}
        disabled={disabled}
        className={`
          w-full flex items-center border rounded text-left transition-all duration-300
          ${compact ? 'py-2 px-3 gap-3 h-auto' : 'gap-3 px-4 py-3 h-full'}
          ${disabled 
            ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed' 
            : isLoaded
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100 shadow-sm'
              : 'bg-white border-gray-300 text-slate-700 hover:bg-blue-50 hover:border-blue-400 hover:shadow-inner'
          }
        `}
        title={compact ? label : undefined}
      >
        <div className={`rounded border flex items-center justify-center transition-all ${compact ? 'p-1 w-6 h-6' : 'p-1.5'} ${isLoaded ? 'bg-emerald-100 border-emerald-200 text-emerald-600' : 'bg-gray-100 border-gray-200 text-gray-500'}`}>
            {isLoaded ? <CheckCircle2 size={compact ? 14 : 16} /> : <Upload size={compact ? 14 : 16} />}
        </div>
        
        <div className="flex-1 min-w-0">
            <div className={`flex justify-between items-center ${compact ? 'gap-2' : ''}`}>
                <span className={`${compact ? 'text-xs' : 'text-sm'} font-bold truncate`}>{label}</span>
                {isLoaded && <span className={`text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded-sm shrink-0 font-bold ${compact ? 'scale-90 origin-right' : ''}`}>OK</span>}
            </div>
            {!compact && !isLoaded && !disabled && <span className="text-xs text-gray-400 font-mono mt-0.5 block">Excel Files Only</span>}
        </div>
      </button>
    </div>
  );
};

export default FileUploader;
