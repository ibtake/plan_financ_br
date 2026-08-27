// =====================================================================
// Leitura completa de uma tabela, pagina por pagina
// =====================================================================
//
// O PostgREST limita quantas linhas cabem em uma resposta (max_rows). Esse
// numero vive no painel do projeto hospedado, nao neste repositorio - o codigo
// nao tem como ler nem declarar (config.toml e do CLI local e nao configura o
// projeto hospedado). Quando o teto corta, a resposta vem 200 OK, com a lista
// truncada e SEM erro: totais somados sobre um subconjunto, e exportData
// (useFinanceDataManagement.js:48) gerando backup incompleto que parece completo.
// Como replace_my_data apaga as linhas do usuario antes de reinserir o payload,
// exportar e reimportar descartaria de vez o que a carga nao trouxe.
//
// A armadilha: parar quando `data.length < pageSize` volta a truncar exatamente
// no caso que importa. Teto menor que o pageSize faz a PRIMEIRA pagina chegar
// curta, e o laco encerra achando que acabou. Por isso o criterio e o `count`
// do servidor - que ignora o teto - e o inicio da proxima pagina e o total ja
// acumulado, nunca `pagina x pageSize`: com teto de 500 e pageSize de 1000,
// avancar de mil em mil pularia as linhas 500-999 de cada bloco.

// Teto de voltas. Sem ele, um servidor que ignorasse o `range` devolveria
// pagina cheia para sempre e travaria a aba. 100 x 1000 linhas esta uma ordem
// de grandeza acima de qualquer conta pessoal; estourar virou erro, nao
// resultado parcial.
const MAX_PAGES = 100

/**
 * Junta todas as paginas de uma leitura.
 *
 * @param fetchPage (from, to) => Promise<{ data, error, count }> - a assinatura
 *   que o supabase-js ja devolve. Peca `select(cols, { count: 'exact' })` e
 *   `.range(from, to)`, senao nao ha como saber onde a lista termina.
 * @returns {{ data, error, count }} no mesmo formato, para o chamador nao
 *   precisar saber que houve paginacao.
 */
export async function selectAllPages(fetchPage, pageSize = 1000) {
  const rows = []
  let total = null
  let done = false
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = rows.length
    const { data, error, count } = await fetchPage(from, from + pageSize - 1)
    // Falha em qualquer pagina invalida a leitura inteira: devolver o que ja
    // veio seria o truncamento silencioso que esta funcao existe para evitar.
    // Quem chama trata como erro de leitura e preserva os ultimos dados bons.
    if (error) return { data: null, error, count: null }
    if (page === 0) total = Number.isFinite(count) ? count : null
    const batch = data || []
    // Pagina vazia e fim legitimo - o servidor disse que nao ha mais. E tambem
    // o unico criterio disponivel quando `count` nao veio, ao custo de uma
    // requisicao vazia no fim daquela leitura.
    if (!batch.length) { done = true; break }
    rows.push(...batch)
    // No caso comum (poucas linhas, tudo em uma resposta) o laco termina aqui,
    // na primeira volta: uma requisicao, igual a antes de paginar.
    if (total !== null && rows.length >= total) { done = true; break }
  }
  if (!done) {
    return {
      data: null,
      error: { message: `Leitura interrompida: ${rows.length} de ${total} registros.` },
      count: total,
    }
  }
  return { data: rows, error: null, count: total }
}
