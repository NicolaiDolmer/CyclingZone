import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL;

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export default function DeadlineDayTicker() {
  const [events, setEvents] = useState([]);
  const [active, setActive] = useState(false);

  async function fetchStatus() {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API}/api/deadline-day/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setActive(data.active);
    } catch {}
  }

  async function fetchTicker() {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API}/api/deadline-day/ticker`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      setEvents(await res.json());
    } catch {}
  }

  useEffect(() => {
    fetchStatus();
    const iv = setInterval(fetchStatus, 60_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!active) { setEvents([]); return; }
    fetchTicker();
    const iv = setInterval(fetchTicker, 10_000);
    return () => clearInterval(iv);
  }, [active]);

  if (!active || events.length === 0) return null;

  const text = events.map(e => e.text).join("   •   ");

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#0a0a0f]/95 border-t border-[#e8c547]/15 overflow-hidden h-8 flex items-center">
      <div className="flex whitespace-nowrap animate-ticker text-[11px] text-cz-accent/60 font-medium tracking-wide select-none">
        <span>{text}&nbsp;&nbsp;&nbsp;&bull;&nbsp;&nbsp;&nbsp;</span>
        <span aria-hidden="true">{text}&nbsp;&nbsp;&nbsp;&bull;&nbsp;&nbsp;&nbsp;</span>
      </div>
    </div>
  );
}
