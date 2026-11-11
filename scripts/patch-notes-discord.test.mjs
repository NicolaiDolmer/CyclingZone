import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDiscordText} from './patch-notes-discord.mjs';

function patch(body,{version='7.431',topic='Riders',rollout='live',audience='player'}={}){
 return {version,date:'2026-11-11',changes:[{topic,rollout,audience,en:{title:'Why?',body},da:{title:'Hvorfor?',body}}]};
}
function bullet(body,lang='en'){
 return buildDiscordText([patch(body)],{from:'7.431',lang})[0].split('\n').find(line=>line.startsWith('- **'));
}

test('Why? inside the owner-provided first sentence is not truncated',()=>{
 const body='Why? next to your riders is now available to everyone.';
 assert.equal(bullet(body),`- **Why?**: ${body}`);
});
test('a following real sentence is excluded after the embedded name',()=>{
 assert.equal(bullet('Why? next to your riders is now available to everyone. You can open the card.'),'- **Why?**: Why? next to your riders is now available to everyone.');
});
for(const[body,expected]of [
 ['The card is ready. You can open it.','The card is ready.'],
 ['Is the card ready? You can check.','Is the card ready?'],
 ['The card is ready! You can open it.','The card is ready!'],
 ['One ability point. 100% is the next sentence.','One ability point.'],
 ['The card is ready. "Open" is the next sentence.','The card is ready.'],
 ['The card is ready! ↓ indicates a change.','The card is ready!'],
 ['Is the card ready? 100% is the next sentence.','Is the card ready?'],
 ['Is the card ready? "Open" is the next sentence.','Is the card ready?'],
 ['Why? next to the name','Why? next to the name'],
 ['One sentence without punctuation','One sentence without punctuation'],
 ['  One complete sentence.  ','One complete sentence.'],
 ['A label? followed by lower-case text.','A label? followed by lower-case text.'],
])test('sentence boundary: '+body,()=>assert.equal(bullet(body),'- **Why?**: '+expected));
test('uppercase Danish letters also mark the next sentence',()=>{
 assert.equal(bullet('Kortet er klart. Åbn det ved navnet.','da'),'- **Hvorfor?**: Kortet er klart.');
});
test('line breaks before a real next sentence remain sentence boundaries',()=>{
 assert.equal(bullet('Why? next to the name is ready.\n\nYou can open it.'),'- **Why?**: Why? next to the name is ready.');
});
test('non-player entries stay hidden and beta stays after the live topic',()=>{
 const patches=[patch('Beta is ready.',{rollout:'beta'}),patch('Live is ready.'),patch('Internal.',{audience:'staff'})];
 const [message]=buildDiscordText(patches,{from:'7.431'});
 assert.ok(message.indexOf('**Riders**')<message.indexOf('**Beta group**'));
 assert.ok(!message.includes('Internal.'));
 assert.ok(message.endsWith('Full detail as always at cyclingzone.org/patch-notes.'));
});
test('multiple topic blocks still split into numbered Discord-sized messages',()=>{
 const patches=[patch('A'.repeat(1000)+'.'),patch('B'.repeat(1000)+'.',{topic:'Training'})];
 const messages=buildDiscordText(patches,{from:'7.431'});
 assert.equal(messages.length,2);
 assert.ok(messages.every(message=>message.length<=2000));
 assert.ok(messages[0].startsWith('1/2\n'));assert.ok(messages[1].startsWith('2/2\n'));
});
