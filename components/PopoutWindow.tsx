import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface PopoutWindowProps {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
}

const PopoutWindow: React.FC<PopoutWindowProps> = ({ children, title, onClose }) => {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const winRef = useRef<Window | null>(null);

  useEffect(() => {
    const openWindow = async () => {
      let win: Window | null = null;
      
      // 1. Try Document Picture-in-Picture API (Always on Top)
      if ('documentPictureInPicture' in window) {
        try {
          const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
            width: 1200,
            height: 800
          });
          win = pipWindow;
        } catch (err) {
          console.warn("PiP API failed, falling back to window.open", err);
        }
      }

      // 2. Fallback to standard window.open
      if (!win) {
        win = window.open('', '', 'width=1200,height=800,left=200,top=200');
      }

      if (!win) {
        alert("無法開啟視窗，請檢查是否被瀏覽器封鎖");
        onClose();
        return;
      }
      
      winRef.current = win;

      // Only write basic HTML if it's a standard window
      if (!win.document.body) {
        win.document.open();
        win.document.write('<!DOCTYPE html><html><head><title>' + title + '</title></head><body></body></html>');
        win.document.close();
      }

      // 3. COPY STYLES FROM PARENT
      // Force Tailwind CDN re-injection to ensure styles work even if copy fails
      if (!win.document.querySelector('script[src*="tailwindcss"]')) {
        const script = win.document.createElement('script');
        script.src = "https://cdn.tailwindcss.com";
        win.document.head.appendChild(script);
      }

      Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).forEach((node) => {
        const clonedNode = node.cloneNode(true);
        win?.document.head.appendChild(clonedNode);
      });

      // 4. Critical CSS for Layout (Prevent Glitch)
      const style = win.document.createElement('style');
      style.textContent = `
        html, body { height: 100vh; width: 100vw; margin: 0; padding: 0; overflow: hidden; background-color: #f9fafb; font-family: 'Noto Sans TC', sans-serif; }
        #popout-root { height: 100%; width: 100%; display: flex; flex-direction: column; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: #f1f1f1; }
        ::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }
      `;
      win.document.head.appendChild(style);

      // 5. Create Root Element
      let div = win.document.getElementById('popout-root');
      if (!div) {
        div = win.document.createElement('div');
        div.id = 'popout-root';
        Object.assign(div.style, {
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#ffffff',
            overflow: 'hidden'
        });
        win.document.body.appendChild(div);
      }
      
      setContainer(div);

      // 6. Cleanup Listeners
      const handleClose = () => onClose();
      win.addEventListener('pagehide', handleClose);
      
      // Monitor if window is closed by user
      const checkClosed = setInterval(() => {
        if (win && win.closed) {
          clearInterval(checkClosed);
          handleClose();
        }
      }, 500);

      win.focus();
    };

    openWindow();

    return () => {
      // Don't forcefully close the window on unmount if it's PiP, logic handled by state
      if (winRef.current && !winRef.current.closed) {
        winRef.current.close();
      }
    };
  }, []); // Run once on mount

  if (!container) return null;

  return createPortal(
    <div className="h-full flex flex-col bg-white">
       {children}
    </div>,
    container
  );
};

export default PopoutWindow;