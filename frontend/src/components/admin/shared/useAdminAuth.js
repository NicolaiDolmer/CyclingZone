import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../../lib/supabase";

export function useAdminAuth() {
  const [msg, setMsg] = useState({ text: "", type: "success" });
  const timeoutRef = useRef(null);

  const getAuth = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
    };
  }, []);

  const showMsg = useCallback((text, type = "success") => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setMsg({ text, type });
    timeoutRef.current = setTimeout(() => {
      setMsg({ text: "", type: "success" });
      timeoutRef.current = null;
    }, 4000);
  }, []);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return { getAuth, showMsg, msg };
}
