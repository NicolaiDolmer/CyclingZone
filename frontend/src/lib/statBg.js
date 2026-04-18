export function statBg(value) {
  if (value >= 83) return "bg-red-500 text-white";
  if (value >= 70) return "bg-yellow-400 text-black";
  return "text-white/40";
}
