import test from 'node:test';
import assert from 'node:assert/strict';
import { beginGroupClock, replaceTraversal, addPointDelay, projectGroupClock, type GroupClock } from './groupClock.ts';
import type { RaceGroup } from './types.ts';
const group=(id:string,gap:number):RaceGroup=>({id,kind:'chase',rider_ids:[id],gap_seconds:gap,cohesion:1});
const start=()=>beginGroupClock({groups:[group('front',0),group('follower',30)],frontTimeSeconds:1000,fromKm:10,toKm:20});
function travelled():GroupClock{
 let clock=start();
 clock=replaceTraversal(clock,'front',100);
 return replaceTraversal(clock,'follower',60);
}

test('a faster follower changes the reference without erasing physical arrival times',()=>{
 const result=projectGroupClock(travelled());
 assert.equal(result.frontTimeSeconds,1090);
 assert.equal(result.groups.find(g=>g.id==='front')?.gap_seconds,10);
 assert.equal(result.groups.find(g=>g.id==='follower')?.gap_seconds,0);
 assert.equal(result.arrivals.front,1100);
 assert.equal(result.arrivals.follower,1090);
});

test('a second estimate of the same traversal replaces it instead of travelling the distance twice',()=>{
 const once=replaceTraversal(start(),'front',100);
 const improved=replaceTraversal(once,'front',80);
 assert.equal(projectGroupClock(improved).arrivals.front,1080);
 assert.equal(projectGroupClock(replaceTraversal(improved,'front',80)).arrivals.front,1080);
 assert.equal(projectGroupClock(once).arrivals.front,1100,'input remains unchanged');
});

test('incident delay is additive but survives a replacement traversal exactly once',()=>{
 const delayed=addPointDelay(travelled(),'follower',25);
 const improved=replaceTraversal(delayed,'follower',50);
 assert.equal(projectGroupClock(improved).arrivals.follower,1105);
 assert.equal(projectGroupClock(improved).arrivals.front,1100);
});

test('projection conserves pairwise differences and is independent of input order',()=>{
 const original=travelled();
 let reverse=beginGroupClock({groups:[group('follower',30),group('front',0)],frontTimeSeconds:1000,fromKm:10,toKm:20});
 reverse=replaceTraversal(replaceTraversal(reverse,'follower',60),'front',100);
 assert.deepEqual(projectGroupClock(reverse),projectGroupClock(original));
});

test('a new segment starts at the same absolute arrivals used by the previous projection',()=>{
 const previous=projectGroupClock(travelled());
 let next=beginGroupClock({...previous,fromKm:20,toKm:30});
 next=replaceTraversal(replaceTraversal(next,'front',100),'follower',100);
 assert.deepEqual(projectGroupClock(next).arrivals,{follower:1190,front:1200});
});

test('invalid physical inputs fail visibly instead of silently using a different clock',()=>{
 assert.throws(()=>replaceTraversal(start(),'missing',50),/unknown group/);
 assert.throws(()=>replaceTraversal(start(),'front',-1),/duration/);
 assert.throws(()=>replaceTraversal(start(),'front',NaN),/duration/);
 assert.throws(()=>addPointDelay(start(),'front',-1),/delay/);
 assert.throws(()=>beginGroupClock({groups:[group('x',0),group('x',0)],frontTimeSeconds:0,fromKm:0,toKm:1}),/duplicate/);
});
