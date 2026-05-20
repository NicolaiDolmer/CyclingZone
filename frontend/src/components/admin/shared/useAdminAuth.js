import { useCallback, useState } from "react";
import { supabase } from "../../../lib/supabase";

export function useAdminAuth() {
  const [msg, setMsg] = useState({ text: "", type: "success" });

  const getAuth = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
    };
  }, []);

  const showMsg = useCallback((text, type = "success") => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: "", type: "success" }), 4000);
  }, []);

  return { getAuth, showMsg, msg };
}
