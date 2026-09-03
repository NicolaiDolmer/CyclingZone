import { createContext } from "react";

// #4625 (slice 3 af #4622) — delt mellem DataTable.jsx (provider, om <tbody>)
// og Button.jsx (consumer). PAGE_TEMPLATES T2: "row action buttons are
// secondary sm (never gold in rows)" — guld i raekker var et gentaget audit-
// fund (Auktioner, Akademi). Egen fil for at undgaa cirkulaert import mellem
// de to komponenter.
export const TableRowContext = createContext(false);
