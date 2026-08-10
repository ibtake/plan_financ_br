import { supabase } from './supabase.js'

const widgetUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/widget-data`
const appUrl = typeof window !== 'undefined' ? window.location.origin : ''

function scriptFor(code) {
  return `const API = ${JSON.stringify(widgetUrl)}
const APP_URL = ${JSON.stringify(appUrl)}
const ICON_URL = APP_URL + '/dindin-10-logo.png'
const INSTALL_CODE = ${JSON.stringify(code)}
const TOKEN_KEY = 'dindin-widget-token-v2'
const ICON_PATH = FileManager.local().joinPath(FileManager.local().documentsDirectory(), 'dindin-10-widget.png')

async function load() {
  async function requestData(token) {
    const request = new Request(API)
    request.method = 'POST'
    request.headers = { 'Content-Type': 'application/json' }
    if (token) request.headers.Authorization = 'Bearer ' + token
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
  const result = response.data
  if (result.token) Keychain.set(TOKEN_KEY, result.token)
  if (!Array.isArray(result.bills)) {
    const detail = result?.error || result?.message || JSON.stringify(result)
    throw new Error('API ' + response.status + ': ' + detail)
  }
  const widget = new ListWidget()
  widget.backgroundColor = new Color('#101827')
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
    icon.imageSize = new Size(24, 24)
    icon.cornerRadius = 6
    header.addSpacer(8)
  }
  const title = header.addText(result.bills.length ? 'Contas que vencem hoje' : 'Nada vence hoje')
  title.textColor = Color.white(); title.font = Font.boldSystemFont(16)
  widget.addSpacer(8)
  for (const bill of result.bills.slice(0, 5)) {
    const row = widget.addText(bill.description + '  ' + bill.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
    row.textColor = Color.white(); row.font = Font.systemFont(12)
  }
  if (result.bills.length > 5) widget.addText('+' + (result.bills.length - 5) + ' conta(s)')
  widget.addSpacer()
  const total = widget.addText('Total: ' + Number(result.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
  total.textColor = new Color('#93c5fd'); total.font = Font.boldSystemFont(14)
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
