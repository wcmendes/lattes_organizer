# Implementation Plan: ComprovaLattes

## Overview

Implementação da SPA estática ComprovaLattes usando HTML + CSS + JavaScript puro (ES Modules), com Google Sheets como banco de dados, Google Drive para armazenamento e processamento client-side (PDF.js, Tesseract.js, fuzzball.js, JSZip). A aplicação será hospedada no GitHub Pages com hash routing.

## Tasks

- [x] 1. Estrutura do projeto, estilos base e infraestrutura
  - [x] 1.1 Criar estrutura de diretórios e `index.html` com carregamento CDN (fallback local)
    - Criar diretórios: `css/`, `js/`, `js/services/`, `js/core/`, `js/views/`, `js/ui/`, `lib/`, `test/`, `test/properties/`, `test/unit/`, `test/generators/`
    - Criar `index.html` com tags `<script>` para CDNs (PDF.js, Tesseract.js, fuzzball.js, JSZip) com atributo `onerror` para fallback local
    - Definir `<div id="app">` como container principal
    - _Requirements: 12.7, 12.6_

  - [x] 1.2 Criar `css/styles.css` com custom properties, layout responsivo e componentes base
    - Definir paleta de cores via CSS custom properties com contraste ≥ 4.5:1 (WCAG 2.1 AA)
    - Criar layout responsivo (min 768px tablet, 1024px desktop) sem scroll horizontal
    - Estilos para toast (sucesso/erro/info), overlay bloqueante com spinner, barras de progresso
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x] 1.3 Implementar `js/router.js` — hash routing SPA
    - Registrar rotas: `#login`, `#dashboard`, `#entradas`, `#importacao`, `#revisao`, `#ocultos`, `#config`
    - Implementar guard de autenticação (redireciona para `#login` se não autenticado)
    - Hash inválido redireciona para `#dashboard`
    - Atualizar URL sem recarregar página
    - _Requirements: 11.1, 11.3, 11.4, 11.5, 11.6_

  - [x] 1.4 Implementar `js/ui/toast.js` e `js/ui/overlay.js`
    - Toast: sucesso (verde, 4s), erro (vermelho, 5s), info (azul, 4s), dismiss manual
    - Overlay: spinner animado, timer de tempo decorrido, contador de progresso
    - _Requirements: 12.4, 12.5_

  - [x] 1.5 Implementar `js/app.js` — bootstrap e inicialização
    - Verificar carregamento de bibliotecas CDN
    - Inicializar router, verificar autenticação, carregar configurações
    - Orquestrar lifecycle das views
    - _Requirements: 11.7, 12.7_

- [x] 2. Autenticação OAuth2
  - [x] 2.1 Implementar `js/auth.js` — módulo de autenticação com Google Identity Services
    - `initAuth(config)`: inicializa GIS com clientId e escopos (Sheets read/write, Drive manage)
    - `signIn()`: inicia fluxo OAuth2 implicit grant, salva token no localStorage
    - `signOut()`: revoga token, limpa localStorage, redireciona para login
    - `validateToken()`: verifica token no endpoint de validação do Google
    - `getToken()`: retorna token ativo ou null
    - Tratar: token expirado → limpa e redireciona; permissões negadas → mensagem; revogação falha → limpa mesmo assim
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

  - [x] 2.2 Implementar `js/views/login.js` — view de login
    - Exibir botão "Entrar com Google" como único ponto de acesso
    - Mostrar mensagem caso autenticação falhe ou permissões sejam negadas
    - _Requirements: 1.1, 1.8_

- [x] 3. Camada de serviços (Google Sheets e Drive)
  - [x] 3.1 Implementar `js/services/sheets.js` — CRUD Google Sheets API v4
    - `getRows(spreadsheetId, sheetName)`: lê linhas como objetos
    - `appendRows(spreadsheetId, sheetName, rows)`: adiciona linhas
    - `updateRow(spreadsheetId, sheetName, rowIndex, data)`: atualiza linha por índice
    - `batchUpdate(spreadsheetId, updates)`: batch de até 100 linhas
    - `createSpreadsheet(title, sheets)`: cria planilha com abas e headers
    - Implementar retry exponencial (3 tentativas, backoff 1s/2s/4s + jitter) para 429 e 5xx
    - Tratar 401 → refresh/logout, 403 → mensagem de erro
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

  - [x] 3.2 Implementar `js/services/drive.js` — CRUD Google Drive API v3
    - `findFolder(name, parentId)`, `createFolder(name, parentId)`
    - `uploadFile(file, folderId, fileName)`, `moveFile(fileId, from, to)`
    - `renameFile(fileId, newName)`, `listFiles(folderId)`, `downloadFile(fileId)`, `deleteFile(fileId)`
    - Processamento sequencial de uploads (evitar burst)
    - Retry exponencial para erros 429 e 5xx
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

- [x] 4. Configurações e setup inicial
  - [x] 4.1 Implementar `js/config.js` — gerenciamento de configurações
    - Carregar config do localStorage, sincronizar com aba "config" da Planilha
    - Planilha como fonte autoritativa em caso de conflito
    - Persistir no localStorage imediatamente e na Planilha em até 5s
    - Valores padrão: threshold = 50
    - _Requirements: 10.5, 10.6, 10.9_

  - [ ]* 4.2 Write property test for configuration conflict resolution
    - **Property 11: Configuration Conflict Resolution**
    - **Validates: Requirements 10.9**

  - [x] 4.3 Implementar `js/views/settings.js` — view de configurações
    - Slider 0–100 para threshold com valor numérico exibido
    - Campo para ID de planilha existente ou criação automática ("ComprovaLattes")
    - Campo para ID de pasta raiz ou criação automática ("ComprovaLattes")
    - Fluxo de setup inicial para primeiro uso
    - Mensagem de erro para IDs inválidos/inacessíveis
    - Indicador visual de salvamento
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 10.7, 10.8_

- [x] 5. Checkpoint — Infraestrutura base
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Parser XML Lattes e gerenciamento de categorias
  - [x] 6.1 Implementar `js/core/xml-parser.js` — parsing do XML Lattes
    - `parseXml(xmlContent)`: parseia XML via DOMParser, trata codificação ISO-8859-1
    - Extrair de cada entrada: título, instituição, ano, carga_horária, categoria (string vazia para campos ausentes)
    - `formatCategoryName(xmlSectionName)`: converte "FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO" → "Formação Complementar — Curso de Curta Duração"
    - `categorySlug(xmlSectionName)`: gera slug lowercase hyphenado
    - Validar extensão .xml e tamanho ≤ 20MB
    - Rejeitar arquivos inválidos com mensagem de erro
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.10_

  - [ ]* 6.2 Write property test for XML parsing completeness
    - **Property 1: XML Parsing Produces Complete Structured Entries**
    - **Validates: Requirements 2.2, 2.4, 2.5, 2.6**

  - [ ]* 6.3 Write property test for category name formatting
    - **Property 2: Category Name Formatting Preserves Readability**
    - **Validates: Requirements 2.10**

  - [x] 6.4 Implementar `js/core/category-manager.js` — gerenciamento de categorias e visibilidade
    - Descobrir categorias dinamicamente do XML
    - Novas categorias com estado inativo (OFF) por padrão
    - Toggle ON/OFF por categoria; persistir na Planilha antes de confirmar visualmente
    - Ocultar/restaurar entradas individuais
    - Criar subpasta no Drive ao ativar categoria (se não existir)
    - Rollback visual se persistência falhar
    - _Requirements: 2.5, 2.6, 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 6.8, 6.9, 6.10, 14.2, 14.3_

  - [ ]* 6.5 Write property test for visibility filtering invariant
    - **Property 6: Visibility Filtering Invariant**
    - **Validates: Requirements 4.4, 6.2, 6.4, 7.1**

  - [ ]* 6.6 Write property test for visibility toggle round-trip
    - **Property 7: Visibility Toggle Round-Trip**
    - **Validates: Requirements 6.6, 6.10**

- [x] 7. Importação XML e gerenciamento de entradas
  - [x] 7.1 Implementar `js/core/entry-manager.js` — gerenciamento de entradas e mapeamentos
    - Salvar entradas na aba "entradas" da Planilha
    - Reimportação: identificar por titulo+instituicao+ano+categoria, preservar mapeamentos, adicionar novas, marcar ausentes como "removida"
    - Upload do XML para pasta "ComprovaLattes/xml/"
    - _Requirements: 2.7, 2.8, 2.9, 16.1_

  - [ ]* 7.2 Write property test for reimportation merge
    - **Property 3: Reimportation Merge Preserves Existing Mappings**
    - **Validates: Requirements 2.8, 16.1**

  - [x] 7.3 Implementar `js/views/import.js` — view de importação
    - Botão "Importar XML" com validação de arquivo (.xml, ≤ 20MB)
    - Overlay com spinner, timer e contador de entradas processadas/total
    - Orquestrar: parse → salvar entradas → upload XML → descobrir categorias
    - _Requirements: 2.1, 2.2, 2.3, 2.11_

- [x] 8. Extração de texto e fuzzy matching
  - [x] 8.1 Implementar `js/core/text-extractor.js` — extração de texto
    - `extractFromPdf(pdfData)`: extrai texto via PDF.js
    - `extractFromImage(imageData)`: extrai texto via Tesseract.js (lang: por)
    - `extractText(fileData, mimeType)`: detecta tipo e despacha
    - Tratar falhas (PDF protegido/corrompido, imagem ilegível, texto vazio)
    - _Requirements: 4.1, 4.2, 4.9_

  - [x] 8.2 Implementar `js/core/matcher.js` — fuzzy matching com fuzzball.js
    - `calculateScore(extractedText, entry)`: fórmula ponderada (título 55% TSR + instituição 30% TSR + ano 10% exato ±1 + carga horária 5% ±20%)
    - `findBestMatch(extractedText, candidates, threshold)`: retorna status (auto_accepted/review/no_match), bestMatch, score, hasTie
    - `findBestSnippet(text, reference, maxChars)`: encontra trecho de maior similaridade (max 500 chars) e palavras de highlight
    - Filtrar candidatos: apenas categorias ativas, não ocultas, sem mapeamento
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [ ]* 8.3 Write property test for score calculation bounds
    - **Property 4: Score Calculation Bounds and Weight Consistency**
    - **Validates: Requirements 4.3**

  - [ ]* 8.4 Write property test for match classification decision tree
    - **Property 5: Match Classification Follows Decision Tree**
    - **Validates: Requirements 4.5, 4.6, 4.7**

- [x] 9. Upload de comprovantes e auto-match pipeline
  - [x] 9.1 Integrar upload de comprovantes na view de importação
    - Botão "Importar Comprovantes": aceita até 20 arquivos (PDF, JPG, PNG), max 10MB cada
    - Upload para "ComprovaLattes/files/novos/"
    - Após upload de cada arquivo: extrair texto → calcular scores → classificar match
    - Score ≥ 99% sem empate → aceitar automaticamente (salvar mapeamento, mover arquivo)
    - Score ≥ 99% com empate ou ≥ threshold < 99% → adicionar à fila de revisão
    - Score < threshold → manter em "novos/"
    - Barra de progresso com timer, nome do arquivo, "X de Y"
    - Toast de erro por arquivo com falha, continuar batch
    - Resumo final: enviados, associados via auto-match, com falha
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.5, 4.6, 4.7_

- [x] 10. Checkpoint — Core engine (parse, extract, match)
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Tela de revisão de sugestões
  - [x] 11.1 Implementar `js/views/review.js` — overlay fullscreen de revisão
    - Overlay fullscreen cobrindo toda a interface
    - Uma sugestão por vez com navegação "← Anterior" / "Pular →"
    - Contador "Sugestão X de Y"
    - Layout lado a lado: esquerda (dados da entrada + score) e direita (preview embed + trecho extraído com highlight)
    - Botões "✓ Aceitar" (verde) e "✗ Rejeitar" (vermelho)
    - Aceitar: salvar mapeamento na Planilha, mover arquivo para pasta da categoria, renomear no formato "ANO_tipo_INSTITUICAO_Titulo.ext"
    - Rejeitar: remover da fila permanentemente
    - "Desistir e voltar": fechar overlay preservando fila
    - Fechar automaticamente quando todas processadas
    - Toast de erro se operação falhar, manter sugestão na posição
    - Botão "← Anterior" desabilitado na primeira sugestão
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11_

- [x] 12. Tela de entradas (listagem e associação manual)
  - [x] 12.1 Implementar `js/views/entries.js` — listagem de entradas e associação manual
    - Listagem agrupada por categoria (apenas categorias ativas, entradas não ocultas)
    - Cada entrada: indicador de status (✓/✗/⚠), título, instituição, ano, arquivo vinculado
    - Filtros por categoria, ano, status (mapeada/não mapeada/removida)
    - Busca textual case-insensitive (título ou instituição, a partir de 2 chars)
    - Entrada mapeada selecionada → preview do comprovante
    - Entrada sem comprovante selecionada → listar arquivos de "files/novos/" com "Ver" e "Vincular"
    - Vincular: salvar mapeamento, mover arquivo, renomear
    - Desvincular: confirmação → remover mapeamento, mover de volta para "files/novos/"
    - Toast de erro em caso de falha, manter estado anterior
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10_

  - [ ]* 12.2 Write property test for entry filtering and search
    - **Property 9: Entry Filtering and Search Correctness**
    - **Validates: Requirements 7.3, 7.4**

- [x] 13. Gestão de entradas removidas
  - [x] 13.1 Implementar lógica de entradas removidas na view de entradas
    - Exibir entradas removidas com indicador visual diferenciado (ícone ⚠, cor de alerta)
    - Opções: "Excluir entrada e comprovante" ou "Manter mesmo assim"
    - Excluir com comprovante → remover entrada da Planilha + deletar arquivo do Drive
    - Excluir sem comprovante → remover apenas entrada da Planilha
    - Manter → alterar status para "mantida_manual", incluir em listagens/progresso/auto-match
    - Toast de erro se exclusão do Drive falhar, manter entrada sem alteração
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_

- [x] 14. Dashboard de progresso
  - [x] 14.1 Implementar `js/views/dashboard.js` — dashboard com barras de progresso
    - Barra de progresso global: % de entradas mapeadas / total ativas e visíveis + "X de Y mapeadas"
    - Barras por categoria ativa: nome, %, "X de Y"
    - Calcular usando apenas entradas de categorias ativas (ON) e não ocultas
    - Recalcular automaticamente ao mudar visibilidade (sem recarga)
    - Denominador zero → 0% e "0 de 0 mapeadas"
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 14.2 Write property test for progress calculation
    - **Property 10: Progress Calculation Correctness**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5**

- [x] 15. View de itens ocultos
  - [x] 15.1 Implementar `js/views/hidden.js` — view "Itens Ocultos"
    - Listar separadamente: categorias ocultas e entradas individualmente ocultas
    - Opção de reativação para cada item
    - Reativar: restaurar à listagem, reincluir em progresso e auto-match, persistir
    - _Requirements: 6.5, 6.6_

- [x] 16. Checkpoint — Views completas
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Exportação organizada
  - [x] 17.1 Implementar `js/core/exporter.js` — exportação para Drive e ZIP
    - `exportToDrive(entries, config, onProgress)`: criar "ComprovaLattes/exportacao/", organizar cópias em subpastas numeradas ("2.1 Formação Complementar/"), substituir exportação anterior
    - `exportToZip(entries, onProgress)`: gerar ZIP via JSZip com mesma estrutura
    - `formatExportFileName(entry, extension)`: "ANO_categoria_INSTITUICAO_Titulo.ext", max 200 chars, ASCII-safe, determinístico
    - Overlay com spinner e "Exportando X de Y"
    - Toast de erro por arquivo com falha, continuar restantes, resumo final
    - Bloquear exportação se nenhum mapeamento existir
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [ ]* 17.2 Write property test for export file name format
    - **Property 8: Export File Name Format Compliance**
    - **Validates: Requirements 5.9, 9.3**

- [x] 18. Navegação e wiring final
  - [x] 18.1 Implementar barra de navegação persistente e wiring de todas as views
    - Menu de navegação em todas as views autenticadas com links e destaque da view ativa
    - Exibir nome do usuário e botão "Sair"
    - Integrar todas as views ao router
    - Garantir redirecionamento para `#dashboard` após autenticação
    - _Requirements: 11.2, 11.7, 11.8_

  - [x] 18.2 Implementar inicialização de pasta raiz no Google Drive
    - Ao iniciar com autenticação válida: verificar/criar "ComprovaLattes", "files/", "files/novos/", "xml/"
    - _Requirements: 14.1_

- [x] 19. Documentação
  - [x] 19.1 Criar README.md (pt-BR) e README.en.md (en) com documentação completa
    - Descrição do projeto, pré-requisitos, configuração Google Cloud Console (projeto, APIs, OAuth2, URIs)
    - Instruções de deploy no GitHub Pages
    - Guia de uso (fluxo principal)
    - Estrutura de arquivos e módulos com descrição
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [x] 20. Final checkpoint — Aplicação completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All libraries (PDF.js, Tesseract.js, fuzzball.js, JSZip, fast-check) are loaded via CDN with local fallback — no npm/Node.js required
- The application is entirely client-side (no backend)
- Google Sheets API v4 and Google Drive API v3 are accessed via fetch() with Bearer token

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4"] },
    { "id": 2, "tasks": ["1.5", "2.1"] },
    { "id": 3, "tasks": ["2.2", "3.1", "3.2"] },
    { "id": 4, "tasks": ["4.1", "4.3"] },
    { "id": 5, "tasks": ["4.2", "6.1"] },
    { "id": 6, "tasks": ["6.2", "6.3", "6.4"] },
    { "id": 7, "tasks": ["6.5", "6.6", "7.1"] },
    { "id": 8, "tasks": ["7.2", "7.3", "8.1"] },
    { "id": 9, "tasks": ["8.2"] },
    { "id": 10, "tasks": ["8.3", "8.4", "9.1"] },
    { "id": 11, "tasks": ["11.1", "12.1"] },
    { "id": 12, "tasks": ["12.2", "13.1", "14.1"] },
    { "id": 13, "tasks": ["14.2", "15.1"] },
    { "id": 14, "tasks": ["17.1"] },
    { "id": 15, "tasks": ["17.2", "18.1", "18.2"] },
    { "id": 16, "tasks": ["19.1"] }
  ]
}
```
