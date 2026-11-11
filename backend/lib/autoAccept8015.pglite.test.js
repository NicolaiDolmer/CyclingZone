import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { verifyAutoAccept8015 } from './__fixtures__/autoAccept8015Db.js';
test('#8015 current beta migration: academy sale, empty squads, payments and ACL', async t=>{
 const db=new PGlite();t.after(()=>db.close());
 t.diagnostic(JSON.stringify(await verifyAutoAccept8015(db)));
});
