// Gera o esqueleto do banco de produção (só estrutura do esquema public, sem dados)
// em backups/schema/rn-integra-schema.sql. Rode sempre que uma migração for aplicada.
//
// Requisitos: Docker Desktop aberto e login feito com `npx supabase login`.
// Uso: npm run db:schema            (produção)
//      npm run db:schema -- preview (banco dos previews, só para comparar; não grava o backup)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const CLI = ['--yes', 'supabase@2.122.0'];
const PROJECTS = { production: 'nagddicinjszfrtwgjbu', preview: 'funqdoiubwskmhefbvjz' };
const target = process.argv[2] === 'preview' ? 'preview' : 'production';
const out = target === 'production' ? 'backups/schema/rn-integra-schema.sql' : 'backups/schema/.preview-schema.sql';

const run = (args) => execFileSync('npx', [...CLI, ...args], { stdio: 'inherit', shell: process.platform === 'win32' });

mkdirSync('backups/schema', { recursive: true });
run(['link', '--project-ref', PROJECTS[target]]);
run(['db', 'dump', '--linked', '--schema', 'public', '--file', out]);

const sql = readFileSync(out, 'utf8');
const header = [
  '-- RN Integra: esqueleto do banco (esquema public, só estrutura, sem dados).',
  `-- Projeto: ${PROJECTS[target]} (${target}). Gerado em ${new Date().toISOString()} por npm run db:schema.`,
  '-- NÃO executar no banco atual: serve para recriar a estrutura num projeto Supabase novo e vazio.',
  '',
].join('\n');
writeFileSync(out, header + sql.replace(/^-- RN Integra:[\s\S]*?\n\n/, ''));
console.log(`\nEsqueleto salvo em ${out}`);
