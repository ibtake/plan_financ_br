#!/usr/bin/env python3
"""
Le o JSON gerado pelo osv-scanner, envia os achados em UM UNICO lote para
um LLM (endpoint compativel com a API de chat completions no formato
OpenAI: POST {LLM_API_BASE}/chat/completions) para classificar prioridade
e sugerir acao manual, e escreve o relatorio final:

  - no stdout (fica gravado no log bruto do step da Action)
  - no arquivo apontado por $GITHUB_STEP_SUMMARY (aparece na aba "Summary"
    da execucao)

Nada e escrito no repositorio. Se a chamada de IA falhar ou devolver algo
que nao seja o JSON esperado, os achados deterministicos do osv-scanner
NUNCA sao descartados -- eles sempre aparecem no relatorio, com ou sem IA.

Secrets esperadas no ambiente:
  LLM_API_BASE  -> ex: https://minha-api.exemplo.com/v1
  LLM_API_KEY   -> token Bearer
  STRIX_LLM     -> nome do modelo
"""
import json
import logging
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

MAX_FINDINGS_FOR_AI = 150  # protecao contra prompt gigante / custo alto


def load_osv_results(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Aviso: nao foi possivel ler '{path}' ({e}). Tratando como scan vazio.")
        return {"results": []}


def extract_findings(osv_json):
    """Achata e deduplica o JSON do osv-scanner numa lista compacta."""
    findings = []
    seen = set()
    for result in osv_json.get("results", []):
        source_info = result.get("source") or {}
        source = source_info.get("path", "desconhecido")
        for pkg in result.get("packages", []):
            package_info = pkg.get("package", {})
            component = package_info.get("name", "desconhecido")
            ecosystem = package_info.get("ecosystem", "desconhecido")
            installed_version = package_info.get("version", "desconhecida")

            for vuln in pkg.get("vulnerabilities", []):
                advisory_id = vuln.get("id", "desconhecido")
                key = (component, installed_version, advisory_id)
                if key in seen:
                    continue
                seen.add(key)

                severity = "desconhecida"
                for sev in vuln.get("severity", []) or []:
                    if sev.get("type") == "CVSS_V3":
                        severity = sev.get("score", severity)
                        break

                fixed_versions = set()
                for affected in vuln.get("affected", []) or []:
                    for r in affected.get("ranges", []) or []:
                        for ev in r.get("events", []) or []:
                            if "fixed" in ev:
                                fixed_versions.add(ev["fixed"])

                reference = next(
                    (r.get("url") for r in vuln.get("references", []) or [] if r.get("url")),
                    None,
                )

                findings.append({
                    "source_file": source,
                    "ecosystem": ecosystem,
                    "component": component,
                    "installed_version": installed_version,
                    "advisory_id": advisory_id,
                    "severity": severity,
                    "fixed_versions": sorted(fixed_versions) or None,
                    "summary": (vuln.get("summary") or vuln.get("details") or "")[:300],
                    "reference": reference,
                })
    return findings


def build_prompt(findings):
    system_prompt = (
        "Voce e um analista de seguranca de aplicacoes. Voce recebera uma lista "
        "de achados de vulnerabilidades JA CONFIRMADOS deterministicamente "
        "(a versao instalada esta dentro do intervalo afetado do advisory). "
        "Sua tarefa e, para cada achado: classificar se e realmente aplicavel "
        "ao contexto de um app web (React/Vite + Supabase + Edge Functions), "
        "atribuir uma prioridade, explicar o impacto em 1-2 frases e sugerir "
        "uma acao manual objetiva (ex: 'atualizar para X.Y.Z'). "
        "NUNCA sugira correcao automatica, abertura de PR automatico ou deploy. "
        "Responda SOMENTE com um JSON valido, sem markdown, sem texto antes ou "
        "depois, no formato exato:\n\n"
        '{"findings": [{"advisory": "...", "component": "...", '
        '"classification": "aplicavel|nao_aplicavel|incerto", '
        '"priority": "critica|alta|media|baixa|informativa", '
        '"reason": "...", "recommended_action": "...", "confidence": 0.0}]}'
    )
    user_prompt = json.dumps({"findings": findings}, ensure_ascii=False)
    return system_prompt, user_prompt


def call_llm(system_prompt, user_prompt):
    base = os.environ["LLM_API_BASE"].rstrip("/")
    api_key = os.environ["LLM_API_KEY"]
    model = os.environ["STRIX_LLM"]

    url = f"{base}/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    return body["choices"][0]["message"]["content"]


def parse_ai_output(raw_text):
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
        text = text.strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and "findings" in parsed:
            return parsed["findings"]
    except json.JSONDecodeError:
        pass
    return None


def write_report(findings, ai_findings, scanned_at):
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    lines = [f"# Relatorio de vulnerabilidades - {scanned_at}\n"]

    if not findings:
        lines.append("Nenhuma vulnerabilidade correspondente encontrada nesta execucao.\n")
    else:
        lines.append(f"**{len(findings)}** achado(s) deterministico(s) do osv-scanner.\n")

        if ai_findings:
            lines.append("| Prioridade | Componente | Advisory | Classificacao | Confianca | Acao recomendada |")
            lines.append("|---|---|---|---|---|---|")
            order = {"critica": 0, "alta": 1, "media": 2, "baixa": 3, "informativa": 4}
            ai_sorted = sorted(ai_findings, key=lambda f: order.get(f.get("priority", "informativa"), 5))
            for f in ai_sorted:
                lines.append(
                    f"| {f.get('priority', '?')} | {f.get('component', '?')} | "
                    f"{f.get('advisory', '?')} | {f.get('classification', '?')} | "
                    f"{f.get('confidence', '?')} | {f.get('recommended_action', '?')} |"
                )
            lines.append("\n<details><summary>Motivo de cada classificacao</summary>\n")
            for f in ai_sorted:
                lines.append(f"- **{f.get('advisory', '?')} / {f.get('component', '?')}**: {f.get('reason', '')}")
            lines.append("\n</details>\n")
        else:
            lines.append(
                "_A classificacao por IA falhou ou retornou um formato invalido. "
                "Nada foi perdido: veja os achados deterministicos brutos abaixo._\n"
            )

        lines.append("\n<details><summary>Achados deterministicos brutos (osv-scanner)</summary>\n")
        lines.append("```json")
        lines.append(json.dumps(findings, indent=2, ensure_ascii=False))
        lines.append("```")
        lines.append("</details>\n")

    content = "\n".join(lines)
    print(content)  # vai para o log bruto do step

    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as f:
            f.write(content + "\n")
    else:
        print("Aviso: $GITHUB_STEP_SUMMARY nao definido (rodando fora do Actions?).")


def main():
    if len(sys.argv) < 2:
        print("uso: analyze.py <osv-results.json>", file=sys.stderr)
        sys.exit(1)

    osv_json = load_osv_results(sys.argv[1])
    findings = extract_findings(osv_json)
    scanned_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    if not findings:
        write_report([], None, scanned_at)
        return

    findings_for_ai = findings
    if len(findings) > MAX_FINDINGS_FOR_AI:
        print(f"Aviso: {len(findings)} achados; limitando a {MAX_FINDINGS_FOR_AI} na chamada de IA.")
        findings_for_ai = findings[:MAX_FINDINGS_FOR_AI]

    ai_findings = None
    try:
        system_prompt, user_prompt = build_prompt(findings_for_ai)
        raw = call_llm(system_prompt, user_prompt)
        ai_findings = parse_ai_output(raw)
        if ai_findings is None:
            print("Aviso: resposta da IA nao era o JSON esperado. Mantendo achados deterministicos.")
    except KeyError as e:
        logging.warning("Secret ausente; pulando classificacao por IA: %s", e)
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        logging.warning("Chamada a IA falhou; mantendo achados deterministicos: %s", e)
    except Exception:
        logging.exception("Erro inesperado na etapa de IA; mantendo achados deterministicos")

    write_report(findings, ai_findings, scanned_at)


if __name__ == "__main__":
    main()
