# Missing deployment evidence must not mean no build

Refs #6235. The workflow's frontend-prefix decision omitted backend/lib and
root inputs already covered by the canonical classifier. Use the same adapter
and full Git history, while keeping comparison bases appropriate to each flow.

Freshness needs a stable main snapshot and production-project metadata. A
previous build can cover later docs commits; it cannot cover later input edits.
Missing/truncated API pages or history remain unknown. Tests observed RED/GREEN.
The first live probe returned unknown after main moved beyond local history;
fetching the current history then produced current for 37b603096.
No production writes or deployments were performed.
