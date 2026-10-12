// #6490 M2. Reuses the reviewed target/isolation/transport/budget gates; no SQL install.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runBackfill,runBackfillCli} from './backfillTrainingSeen6490.mjs';
export const runMembershipBackfill=(argv,env=process.env,deps={})=>runBackfill(argv,env,deps,'membership');
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  await runBackfillCli(process.argv.slice(2),process.env,'membership');
