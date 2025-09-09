import { createContext, useContext, useRef, useState } from "react";
import { clsx } from "clsx";

const ToastCtx = createContext({ push: () => {} });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(1);

  function push(msg, type="info", ttl=2500) {
    const id = idRef.current++;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), ttl);
  }

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div style={{ position:"fixed", right:16, bottom:16, display:"grid", gap:10, zIndex:9999 }}>
        {toasts.map(t=>(
          <div key={t.id}
            className={clsx("badge", t.type==="ok"&&"ok", t.type==="warn"&&"warn", t.type==="err"&&"err")}
            style={{ padding:"10px 12px", borderRadius:12, background:"var(--surface)", border:"1px solid var(--border)", boxShadow:"var(--shadow-1)" }}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast(){ return useContext(ToastCtx) }
