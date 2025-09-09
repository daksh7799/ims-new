import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle(){
  const [mode,setMode] = useState(localStorage.getItem("theme") || "dark");

  useEffect(()=>{
    // Apply to both html and body for instant repaint across contexts
    document.documentElement.setAttribute('data-theme', mode);
    document.body.setAttribute('data-theme', mode);
    localStorage.setItem("theme",mode);
  },[mode]);

  return (
    <button className="btn outline small" onClick={()=>setMode(m=>m==="dark"?"light":"dark")}>
      {mode==="dark"? <Sun size={16}/> : <Moon size={16}/> } {mode==="dark"?"Light":"Dark"}
    </button>
  );
}
