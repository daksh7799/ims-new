// src/components/ManufacturingGate.jsx
import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import DailyStockCheck from "./DailyStockCheck.jsx";

export default function ManufacturingGate({ children }) {
  const [checking, setChecking] = useState(true);
  const [requiresCheck, setRequiresCheck] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkToday() {
      setChecking(true);
      try {
        const today = new Date().toISOString().split("T")[0];

        const { count, error } = await supabase
          .from("daily_stock_checks")
          .select("id", { head: true, count: "exact" })
          .eq("check_date", today);

        if (error) throw error;

        const needCheck = (count || 0) < 15;
        console.log("Stock checks today:", count, "requiresCheck:", needCheck);

        if (!cancelled) {
          setRequiresCheck(needCheck);
        }
      } catch (e) {
        console.error("Error checking daily_stock_checks:", e);
        if (!cancelled) {
          // safer: require check if query fails
          setRequiresCheck(true);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    checkToday();

    return () => {
      cancelled = true;
    };
  }, []);

  if (checking) {
    return <div className="p-4">Checking today&apos;s stock status…</div>;
  }

  if (requiresCheck) {
    return (
      <DailyStockCheck
        onCompleted={() => {
          setRequiresCheck(false);
        }}
      />
    );
  }

  // No check required → show manufacturing UI
  return <>{children}</>;
}
