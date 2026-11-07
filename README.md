# RZ Airsoft — gestão da oficina

**Português** · [English](README.en.md)

Sistema da oficina RZ Airsoft: ordens de serviço, quadro da bancada, relatório técnico em PDF, clientes, catálogo de serviços e preços, banner de divulgação e painel de faturamento.

Roda neste computador, com login e senha. Os dados ficam em `dados/cloud/`, pasta que o OneDrive sincroniza. Dá para abrir de qualquer lugar pelo navegador, com o atalho de internet.

A interface está em português (padrão) e inglês: troque na tela de login, no menu do usuário ou em Configurações › Aparência. A escolha fica salva em cada navegador. Vale também para os PDFs, planilhas e mensagens de WhatsApp gerados a partir daí.

## Como abrir

1. Dê dois cliques em **`INICIAR_RZ_WEB.bat`**.
2. Na primeira vez, crie o usuário e uma senha (mínimo de 8 caracteres; uma frase longa é melhor).
3. O navegador abre o **Painel**. Deixe a janela preta do servidor aberta enquanto trabalha (`Ctrl+C` encerra).

Se o sistema já estiver aberto, o atalho só abre o navegador nele. A porta padrão é `8765` (se estiver ocupada, usa `8766` ou `8767`).

**Instalar como aplicativo:** no Chrome ou no Edge, clique no ícone de instalar na barra de endereço. O RZ Airsoft ganha janela e ícone próprios na barra de tarefas.

## Esqueci a senha

No computador da oficina, dê dois cliques em **`REDEFINIR_SENHA.bat`** e digite a nova senha duas vezes (aparecem só asteriscos). Funciona com o sistema aberto ou fechado; todas as sessões abertas saem e você entra de novo com a senha nova. Os dados não são tocados.

Pelo terminal: `python server\app.py --reset-password` (ou `--reset-password nome-do-usuario`).

## De qualquer lugar

1. Dê dois cliques em **`INICIAR_RZ_INTERNET.bat`** (precisa de `tools\cloudflared.exe`).
2. O endereço `https://….trycloudflare.com` aparece na janela e em **Configurações › Acesso remoto**.
3. Abra esse endereço em outro computador ou no celular e entre com o mesmo usuário e senha.

Este computador precisa ficar ligado. O link muda a cada abertura e não deve ser compartilhado. Não abra a porta 8765 no roteador: o túnel já resolve. Depois de usar um computador de terceiros, use **Encerrar as outras sessões** em Configurações › Conta e segurança.

Dois aparelhos podem editar ao mesmo tempo: o sistema busca as alterações a cada poucos segundos e, se a mesma OS mudou nos dois, junta os campos. Sem conexão, as alterações ficam guardadas no navegador e sobem sozinhas quando o servidor volta (o indicador no topo mostra "Offline · N pendentes").

## Telas

| Tela | O que faz |
|---|---|
| **Painel** | Faturamento do mês e dos últimos 12 meses, valores a receber, OS em aberto, ganho médio de FPS, prontas para retirada (com aviso no WhatsApp), próximas entregas e serviços mais feitos. |
| **Ordens de serviço** | Lista com busca, filtros (status, pagamento, período, com relatório), ordenação, seleção em massa e exportação em CSV ou PDF. Alterna para o **quadro** da bancada: arraste a OS entre *Na fila → Na bancada → Aguardando peças → Pronto → Entregue*. |
| **OS (detalhe)** | Equipamento, problema relatado, serviços e peças (com busca no catálogo), desconto e total, FPS antes/depois com BB 0.20/0.28/0.32 e joules calculados, pagamento, datas, garantia, observações internas e histórico. |
| **Relatório técnico** | Formulário com prévia ao vivo do PDF A4 paisagem na identidade escura/dourada: identificação, desempenho, diagnóstico, serviços realizados, até 6 fotos (arraste, cole ou use a câmera do celular) e parecer. |
| **Clientes** | Cadastro com WhatsApp, Instagram, cidade, notas e equipamentos; valor pago, última visita e histórico de OS de cada cliente. |
| **Serviços e preços** | Catálogo por categorias, usado para lançar itens na OS e para gerar a tabela em PDF. |
| **Marketing** | Banner 1080 × 1350 (4:5) editável, em PDF ou PNG para Instagram e WhatsApp. |
| **Configurações** | Dados da oficina (aparecem nos documentos), padrões da OS e termos de garantia, conta e senha, tema e idioma, dados e backup, acesso remoto. |

**Documentos:** relatório técnico (A4 paisagem), ordem de serviço com itens, total, garantia e assinaturas (A4 retrato), lista de OS (A4 paisagem, paginada), tabela de serviços (A4 retrato) e banner. Cada um pode ser baixado em PDF ou mandado para a impressora.

**Atalhos de teclado:** `Ctrl+K` busca qualquer coisa (telas, ações, OS, clientes) · `N` nova OS · `G` depois `D/O/C/S` vai para Painel, Ordens, Clientes, Serviços · `[` recolhe a barra lateral · `?` mostra todos.

## Onde os dados ficam

- `dados/cloud/db/` — ordens, clientes, catálogo e configurações (JSON).
- `dados/cloud/files/` — fotos dos relatórios (já reduzidas antes do envio).
- `dados/cloud/backups/db/` — cópias automáticas a cada 10 minutos de uso.
- `dados/cloud/.auth.json` — usuário e hash da senha. `dados/cloud/.secret` — chave das sessões. Não apague nenhum dos dois.

**Backup completo:** Configurações › Dados e backup › **Baixar backup (.zip)**. Restaurar um .zip substitui os dados atuais; antes disso o sistema guarda uma cópia do estado atual em `dados/cloud/backups/completo/`.

Os dados da oficina não vão para o GitHub (estão no `.gitignore`).

## Vindo da versão anterior

Na primeira abertura, o sistema importa sozinho o que a versão anterior tinha gravado na pasta `dados/cloud/` e no navegador: controle de manutenções, relatórios (com as fotos), clientes, status das OS, catálogo e tema. Cada navegador que tinha dados antigos importa os seus uma vez, sem duplicar. Os arquivos antigos não são apagados.

Arquivos `.json` baixados pela versão anterior (Controle, Histórico, Serviços ou um relatório) também podem ser importados em Configurações › Dados e backup.

Os endereços antigos (`controle.html`, `historico.html`, …) redirecionam para as telas novas.

## Trocar a logo

Substitua `web/assets/logo-original.png` e rode (precisa do Pillow):

```powershell
python -m pip install pillow
python process_logo.py
```

## Para quem for mexer no código

Sem etapa de build e sem dependências: o servidor usa só a biblioteca padrão do Python 3, e o app é HTML, CSS e JavaScript com módulos ES nativos. `html2canvas` e `jsPDF` ficam em `web/vendor/` (carregados só ao gerar PDF).

```text
relatorio-tecnico-rz-airsoft/
├── INICIAR_RZ_WEB.bat        abre o sistema neste computador
├── INICIAR_RZ_INTERNET.bat   abre também o endereço público (cloudflared)
├── REDEFINIR_SENHA.bat       troca a senha pelo terminal (esqueci a senha)
├── server/
│   ├── app.py                linha de comando: --port, --data-dir, --tunnel, --no-browser, --reset-password, --self-test
│   ├── rz/http.py            rotas, arquivos estáticos, gzip, ETag, cabeçalhos de segurança (CSP)
│   ├── rz/storage.py         coleções JSON com revisão, feed de alterações, fotos, backup/restauração .zip
│   ├── rz/auth.py            PBKDF2-SHA256, sessões assinadas, bloqueio por tentativas
│   ├── rz/tunnel.py          cloudflared
│   └── tests/                testes do servidor
├── web/
│   ├── index.html, login.html, manifest.webmanifest
│   ├── css/                  tokens, base, componentes, layout, telas, documentos (PDF)
│   └── js/
│       ├── core/             roteador, API, store (otimista, offline, sincronização), modelo, formatação, idiomas
│       ├── ui/               barra lateral, paleta Ctrl+K, menus, diálogos, toasts, gráficos, combobox
│       ├── views/            uma tela por arquivo
│       ├── docs/             documentos PDF/impressão
│       └── migrate/          importação da versão anterior
├── tests/web/                testes do front (node --test)
└── dados/cloud/              dados (sincronizados pelo OneDrive)
```

**Traduções:** o texto em português é a chave: `tr("Novo cliente")` busca a tradução em `web/js/core/locales/en.js`. Todo texto novo precisa de uma entrada lá; `tests/web/i18n.test.mjs` falha se faltar. Valores gravados nos dados (tipo de equipamento, unidade de cobrança) ficam em português e são traduzidos ao mostrar, com `trValue()`.

Testes:

```bash
python server/app.py --self-test
```

```bash
node --test tests/web/
```

Para testar sem tocar nos dados reais: `python server/app.py --port 8799 --data-dir dados/dev --no-browser`.

**API (v1, JSON, exige sessão):** `GET /api/v1/data` (tudo) · `GET /api/v1/changes?since=N` (alterações de outros aparelhos) · `PUT /api/v1/c/{colecao}/{id}` com `{doc, baseRev}` (409 em conflito, com a versão atual) · `DELETE /api/v1/c/{colecao}/{id}?baseRev=N` · `POST/GET/DELETE /api/v1/files` (fotos JPEG/PNG/WebP) · `GET /api/v1/backup` · `POST /api/v1/restore` · `GET /api/v1/system`. Coleções: `orders`, `clients`, `catalog`, `settings`.

## Licença

Software proprietário — **todos os direitos reservados**. O código está publicado só para visualização: não é permitido copiar, usar, modificar nem redistribuir sem autorização por escrito. Termos completos em [`EULA.txt`](EULA.txt). As bibliotecas em `web/vendor/` têm licença própria (MIT).
