// Gera o esqueleto do banco de produção (só estrutura do esquema public, sem dados)
// em backups/schema/rn-integra-schema.sql. Rode sempre que uma migração for aplicada.
//
// Sem Docker: a consulta de catálogo (scripts/db-schema.sql) roda pela API oficial do Supabase.
// Requisito: SUPABASE_ACCESS_TOKEN no arquivo .env.local (token pessoal criado em
// supabase.com/dashboard/account/tokens). O .env.local nunca vai para o git.
//
// Uso: npm run db:schema            (produção, grava o backup)
//      npm run db:schema -- preview (banco dos previews, grava .preview-schema.sql só para comparar)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const PROJECTS = { production: 'nagddicinjszfrtwgjbu', preview: 'funqdoiubwskmhefbvjz' };
const target = process.argv[2] === 'preview' ? 'preview' : 'production';
const out = target === 'production' ? 'backups/schema/rn-integra-schema.sql' : 'backups/schema/.preview-schema.sql';

function loadToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  if (existsSync('.env.local')) {
    const line = readFileSync('.env.local', 'utf8').split(/\r?\n/).find((l) => l.startsWith('SUPABASE_ACCESS_TOKEN='));
    if (line) return line.slice('SUPABASE_ACCESS_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
  }
  console.error('Falta SUPABASE_ACCESS_TOKEN no .env.local (crie em supabase.com/dashboard/account/tokens).');
  process.exit(1);
}

const query = readFileSync('scripts/db-schema.sql', 'utf8');
const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECTS[target]}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${loadToken()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, read_only: true }),
});
if (!res.ok) {
  console.error(`A API do Supabase respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const [row] = await res.json();
if (!row?.ddl) {
  console.error('A consulta não devolveu o esquema.');
  process.exit(1);
}

const header = [
  '-- RN Integra: esqueleto do banco (esquema public, só estrutura, sem dados).',
  `-- Projeto: ${PROJECTS[target]} (${target}). Gerado em ${new Date().toISOString()} por npm run db:schema.`,
  `-- Conteúdo: ${row.counts}`,
  '-- NÃO executar no banco atual: serve para recriar a estrutura num projeto Supabase novo e vazio.',
  '',
  '',
].join('\n');
mkdirSync('backups/schema', { recursive: true });
writeFileSync(out, header + row.ddl + '\n');
console.log(`Esqueleto salvo em ${out}\n${row.counts}`);
