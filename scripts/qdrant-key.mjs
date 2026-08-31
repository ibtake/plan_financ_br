/**
 * Resolvedor compartilhado de QDRANT_URL e QDRANT_API_KEY (fase 1 do RAG).
 *
 * Ordem: process.env → registro HKCU\Environment (Windows). Mesmo padrão do
 * linear-key.mjs: a saída do `reg` é redirecionada para arquivo temporário
 * (capturar stdout por pipe dispara EPERM sob sandbox), o valor nunca é
 * impresso e o temporário é removido no finally.
 */
import { execSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function valorDoRegistro(nome) {
  const tmp = join(tmpdir(), `${nome.toLowerCase()}-${process.pid}.tmp`);
  try {
    execSync(`reg query HKCU\\Environment /v ${nome} > "${tmp}"`, {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const m = readFileSync(tmp, 'utf8').match(new RegExp(`${nome}\\s+REG_SZ\\s+(\\S+)`));
    if (m) return m[1];
  } catch {
    /* não encontrada */
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* já removido */
    }
  }
  return '';
}

export function resolveQdrantEnv() {
  const url = process.env.QDRANT_URL || valorDoRegistro('QDRANT_URL');
  const apiKey = process.env.QDRANT_API_KEY || valorDoRegistro('QDRANT_API_KEY');
  const faltando = [];
  if (!url) faltando.push('QDRANT_URL');
  if (!apiKey) faltando.push('QDRANT_API_KEY');
  if (faltando.length) {
    console.error('ERRO: ' + faltando.join(' e ') + ' não encontradas (env ou registro HKCU).');
    console.error('Crie o cluster free em cloud.qdrant.io e semeie os valores (nunca os imprima):');
    console.error(
      "  pwsh: $env:QDRANT_URL = (Get-ItemProperty 'HKCU:\\Environment' -Name QDRANT_URL).QDRANT_URL"
    );
    console.error(
      "  pwsh: $env:QDRANT_API_KEY = (Get-ItemProperty 'HKCU:\\Environment' -Name QDRANT_API_KEY).QDRANT_API_KEY"
    );
    process.exit(1);
  }
  return { url, apiKey };
}
