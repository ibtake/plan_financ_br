import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Calculator, CircleAlert, CircleCheck, Settings2, Table2 } from 'lucide-react'
import { usePGBL } from '../hooks/usePGBL.js'
import { amountToInput, formatAmountInput, parseAmount } from '../utils/format.js'

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const DEFAULT_PARAMS = { limitePgblPercentual: 0.12, descontoSimplificadoPercentual: 0.2, tetoDescontoSimplificado: 17640, deducaoPorDependenteAno: 2275.08, tetoEducacaoPorPessoaAno: 3561.5, fonte: 'Receita Federal — referência 2025/2026', tabela: [[29145.6, 0, 0], [33919.8, 2185.92, 0.075], [45012.6, 4729.92, 0.15], [55976.16, 8105.88, 0.225], [Infinity, 10904.76, 0.275]] }
const blankMonths = () => MONTHS.map((mes) => ({ mes, base: '', retido: '', inss: '', pgbl: '', saude: '', educacao: '' }))
Object.assign(DEFAULT_PARAMS, { reducaoAnualLimite: 60000, reducaoAnualMaxima: 2694.15, reducaoAnualFaixaFinal: 88200, reducaoAnualIntercepto: 8429.73, reducaoAnualCoeficiente: 0.095575, fonte: 'Receita Federal — referência 2026/2027', tabela: [[29145.6, 0, 0], [33919.8, 2185.92, 0.075], [45012.6, 4729.91, 0.15], [55976.16, 8105.85, 0.225], [Infinity, 10904.66, 0.275]] })
const parseBRInput = (value) => {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/\.(?=\d{3}(?:\D|$))/g, '')
  const parsed = Number(normalized.replace(/[^\d.-]/g, ''))
  return Number.isFinite(parsed) ? Math.max(0, parsed) : ''
}
const formatBRInput = (value) => { const parsed = parseBRInput(value); return parsed === '' ? '' : Number(parsed).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
const toNumeric = (value) => Number(parseBRInput(value) || 0)
const money = (value) => toNumeric(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const numberValue = (value) => value === '' ? '' : Math.max(0, Number(value) || 0)
const normalizeParams = (params = DEFAULT_PARAMS) => {
  const merged = { ...DEFAULT_PARAMS, ...params }
  const legacy2026 = Array.isArray(params?.tabela) && Number(params.tabela?.[2]?.[1]) === 4729.92 && Number(params.tabela?.[3]?.[1]) === 8105.88 && Number(params.tabela?.[4]?.[1]) === 10904.76
  const tabela = legacy2026 ? DEFAULT_PARAMS.tabela : (merged.tabela || DEFAULT_PARAMS.tabela)
  const finiteOr = (value, fallback, min = 0, max = Infinity) => {
    const number = Number(value)
    return Number.isFinite(number) && number >= min && number <= max ? number : fallback
  }
  return {
    ...merged,
    limitePgblPercentual: finiteOr(merged.limitePgblPercentual, DEFAULT_PARAMS.limitePgblPercentual, 0, 1),
    descontoSimplificadoPercentual: finiteOr(merged.descontoSimplificadoPercentual, DEFAULT_PARAMS.descontoSimplificadoPercentual, 0, 1),
    tetoDescontoSimplificado: finiteOr(merged.tetoDescontoSimplificado, DEFAULT_PARAMS.tetoDescontoSimplificado, 0, 100000),
    deducaoPorDependenteAno: finiteOr(merged.deducaoPorDependenteAno, DEFAULT_PARAMS.deducaoPorDependenteAno, 0, 100000),
    tetoEducacaoPorPessoaAno: finiteOr(merged.tetoEducacaoPorPessoaAno, DEFAULT_PARAMS.tetoEducacaoPorPessoaAno, 0, 100000),
    tabela: tabela.map((row, index, rows) => [index === rows.length - 1 || row[0] == null ? Infinity : Number(row[0]), Number(row[1]) || 0, Number(row[2]) || 0]),
  }
}

export function calculatePGBL(months, premise, params) {
  const total = (field) => months.reduce((sum, month) => sum + toNumeric(month[field]), 0)
  const dependentes = Math.max(0, Number(premise.dependentes) || 0)
  const base = total('base'), retido = total('retido'), inss = total('inss'), pgbl = total('pgbl'), saude = total('saude')
  const educacaoLancada = total('educacao')
  const educacao = educacaoLancada || toNumeric(premise.educacao)
  const limite = premise.contribuiInss ? base * params.limitePgblPercentual : 0
  const pgblDedutivel = Math.min(pgbl, limite)
  const educacaoDedutivel = Math.min(educacao, params.tetoEducacaoPorPessoaAno * (dependentes + 1))
  const completo = inss + pgblDedutivel + saude + dependentes * params.deducaoPorDependenteAno + educacaoDedutivel
  const simplificado = Math.min(base * params.descontoSimplificadoPercentual, params.tetoDescontoSimplificado)
  const deductions = Math.max(completo, simplificado)
  const baseFinal = Math.max(base - deductions, 0)
  const faixa = params.tabela.find((item) => baseFinal <= item[0]) || params.tabela.at(-1)
  const irBase = Math.max(baseFinal * faixa[2] - faixa[1], 0)
  const reducaoAnual = base <= params.reducaoAnualLimite
    ? Math.min(irBase, params.reducaoAnualMaxima)
    : base <= params.reducaoAnualFaixaFinal
      ? Math.min(irBase, Math.max(0, params.reducaoAnualIntercepto - params.reducaoAnualCoeficiente * base))
      : 0
  const ir = Math.max(irBase - reducaoAnual, 0)
  const delta = Math.max(limite - pgbl, 0)
  const excedente = Math.max(pgbl - limite, 0)
  const status = !premise.contribuiInss ? 'PGBL não dedutível para você' : excedente > 0 ? 'PARE — você já passou do teto' : delta === 0 ? 'NO TETO — aporte ideal' : `APORTAR MAIS ${money(delta)} até o fim do ano`
  return { base, retido, inss, pgbl, saude, educacao, educacaoDedutivel, limite, pgblDedutivel, completo, simplificado, baseFinal, faixa, irBase, reducaoAnual, ir, restituicao: retido - ir, delta, excedente, status, modelo: completo >= simplificado ? 'COMPLETA' : 'SIMPLIFICADA' }
}

function Field({ label, value, onChange, type = 'number', step = '0.01' }) {
  return <label className="field"><span className="label">{label}</span><input className="input" type={type} min="0" step={type === 'number' ? step : undefined} value={value} onChange={(event) => onChange(type === 'number' ? numberValue(event.target.value) : event.target.value)} /></label>
}

function PGBLAmountInput({ value, label, onChange }) {
  const [draft, setDraft] = useState(value === '' || value == null ? '' : amountToInput(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setDraft(value === '' || value == null ? '' : amountToInput(value)) }, [value, editing])
  return <input className="input pgbl-cell" type="text" inputMode="numeric" value={draft} onFocus={() => setEditing(true)} onChange={(event) => { const masked = formatAmountInput(event.target.value); setDraft(masked); onChange(parseAmount(masked)) }} onBlur={() => { setEditing(false); setDraft(value === '' || value == null ? '' : amountToInput(value)) }} aria-label={label} />
}

export default function PGBLPanel() {
  const year = new Date().getFullYear()
  const { plans, loading, error: pgblError, savePlan, deletePlan } = usePGBL()
  const [selectedYear, setSelectedYear] = useState(year)
  const [view, setView] = useState('resumo')
  const years = plans
  const latestYear = Math.max(...Object.keys(years).map(Number))
  const data = { ...(years[selectedYear] || { months: blankMonths(), premise: { contribuiInss: true, dependentes: 0, educacao: 0 }, params: normalizeParams(years[latestYear]?.params) }), year: selectedYear }
  const result = useMemo(() => calculatePGBL(data.months, data.premise, normalizeParams(data.params)), [data])
  const update = (next) => {
    if (next.year) return changeYear(next.year)
    savePlan({ ...data, ...next, params: normalizeParams({ ...data.params, ...(next.params || {}) }) })
  }
  const changeYear = (value) => {
    const nextYear = Number(value) || year
    if (!years[nextYear]) savePlan({ year: nextYear, months: blankMonths(), premise: { ...data.premise }, params: normalizeParams(data.params) })
    setSelectedYear(nextYear)
  }
  const updateMonth = (index, field, value) => update({ months: data.months.map((month, monthIndex) => monthIndex === index ? { ...month, [field]: value } : month) })
  const statusClass = result.excedente ? 'danger' : result.delta ? 'warning' : 'success'

  if (loading) return <div className="card pgbl-loading" role="status"><div className="spinner" />Carregando dados do Aporte Certo…</div>

  const removeYear = async () => {
    if (!window.confirm(`Excluir todos os dados do ano ${selectedYear}? Essa ação não pode ser desfeita.`)) return
    const removed = await deletePlan(selectedYear)
    if (removed) setSelectedYear(Number(Object.keys(years).find((item) => Number(item) !== selectedYear) || year))
  }

  return <div className="pgbl-tool">
    {view === 'mensal' && <StableTransposedPGBLTable data={data} result={result} onChange={updateMonth} onYearChange={(value) => update({ year: Number(value) || year })} />}
    {view === 'config' && <ConfigYearSelector years={years} selectedYear={selectedYear} onChange={changeYear} onDelete={removeYear} />}
    {pgblError && <div className="notice danger">{pgblError}</div>}
    <div className="pgbl-tabs" role="tablist" aria-label="Aporte Certo">
      {[['resumo', Calculator, 'Resumo anual'], ['mensal', Table2, 'Lançamentos'], ['config', Settings2, 'Parâmetros'], ['sobre', BookOpen, 'Como funciona']].map(([id, Icon, label]) => <button key={id} type="button" role="tab" aria-selected={view === id} className={`pgbl-tab${view === id ? ' active' : ''}`} onClick={() => setView(id)}><Icon size={16} />{label}</button>)}
    </div>

    {view === 'mensal' && <div className="pgbl-layout"><section className="card pgbl-table-card"><div className="card-head"><div><h2 className="card-title">Lançamentos mensais</h2><p className="card-sub">Preencha os valores do seu ano-calendário.</p></div><Field label="Ano" value={data.year} onChange={(value) => update({ year: Number(value) || year })} step="1" /></div><div className="pgbl-table-wrap"><table className="pgbl-table"><thead><tr><th>Mês</th><th>Base IR</th><th>IR retido</th><th>INSS</th><th>Aporte PGBL</th><th>Saúde</th><th>PGBL acumulado</th><th>Saúde acumulada</th></tr></thead><tbody>{data.months.map((month, index) => <tr key={month.mes}><th>{month.mes.slice(0, 3)}</th>{['base', 'retido', 'inss', 'pgbl', 'saude'].map((field) => <td key={field}><input className="input pgbl-cell" type="number" min="0" step="0.01" value={month[field]} onChange={(event) => updateMonth(index, field, numberValue(event.target.value))} aria-label={`${field} de ${month.mes}`} /></td>)}<td>{money(data.months.slice(0, index + 1).reduce((sum, item) => sum + Number(item.pgbl || 0), 0))}</td><td>{money(data.months.slice(0, index + 1).reduce((sum, item) => sum + Number(item.saude || 0), 0))}</td></tr>)}</tbody><tfoot><tr><th>Total ano</th><th>{money(result.base)}</th><th>{money(result.retido)}</th><th>{money(result.inss)}</th><th>{money(result.pgbl)}</th><th>{money(result.saude)}</th><th>{money(result.pgbl)}</th><th>{money(result.saude)}</th></tr></tfoot></table></div></section><StatusCard result={result} /></div>}

    {view === 'resumo' && <div className="stack"><section className="card"><div className="card-head"><div><h2 className="card-title">Premissas do planejamento</h2><p className="card-sub">Ajuste os dados que influenciam sua dedução.</p></div><span className="pgbl-year">{data.year}</span></div><div className="form-grid"><Field label="Ano-calendário" value={data.year} onChange={(value) => update({ year: Number(value) || year })} step="1" /><label className="field"><span className="label">Contribui para INSS/regime próprio?</span><select className="input" value={data.premise.contribuiInss ? 'sim' : 'nao'} onChange={(event) => update({ premise: { ...data.premise, contribuiInss: event.target.value === 'sim' } })}><option value="sim">Sim</option><option value="nao">Não</option></select></label><Field label="Dependentes" value={data.premise.dependentes} onChange={(value) => update({ premise: { ...data.premise, dependentes: Math.floor(Number(value) || 0) } })} step="1" /><Field label="Educação no ano" value={data.premise.educacao} onChange={(value) => update({ premise: { ...data.premise, educacao: value } })} /></div></section><div className="grid-4"><Metric label="Base tributável" value={money(result.base)} /><Metric label="Limite PGBL (12%)" value={money(result.limite)} /><Metric label="PGBL já aportado" value={money(result.pgbl)} /><Metric label="Saúde lançada" value={money(result.saude)} /></div><section className={`card pgbl-status ${statusClass}`}><div className="pgbl-status-icon">{statusClass === 'success' ? <CircleCheck /> : <CircleAlert />}</div><div><span className="label">Análise do aporte</span><h2>{result.status}</h2><p>{result.excedente ? `Excedente não dedutível: ${money(result.excedente)}.` : result.delta ? 'Você ainda pode alcançar o limite dedutível de 12%.' : 'Você atingiu o ponto ótimo de dedução para este ano.'}</p></div></section><div className="grid-3"><Metric label="Deduções completas" value={money(result.completo)} /><Metric label="Desconto simplificado" value={money(result.simplificado)} /><Metric label="Modelo mais vantajoso" value={result.modelo} /></div><section className="card"><div className="row-between"><div><h2 className="card-title">Estimativa de imposto</h2><p className="card-sub">Uma referência para comparar com o IR retido.</p></div><strong className={result.restituicao >= 0 ? 'text-success' : 'text-danger'}>{result.restituicao >= 0 ? 'Restituição estimada' : 'Imposto a pagar'}</strong></div><div className="pgbl-estimate"><strong>{money(Math.abs(result.restituicao))}</strong><span>IR devido estimado: {money(result.ir)} · já retido: {money(result.retido)}</span></div></section></div>}

    {view === 'config' && <section className="card"><div className="card-head"><div><h2 className="card-title">Parâmetros fiscais</h2><p className="card-sub">Versionados localmente para o ano selecionado.</p></div></div><div className="form-grid"><Field label="Limite PGBL (%)" value={data.params.limitePgblPercentual * 100} onChange={(value) => update({ params: { ...data.params, limitePgblPercentual: Number(value) / 100 } })} /><Field label="Desconto simplificado (%)" value={data.params.descontoSimplificadoPercentual * 100} onChange={(value) => update({ params: { ...data.params, descontoSimplificadoPercentual: Number(value) / 100 } })} /><Field label="Teto simplificado" value={data.params.tetoDescontoSimplificado} onChange={(value) => update({ params: { ...data.params, tetoDescontoSimplificado: value } })} /><Field label="Dependente por ano" value={data.params.deducaoPorDependenteAno} onChange={(value) => update({ params: { ...data.params, deducaoPorDependenteAno: value } })} /><Field label="Educação por pessoa" value={data.params.tetoEducacaoPorPessoaAno} onChange={(value) => update({ params: { ...data.params, tetoEducacaoPorPessoaAno: value } })} /><Field label="Fonte" type="text" value={data.params.fonte} onChange={(value) => update({ params: { ...data.params, fonte: value } })} /></div><p className="pgbl-source">{data.params.fonte}</p></section>}

    {view === 'sobre' && <section className="card pgbl-copy"><h2 className="card-title">Como usar o Aporte Certo</h2><p>Informe mensalmente sua renda tributável, IR retido, INSS, aportes em PGBL e gastos de saúde. O resumo calcula o limite dedutível de 12%, compara declaração completa e simplificada e mostra uma estimativa de restituição ou imposto a pagar.</p><h3>Regras consideradas</h3><ul><li>PGBL é dedutível até 12% da renda tributável para quem contribui ao INSS ou regime próprio.</li><li>Saúde é dedutível integralmente, desde que comprovada.</li><li>A declaração simplificada usa 20% da renda, limitada ao teto informado.</li></ul><div className="notice warning"><CircleAlert size={18} /> É uma estimativa de planejamento; confirme regras e valores vigentes com um contador ou com a Receita Federal.</div></section>}
  </div>
}

function ConfigYearSelector({ years, selectedYear, onChange, onDelete }) {
  const options = Object.keys(years).map(Number).sort((a, b) => b - a)
  return <section className="card pgbl-year-selector"><div><span className="label">Ano fiscal</span><strong>Configurações do Aporte Certo</strong><p className="card-sub">Selecione o ano para editar seus parâmetros ou excluir seus dados.</p></div><div className="pgbl-year-selector-actions"><select className="input" value={selectedYear} onChange={(event) => onChange(event.target.value)} aria-label="Ano fiscal"><option value={selectedYear}>{selectedYear}</option>{options.filter((year) => year !== selectedYear).map((year) => <option key={year} value={year}>{year}</option>)}</select><button type="button" className="btn btn-sm btn-danger" onClick={onDelete}>Excluir ano</button></div></section>
}

function LocalizedPGBLTable({ data, result, onChange, onYearChange }) {
  const fields = ['base', 'retido', 'inss', 'pgbl', 'saude']
  return <div className="pgbl-localized-layout"><section className="card pgbl-table-card"><div className="card-head"><div><h2 className="card-title">Lançamentos mensais</h2><p className="card-sub">Valores em reais no padrão brasileiro.</p></div><Field label="Ano" value={data.year} onChange={onYearChange} step="1" /></div><div className="pgbl-table-wrap"><table className="pgbl-table"><thead><tr><th>Mês</th><th>Base IR</th><th>IR retido</th><th>INSS</th><th>Aporte PGBL</th><th>Saúde</th><th>PGBL acumulado</th><th>Saúde acumulada</th></tr></thead><tbody>{data.months.map((month, index) => <tr key={month.mes}><th>{month.mes.slice(0, 3)}</th>{fields.map((field) => <td key={field}><input className="input pgbl-cell" type="text" inputMode="decimal" value={formatBRInput(month[field])} onChange={(event) => onChange(index, field, parseBRInput(event.target.value))} aria-label={`${field} de ${month.mes}`} /></td>)}<td>{money(data.months.slice(0, index + 1).reduce((sum, item) => sum + toNumeric(item.pgbl), 0))}</td><td>{money(data.months.slice(0, index + 1).reduce((sum, item) => sum + toNumeric(item.saude), 0))}</td></tr>)}</tbody><tfoot><tr><th>Total ano</th><th>{money(result.base)}</th><th>{money(result.retido)}</th><th>{money(result.inss)}</th><th>{money(result.pgbl)}</th><th>{money(result.saude)}</th><th>{money(result.pgbl)}</th><th>{money(result.saude)}</th></tr></tfoot></table></div></section><StatusCard result={result} /></div>
}

function StableTransposedPGBLTable({ data, result, onChange, onYearChange }) {
  const fields = [['base', 'Base IR'], ['retido', 'IR retido'], ['inss', 'INSS'], ['pgbl', 'Aporte PGBL'], ['saude', 'Saúde'], ['educacao', 'Educação']]
  return <div className="pgbl-localized-layout"><StatusCard result={result} /><section className="card pgbl-table-card"><div className="card-head"><div><h2 className="card-title">Lançamentos mensais</h2><p className="card-sub">Valores em reais no padrão brasileiro.</p></div><Field label="Ano" value={data.year} onChange={onYearChange} step="1" /></div><div className="pgbl-table-wrap"><table className="pgbl-table pgbl-table-transposed"><thead><tr><th>Item</th>{data.months.map((month) => <th key={month.mes}>{month.mes.slice(0, 3)}</th>)}<th>Total geral</th></tr></thead><tbody>{fields.map(([field, label]) => <tr key={field}><th>{label}</th>{data.months.map((month, index) => <td key={month.mes}><PGBLAmountInput value={month[field]} onChange={(value) => onChange(index, field, value)} label={`${label} de ${month.mes}`} /></td>)}<td>{money(data.months.reduce((sum, month) => sum + toNumeric(month[field]), 0))}</td></tr>)}</tbody></table></div></section></div>
}

function TransposedPGBLTable({ data, result, onChange, onYearChange }) {
  const fields = [['base', 'Base IR'], ['retido', 'IR retido'], ['inss', 'INSS'], ['pgbl', 'Aporte PGBL'], ['saude', 'Saúde'], ['educacao', 'Educação']]
  return <div className="pgbl-localized-layout"><StatusCard result={result} /><section className="card pgbl-table-card"><div className="card-head"><div><h2 className="card-title">Lançamentos mensais</h2><p className="card-sub">Valores em reais no padrão brasileiro.</p></div><Field label="Ano" value={data.year} onChange={onYearChange} step="1" /></div><div className="pgbl-table-wrap"><table className="pgbl-table pgbl-table-transposed"><thead><tr><th>Item</th>{data.months.map((month) => <th key={month.mes}>{month.mes.slice(0, 3)}</th>)}<th>Total geral</th></tr></thead><tbody>{fields.map(([field, label]) => <tr key={field}><th>{label}</th>{data.months.map((month, index) => <td key={month.mes}><input className="input pgbl-cell" type="text" inputMode="decimal" value={formatBRInput(month[field])} onChange={(event) => onChange(index, field, parseBRInput(event.target.value))} aria-label={`${label} de ${month.mes}`} /></td>)}<td>{money(data.months.reduce((sum, month) => sum + toNumeric(month[field]), 0))}</td></tr>)}</tbody><tfoot><tr><th>Total geral</th>{data.months.map((month, index) => <th key={month.mes}>{money(fields.reduce((sum, [field]) => sum + toNumeric(month[field]), 0))}</th>)}<th>{money(result.base + result.retido + result.inss + result.pgbl + result.saude)}</th></tr></tfoot></table></div></section></div>
}

function Metric({ label, value }) { return <div className="card pgbl-metric"><span className="label">{label}</span><strong>{value}</strong></div> }
function StatusCard({ result }) { return <aside className={`card pgbl-status ${result.excedente ? 'danger' : result.delta ? 'warning' : 'success'}`}><span className="label">Status rápido</span><h2>{result.status}</h2><p>Base: {money(result.base)}</p><p>Limite: {money(result.limite)}</p><p>Saúde: {money(result.saude)}</p></aside> }
