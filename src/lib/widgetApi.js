import { supabase } from './supabase.js'

const widgetUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/widget-data`
const appUrl = typeof window !== 'undefined' ? window.location.origin : ''

function scriptFor(code) {
  return `const API = ${JSON.stringify(widgetUrl)}
const APP_URL = ${JSON.stringify(appUrl)}
const ICON_URL = APP_URL + '/dindin-10-logo.png'
const INSTALL_CODE = ${JSON.stringify(code)}
const TOKEN_KEY = 'dindin-widget-token-v3'
const ICON_PATH = FileManager.local().joinPath(FileManager.local().documentsDirectory(), 'dindin-10-widget.png')

async function load() {
  async function requestData(token) {
    const request = new Request(API)
    request.method = 'POST'
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['X-Widget-Token'] = token
    request.headers = headers
    request.body = JSON.stringify(token ? {} : { code: INSTALL_CODE })
    try {
      return { data: await request.loadJSON(), status: request.response?.statusCode || 0 }
    } catch (error) {
      throw new Error('Falha HTTP ' + (request.response?.statusCode || '?') + ': ' + error.message)
    }
  }
  let token = Keychain.contains(TOKEN_KEY) ? Keychain.get(TOKEN_KEY) : null
  if (!config.runsInWidget && !token) {
    const widget = new ListWidget()
    widget.backgroundColor = new Color('#101827')
    const message = widget.addText('Widget pronto para instalar')
    message.textColor = Color.white()
    message.font = Font.boldSystemFont(16)
    widget.addSpacer(6)
    const detail = widget.addText('Adicione este script à tela inicial para concluir a ativação.')
    detail.textColor = new Color('#cbd5e1')
    detail.font = Font.systemFont(12)
    detail.minimumScaleFactor = 0.8
    Script.setWidget(widget)
    Script.complete()
    return
  }
  let response = await requestData(token)
  if (token && response.status === 401) {
    Keychain.remove(TOKEN_KEY)
    response = await requestData(null)
  }
  const result = response.data
  if (result.token) Keychain.set(TOKEN_KEY, result.token)
  if (!Array.isArray(result.bills)) {
    const detail = result?.error || result?.message || JSON.stringify(result)
    throw new Error('API ' + response.status + ': ' + detail)
  }
  const widget = new ListWidget()
  const background = new LinearGradient()
  background.colors = [new Color('#0b1220'), new Color('#16243a')]
  background.locations = [0, 1]
  widget.backgroundGradient = background
  widget.setPadding(12, 14, 12, 14)
  const header = widget.addStack()
  header.centerAlignContent()
  const files = FileManager.local()
  if (!files.fileExists(ICON_PATH)) {
    try {
      const iconRequest = new Request(ICON_URL)
      files.writeImage(ICON_PATH, await iconRequest.loadImage())
    } catch (_) {}
  }
  if (files.fileExists(ICON_PATH)) {
    const icon = header.addImage(files.readImage(ICON_PATH))
    icon.imageSize = new Size(26, 26)
    icon.cornerRadius = 7
    header.addSpacer(7)
  }
  const heading = header.addStack()
  heading.layoutVertically()
  const eyebrow = heading.addText('DIN DIN 10')
  eyebrow.textColor = new Color('#93c5fd'); eyebrow.font = Font.semiboldSystemFont(9)
  const title = heading.addText(result.bills.length ? 'Contas de hoje' : 'Tudo em dia')
  title.textColor = Color.white(); title.font = Font.boldSystemFont(16)
  header.addSpacer()
  const count = header.addStack()
  count.backgroundColor = new Color('#243653')
  count.cornerRadius = 10
  count.setPadding(5, 8, 5, 8)
  const countText = count.addText(String(result.bills.length))
  countText.textColor = new Color('#bfdbfe'); countText.font = Font.boldSystemFont(13)
  widget.addSpacer(10)

  const summary = widget.addStack()
  summary.backgroundColor = new Color('#1d2c45')
  summary.cornerRadius = 12
  summary.setPadding(8, 10, 8, 10)
  const summaryLabel = summary.addText(result.bills.length ? 'A vencer hoje' : 'Nenhuma conta pendente')
  summaryLabel.textColor = new Color('#bfdbfe'); summaryLabel.font = Font.mediumSystemFont(11)
  summary.addSpacer()
  const summaryTotal = summary.addText(Number(result.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
  summaryTotal.textColor = Color.white(); summaryTotal.font = Font.boldSystemFont(13)

  widget.addSpacer(8)
  const maxBills = config.widgetFamily === 'small' ? 2 : config.widgetFamily === 'large' ? 6 : 4
  for (const bill of result.bills.slice(0, maxBills)) {
    const row = widget.addStack()
    row.backgroundColor = new Color('#142238')
    row.cornerRadius = 9
    row.setPadding(7, 9, 7, 9)
    const marker = row.addText('•')
    marker.textColor = new Color('#60a5fa'); marker.font = Font.boldSystemFont(15)
    row.addSpacer(6)
    const name = row.addText(String(bill.description).slice(0, 26))
    name.textColor = new Color('#e5edf8'); name.font = Font.mediumSystemFont(11)
    name.lineLimit = 1
    row.addSpacer()
    const amount = row.addText(Number(bill.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
    amount.textColor = Color.white(); amount.font = Font.semiboldSystemFont(11)
    widget.addSpacer(4)
  }
  if (result.bills.length > maxBills) {
    const more = widget.addText('+' + (result.bills.length - maxBills) + ' outra(s)')
    more.textColor = new Color('#93a4bb'); more.font = Font.systemFont(10)
  }
  widget.addSpacer()
  const footer = widget.addStack()
  footer.centerAlignContent()
  const footerLabel = footer.addText('TOTAL DO DIA')
  footerLabel.textColor = new Color('#93a4bb'); footerLabel.font = Font.boldSystemFont(9)
  footer.addSpacer()
  const total = footer.addText(Number(result.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
  total.textColor = new Color('#93c5fd'); total.font = Font.boldSystemFont(15)
  widget.url = APP_URL
  widget.refreshAfterDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
  Script.setWidget(widget)
  Script.complete()
}

await load()`
}

export async function createWidgetSetup() {
  const { data, error } = await supabase.functions.invoke('widget-setup', { body: {} })
  if (error || !data?.code) throw new Error('Não foi possível iniciar a configuração do widget.')
  return scriptFor(data.code)
}

export async function revokeWidget() {
  const { error } = await supabase.functions.invoke('widget-setup', { body: { action: 'revoke' } })
  if (error) throw new Error('Não foi possível revogar o widget.')
}

export async function getWidgetStatus() {
  const { data, error } = await supabase.functions.invoke('widget-setup', { body: { action: 'status' } })
  if (error) throw new Error('Não foi possível consultar os widgets.')
  return data?.tokens || []
}
