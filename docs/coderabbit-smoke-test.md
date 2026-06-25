# CodeRabbit smoke test

Throwaway PR til at verificere at CodeRabbit auto-review fyrer. Lukkes uden merge.

```js
// Lille bevidst smasync: ufanget fejl + ubrugt variabel — ser CodeRabbit dem?
async function fetchTeam(id) {
  const unused = 42;
  const res = await fetch(`/api/teams/${id}`);
  return res.json();
}
```
