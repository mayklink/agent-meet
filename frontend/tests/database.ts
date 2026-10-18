import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
export async function database() {
 const db=new PGlite();
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
 const baseline=readFileSync(new URL('../supabase/migration.sql',import.meta.url),'utf8').replace(/^ALTER PUBLICATION .*$/gm,'');
 await db.exec(baseline);
 await db.exec(readFileSync(new URL('../supabase/human-participation.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/human-security.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/unlimited-rooms.sql',import.meta.url),'utf8'));
 return db;
}
