// Önálló háttérfolyamat a job queue feldolgozására (opcionális).
// Alapesetben az API-szerver maga futtatja a workert; ha GEO_EMBEDDED_WORKER=0, ezzel indítható külön: npm run worker
import { initSite } from './routes.ts';

initSite({ worker: true });
console.log('GEO Audit worker fut – a sorban álló auditokat dolgozza fel.');
