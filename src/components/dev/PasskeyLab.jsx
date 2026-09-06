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
import TurnstileCaptcha, { isTurnstileConfigured } from '../auth/TurnstileCaptcha.jsx'

/** Ids de credencial sao longos e nao interessam inteiros: existir e casar basta. */
function curto(valor) {
  const s = String(valor ?? '')
  return s.length > 12 ? `${s.slice(0, 8)}...(${s.length})` : s
}

/**
 * Medicoes 5 e 6 exigem id. Sem ele a URL fica /passkeys/ e o servidor responde
 * corpo vazio, que o auth-js tenta parsear como JSON e devolve AuthUnknownError
 * sem status - erro que nao diz nada sobre a operacao pedida.
 */
function exigeId(ctx) {
  const id = String(ctx.id ?? '').trim()
  if (!id) throw new Error('preencha o campo id com um valor da medicao 4')
  return id
}

/**
 * O auth-js beta chama Response.json() nas rotas de passkey update/delete, que
 * respondem corpo vazio (204/200 sem body): o parse estoura com AuthUnknownError
 * "Unexpected end of JSON input" mesmo quando o servidor aplicou. Aqui reconhecemos
 * esse caso para medir o efeito real via list(), em vez de reportar o erro do SDK.
 */
function corpoVazioDoSdk(erro) {
  return (
    erro?.name === 'AuthUnknownError' &&
    /Unexpected end of JSON input|Failed to execute 'json'/.test(erro?.message ?? '')
  )
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
      const passkeyId = exigeId(ctx)
      const nome = `bancada ${new Date().toISOString().slice(11, 19)}`
      try {
        const { data, error } = await supabase.auth.passkey.update({ passkeyId, friendlyName: nome })
        if (error) throw error
        return { idUsado: curto(passkeyId), item: data }
      } catch (erro) {
        if (!corpoVazioDoSdk(erro)) throw erro
        // Servidor respondeu sem corpo; confirma pelo estado da lista.
        const { data: lista } = await supabase.auth.passkey.list()
        const alvo = (lista ?? []).find((p) => p.id === passkeyId)
        return {
          idUsado: curto(passkeyId),
          nota: 'servidor respondeu sem corpo (SDK estourou o parse); efeito conferido via list()',
          aplicado: alvo?.friendly_name === nome,
          nomeAtual: alvo?.friendly_name ?? 'passkey nao encontrada na lista',
        }
      }
    },
  },
  {
    rotulo: '6. Revogar a passkey do campo id',
    async fn(ctx) {
      const passkeyId = exigeId(ctx)
      try {
        const { error } = await supabase.auth.passkey.delete({ passkeyId })
        if (error) throw error
      } catch (erro) {
        if (!corpoVazioDoSdk(erro)) throw erro
      }
      // Com ou sem corpo na resposta, a verdade e a lista depois da operacao.
      const { data: lista } = await supabase.auth.passkey.list()
      const some = !(lista ?? []).some((p) => p.id === passkeyId)
      return { revogada: curto(passkeyId), confirmadoForaDaLista: some, totalRestante: (lista ?? []).length }
    },
  },
  {
    rotulo: '7. Sair e entrar por passkey: aal e amr do token novo',
    captcha: true,
    async fn(ctx) {
      // Medido em homologacao: o servidor exige o token do Turnstile em
      // /passkeys/authentication/options e sem ele responde captcha_failed.
      // signInWithPasskey e o unico metodo de passkey que aceita captchaToken;
      // registerPasskey nao tem essa opcao no tipo das credenciais.
      if (isTurnstileConfigured() && !ctx.captchaToken) {
        throw new Error('resolva o captcha da tela antes desta medicao')
      }
      await supabase.auth.signOut()
      const { data, error } = await supabase.auth.signInWithPasskey({
        options: { captchaToken: ctx.captchaToken ?? undefined },
      })
      if (error) throw error
      return { entrou: Boolean(data?.session), claims: await claimsDaSessao() }
    },
  },
]

export default function PasskeyLab() {
  const [log, setLog] = useState([])
  const [id, setId] = useState('')
  const [ocupado, setOcupado] = useState(null)
  const [captchaToken, setCaptchaToken] = useState(null)
  // Token do Turnstile e de uso unico: remontar o widget e o jeito de ter outro.
  const [captchaNonce, setCaptchaNonce] = useState(0)

  if (!supabase) {
    return <div className="notice danger" role="alert">Supabase não configurado neste ambiente.</div>
  }

  async function executar(medicao) {
    setOcupado(medicao.rotulo)
    const hora = new Date().toISOString().slice(11, 19)
    try {
      const resultado = await medicao.fn({ id: id.trim(), captchaToken })
      setLog((atual) => [{ hora, rotulo: medicao.rotulo, ok: true, resultado }, ...atual])
    } catch (erro) {
      // WebAuthnError e AuthError trazem campos diferentes; o log leva os dois.
      const detalhe = { nome: erro?.name, code: erro?.code, status: erro?.status, message: erro?.message }
      setLog((atual) => [{ hora, rotulo: medicao.rotulo, ok: false, resultado: detalhe }, ...atual])
    } finally {
      setOcupado(null)
      if (medicao.captcha) {
        setCaptchaToken(null)
        setCaptchaNonce((n) => n + 1)
      }
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

        {isTurnstileConfigured() && (
          <div style={{ marginTop: 14 }}>
            <div className="text-xs text-muted" style={{ marginBottom: 6 }}>
              Captcha obrigatório na medição 7. Cada token vale uma vez; o widget se refaz depois de cada tentativa.
            </div>
            <TurnstileCaptcha key={captchaNonce} onTokenChange={setCaptchaToken} />
          </div>
        )}

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

      <section className="card" aria-live="polite" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
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
