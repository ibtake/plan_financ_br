// Portao da bancada de medicao da Fase 0 (IMPR-010). Mora aqui, e nao dentro do
// componente, porque `node --test` nao carrega JSX: o gate decide se uma tela de
// diagnostico fica alcancavel, entao precisa de teste proprio.
//
// O criterio e o sufixo do host - homologacao termina em "-qa" antes do dominio,
// producao nao. Sem hostname literal no repositorio (o repo e publico).
//
// ponytail: sai junto com a bancada quando a Fase 0 fechar.

/** Verdadeiro so no host de homologacao. */
export function isHomologacaoHost(hostname) {
  return /-qa\./.test(String(hostname ?? ''))
}
