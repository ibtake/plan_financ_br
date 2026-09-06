// =====================================================================
// IMPR-010 Fase 0 - bancada de medicao de passkey (descartavel)
// =====================================================================
//
// Responde o que a Fase 0 do card pede antes de qualquer codigo de fluxo:
// `aal` e `amr` do token de signInWithPasskey(), o teto de passkeys por
// conta, o que o servidor manda em `excludeCredentials` no segundo registro
// e o alcance das operacoes de gestao do proprio usuario.
//
// ALCANCE: rota /passkey-lab, liberada so em dev e em homologacao pelo
// portao de App.jsx. Nenhuma tela do app importa este arquivo. Nao toca
// AuthContext, refreshAssurance() nem o portao de MFA - fala direto com
// supabase.auth, de proposito, para que a medicao mostre o comportamento
// cru do servidor e nao o do app.
//
// SEGURANCA: nenhum access_token chega a tela. As claims vem de
// getClaims(), que devolve o payload ja verificado, e apenas `aal`, `amr`
// e `exp` sao exibidos. Ids de credencial saem truncados.
//
// ponytail: bancada temporaria - sai no release que fechar a Fase 0.
// =====================================================================

import { useState } from 'react'
import { supabase } from '../../lib/supabase.js'

/** Ids de credencial sao longos e nao interessam inteiros: existir e casar basta. */
function curto(valor) {
  const s = String(valor ?? '')
  return s.length > 12 ? `${s.slice(0, 8)}...(${s.length})` : s
}

async function claimsDaSessao() {
  const { data, error } = await supabase.auth.getClaims()
  if (error) throw error
  const claims = data?.claims
  if (!claims) return 'sem sessao ativa'
  return { aal: claims.aal, amr: claims.amr, exp: claims.exp }
}

// As medicoes na ordem do card. `ctx.id` vem do campo de texto e serve as
// operacoes que precisam apontar uma credencial especifica.
const MEDICOES = [
  {
    rotulo: '1. Claims da sessao atual (linha de base senha + TOTP)',
    fn: claimsDaSessao,
  },
  {
    rotulo: '2. Opcoes de registro: RP ID e excludeCredentials',
    async fn() {
      const { data, error } = await supabase.auth.passkey.startRegistration()
      if (error) throw error
      const o = data.options
      return {
        rpId: o.rp?.id,
        excludeCredentials: (o.excludeCredentials ?? []).map((c) => curto(c.id)),
        authenticatorSelection: o.authenticatorSelection,
        algoritmos: (o.pubKeyCredParams ?? []).map((p) => p.alg),
        attestation: o.attestation,
        timeout: o.timeout,
      }
    },
  },
  {
    rotulo: '3. Registrar passkey (repetir ate o servidor recusar = teto)',
    async fn() {
      const { data, error } = await supabase.auth.registerPasskey()
      if (error) throw error
      return data
    },
  },
  {
    rotulo: '4. Listar passkeys da conta',
    async fn() {
      const { data, error } = await supabase.auth.passkey.list()
      if (error) throw error
      return { total: data.length, itens: data }
    },
  },
  {
    rotulo: '5. Renomear a passkey do campo id',
    async fn(ctx) {
      const { data, error } = await supabase.auth.passkey.update({
        passkeyId: ctx.id,
        friendlyName: `bancada ${new Date().toISOString().slice(11, 19)}`,
      })
      if (error) throw error
      return data
    },
  },
  {
    rotulo: '6. Revogar a passkey do campo id',
    async fn(ctx) {
      const { error } = await supabase.auth.passkey.delete({ passkeyId: ctx.id })
      if (error) throw error
      return 'revogada'
    },
  },
  {
    rotulo: '7. Sair e entrar por passkey: aal e amr do token novo',
    async fn() {
      await supabase.auth.signOut()
      const { data, error } = await supabase.auth.signInWithPasskey()
      if (error) throw error
      return { entrou: Boolean(data?.session), claims: await claimsDaSessao() }
    },
  },
]

export default function PasskeyLab() {
  const [log, setLog] = useState([])
  const [id, setId] = useState('')
  const [ocupado, setOcupado] = useState(null)

  if (!supabase) {
    return <div className="notice danger" role="alert">Supabase não configurado neste ambiente.</div>
  }

  async function executar(medicao) {
    setOcupado(medicao.rotulo)
    const hora = new Date().toISOString().slice(11, 19)
    try {
      const resultado = await medicao.fn({ id: id.trim() })
      setLog((atual) => [{ hora, rotulo: medicao.rotulo, ok: true, resultado }, ...atual])
    } catch (erro) {
      // WebAuthnError e AuthError trazem campos diferentes; o log leva os dois.
      const detalhe = { nome: erro?.name, code: erro?.code, status: erro?.status, message: erro?.message }
      setLog((atual) => [{ hora, rotulo: medicao.rotulo, ok: false, resultado: detalhe }, ...atual])
    } finally {
      setOcupado(null)
    }
  }

  const suportaWebAuthn = typeof window !== 'undefined' && 'PublicKeyCredential' in window

  return (
    <div className="stack" style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Bancada de passkey — Fase 0</div>
            <div className="card-sub">
              Tela de medição, fora de qualquer fluxo do app. Só existe em desenvolvimento e homologação.
            </div>
          </div>
          <span className={`chip ${suportaWebAuthn ? 'income' : 'warning'}`}>
            {suportaWebAuthn ? 'WebAuthn disponível' : 'sem WebAuthn'}
          </span>
        </div>

        <div className="setting-row">
          <label className="text-sm" htmlFor="passkey-lab-id">Id da passkey (medições 5 e 6)</label>
          <input
            id="passkey-lab-id"
            className="input"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="copie o id da medição 4"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="settings-actions" style={{ marginTop: 14, flexWrap: 'wrap', gap: 8 }}>
          {MEDICOES.map((medicao) => (
            <button
              key={medicao.rotulo}
              type="button"
              className="btn btn-sm"
              onClick={() => executar(medicao)}
              disabled={Boolean(ocupado)}
            >
              {ocupado === medicao.rotulo ? 'medindo...' : medicao.rotulo}
            </button>
          ))}
        </div>

        <div className="text-xs text-muted" style={{ marginTop: 12 }}>
          O alcance de <code>auth.admin.passkey.deletePasskey()</code> não é medido aqui: exige
          <code> service_role</code>, que nunca entra em código de navegador.
        </div>
      </section>

      <section className="card" aria-live="polite">
        <div className="card-head">
          <div className="card-title">Resultados</div>
          <button type="button" className="btn btn-sm" onClick={() => setLog([])} disabled={log.length === 0}>
            Limpar
          </button>
        </div>
        {log.length === 0 ? (
          <div className="empty">Nenhuma medição ainda.</div>
        ) : (
          log.map((linha, indice) => (
            <div key={`${linha.hora}-${indice}`} style={{ marginBottom: 12 }}>
              <div className="text-xs text-muted">
                {linha.hora} · {linha.ok ? 'ok' : 'erro'} · {linha.rotulo}
              </div>
              <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
                {JSON.stringify(linha.resultado, null, 2)}
              </pre>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
