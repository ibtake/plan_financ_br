/**
 * Resolvedor compartilhado de LINEAR_API_KEY para os scripts linear-*.
 *
 * Ordem: process.env.LINEAR_API_KEY → registro HKCU\Environment (Windows).
 *
 * A consulta ao registro redireciona a saída do `reg` para um arquivo
 * temporário: capturar stdout por pipe dispara EPERM em ambientes com
 * sandbox, e o erro engolido pelo catch deixava o script morrer com
 * "key não encontrada" mesmo com a chave presente. O valor nunca é
 * impresso e o arquivo temporário é removido no finally.
 */
import { execSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function resolveApiKey() {
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY;
  if (process.platform === 'win32') {
    const tmp = join(tmpdir(), `linear-key-${process.pid}.tmp`);
    try {
      execSync(`reg query HKCU\\Environment /v LINEAR_API_KEY > "${tmp}"`, {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      const m = readFileSync(tmp, 'utf8').match(/LINEAR_API_KEY\s+REG_SZ\s+(\S+)/);
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
  }
  console.error('ERRO: LINEAR_API_KEY não encontrada (env ou registro HKCU).');
  console.error('Ambiente com sandbox? Semeie a key antes de rodar (nunca imprima o valor):');
  console.error(
    "  pwsh: $env:LINEAR_API_KEY = (Get-ItemProperty 'HKCU:\\Environment' -Name LINEAR_API_KEY).LINEAR_API_KEY",
  );
  process.exit(1);
}
