# #8666 · Forecast after lineup and at midnight

The race list read saved entries as a fallback. The rider's forecast read only race-day bindings until a stage wrote a load or receipt. A saved selection without a binding could therefore appear as training.

Use saved selections for their scheduled stage fields when a binding is absent. Preserve evidence precedence. Use recorded fatigue overnight only for riders on a pending or partial previous date before its settlement deadline. A completed or missing work row must allow the new date to project from midnight. Test with an explicit clock at midnight, at and beyond the deadline, after a plan change, and through the next-stage consumer. Show a known non-starter's planned session while the pending slot waits for settlement. The rolling rotation preview already receives that session from today's forecast, even when its rotation slot is null. Check the separate Rotation renderer at both widths.
