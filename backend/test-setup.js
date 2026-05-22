// #552: Node 20 mangler native WebSocket. @supabase/realtime-js init'er eagerly
// ved createClient(), så ren import af supabase fra en test-fil crasher med:
//   "Error: Node.js 20 detected without native WebSocket support."
// Polyfill via `ws` (allerede dep). Fjernes når CI opgraderes til Node 22+.
import WebSocket from "ws";
globalThis.WebSocket = WebSocket;
