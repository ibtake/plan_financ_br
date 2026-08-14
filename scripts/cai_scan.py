#!/usr/bin/env python3
"""
cai_scan.py
-----------
Executa uma varredura de segurança completa usando o framework CAI
(Cybersecurity AI - https://github.com/aliasrobotics/cai) de forma
NÃO interativa, adequada para rodar em CI/CD (GitHub Actions).

Pipeline de 3 agentes:
  1. Recon Agent        -> reconhecimento (nmap, whatweb, headers, etc.)
  2. Vuln Analysis Agent -> analisa a saída do recon e identifica riscos
  3. Report Agent        -> consolida tudo em um relatório Markdown

Variáveis de ambiente esperadas (já mapeadas no workflow a partir dos
secrets do repositório):
  OPENAI_API_KEY   -> vem do secret LLM_API_KEY
  OPENAI_BASE_URL  -> vem do secret LLM_API_BASE (endpoint custom/proxy)
  CAI_MODEL        -> vem do secret STRIX_LLM (nome do modelo)

Variáveis de execução:
  TARGET           -> alvo autorizado da varredura (obrigatório)
  MAX_TURNS        -> limite de turnos por agente (default: 30)
  OUTPUT_DIR       -> pasta onde o relatório será salvo (default: ./reports)

⚠️  USO AUTORIZADO APENAS. Só rode contra alvos que você possui ou tem
    permissão explícita e por escrito para testar.
"""

import asyncio
import os
import sys
import textwrap
from datetime import datetime, timezone
from pathlib import Path

from openai import AsyncOpenAI

from cai.sdk.agents import Agent, Runner, OpenAIChatCompletionsModel
from cai.tools.reconnaissance.generic_linux_command import generic_linux_command
from cai.util import create_system_prompt_renderer


def get_model() -> OpenAIChatCompletionsModel:
    """Constrói o modelo apontando para o endpoint/modelo definidos via secrets."""
    model_name = os.environ.get("CAI_MODEL")
    if not model_name:
        sys.exit("ERRO: variável CAI_MODEL (secret STRIX_LLM) não definida.")

    # AsyncOpenAI já lê OPENAI_API_KEY e OPENAI_BASE_URL do ambiente
    # automaticamente, mas deixamos explícito para clareza e para
    # funcionar com endpoints custom/proxy compatíveis com OpenAI.
    client = AsyncOpenAI(
        api_key=os.environ.get("OPENAI_API_KEY"),
        base_url=os.environ.get("OPENAI_BASE_URL") or None,
    )
    return OpenAIChatCompletionsModel(model=model_name, openai_client=client)


def build_agents(target: str) -> tuple[Agent, Agent, Agent]:
    model = get_model()

    recon_instructions = f"""
    Você é um agente de reconhecimento de segurança ofensiva autorizado.
    Alvo autorizado para este teste: {target}

    Use a ferramenta generic_linux_command para:
      - Identificar hosts/portas abertas (ex: nmap -sV -Pn --top-ports 200)
      - Coletar banners e tecnologias web (ex: whatweb, curl -I)
      - Enumerar diretórios/endpoints óbvios de forma NÃO destrutiva
      - Verificar cabeçalhos de segurança HTTP (CSP, HSTS, X-Frame-Options etc.)

    Regras:
      - NUNCA execute ataques destrutivos, DoS, brute force pesado ou
        qualquer ação que possa derrubar o serviço.
      - NUNCA extrapole o escopo do alvo informado.
      - Registre TODOS os comandos executados e suas saídas relevantes.
      - Ao final, produza um resumo estruturado dos achados brutos
        (serviços, versões, tecnologias, cabeçalhos, possíveis pontos fracos).
    """

    vuln_instructions = """
    Você é um analista de vulnerabilidades sênior. Você recebe os achados
    brutos de reconhecimento e deve:
      1. Cruzar serviços/versões identificados com vulnerabilidades
         conhecidas (CVEs, más configurações comuns, OWASP Top 10).
      2. Classificar cada achado por severidade: Crítica / Alta / Média /
         Baixa / Informativa.
      3. Indicar o nível de confiança (Confirmado / Provável / Suspeita)
         já que não há exploração ativa nesta etapa.
      4. Sugerir remediação objetiva para cada achado.
      5. NÃO invente CVEs. Se não tiver certeza, marque como "requer
         validação manual" em vez de afirmar categoricamente.
    """

    report_instructions = """
    Você é responsável por consolidar a análise em um relatório final em
    Markdown, pronto para ser lido por um time de engenharia. Estrutura:

    # Relatório de Varredura de Segurança - CAI
    ## Resumo Executivo (3-5 linhas, tom direto)
    ## Alvo e Escopo
    ## Achados por Severidade (tabela: Severidade | Achado | Confiança | Recomendação)
    ## Detalhes Técnicos
    ## Próximos Passos Recomendados

    Seja conciso, objetivo e evite alarmismo. Se nada relevante for
    encontrado, diga isso claramente.
    """

    recon_agent = Agent(
        name="Recon Agent",
        description="Reconhecimento ofensivo não destrutivo",
        instructions=create_system_prompt_renderer(textwrap.dedent(recon_instructions)),
        tools=[generic_linux_command],
        model=model,
    )

    vuln_agent = Agent(
        name="Vuln Analysis Agent",
        description="Análise e classificação de vulnerabilidades",
        instructions=create_system_prompt_renderer(textwrap.dedent(vuln_instructions)),
        model=model,
    )

    report_agent = Agent(
        name="Report Agent",
        description="Geração do relatório final em Markdown",
        instructions=create_system_prompt_renderer(textwrap.dedent(report_instructions)),
        model=model,
    )

    return recon_agent, vuln_agent, report_agent


async def run_pipeline(target: str, max_turns: int) -> str:
    recon_agent, vuln_agent, report_agent = build_agents(target)

    print(f"==> [1/3] Reconhecimento em: {target}")
    recon_result = await Runner.run(
        recon_agent,
        f"Execute o reconhecimento completo no alvo autorizado: {target}",
        max_turns=max_turns,
    )
    recon_output = recon_result.final_output
    print("==> Reconhecimento concluído.\n")

    print("==> [2/3] Análise de vulnerabilidades")
    vuln_result = await Runner.run(
        vuln_agent,
        f"Aqui estão os achados de reconhecimento do alvo {target}:\n\n"
        f"{recon_output}\n\nAnalise e classifique os riscos.",
        max_turns=max_turns,
    )
    vuln_output = vuln_result.final_output
    print("==> Análise concluída.\n")

    print("==> [3/3] Geração do relatório final")
    report_result = await Runner.run(
        report_agent,
        f"Alvo: {target}\n\n"
        f"### Achados brutos de recon:\n{recon_output}\n\n"
        f"### Análise de vulnerabilidades:\n{vuln_output}\n\n"
        f"Gere o relatório final em Markdown seguindo a estrutura definida.",
        max_turns=max_turns,
    )
    print("==> Relatório gerado.\n")

    return report_result.final_output


def main():
    target = os.environ.get("TARGET")
    if not target:
        sys.exit("ERRO: variável TARGET não definida. Informe o alvo autorizado.")

    max_turns = int(os.environ.get("MAX_TURNS", "30"))
    output_dir = Path(os.environ.get("OUTPUT_DIR", "./reports"))
    output_dir.mkdir(parents=True, exist_ok=True)

    report_md = asyncio.run(run_pipeline(target, max_turns))

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%SUTC")
    report_path = output_dir / f"cai_report_{timestamp}.md"
    report_path.write_text(report_md, encoding="utf-8")

    print(f"\nRelatório salvo em: {report_path}")

    # Também escreve no Job Summary do GitHub Actions, se disponível
    summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_file:
        with open(summary_file, "a", encoding="utf-8") as f:
            f.write(report_md)
            f.write("\n")


if __name__ == "__main__":
    main()
