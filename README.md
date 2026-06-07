# ComprovaLattes

> 🌐 [English version](README.en.md)

Aplicação web client-side (SPA) para gerenciamento de comprovantes acadêmicos mapeados às entradas do Currículo Lattes (CNPq). Toda a lógica roda no navegador — sem backend, sem build step.

Utiliza **Google Sheets** como banco de dados, **Google Drive** para armazenamento de arquivos, **PDF.js** + **Tesseract.js** para extração de texto, **fuzzball.js** para matching fuzzy e **JSZip** para exportação em ZIP.

## Pré-requisitos

- Uma conta Google com acesso ao [Google Cloud Console](https://console.cloud.google.com/)
- Um site hospedado no GitHub Pages (ou qualquer hosting estático)
- Navegador moderno (Chrome, Firefox ou Edge)

## Configuração do Google Cloud Console

### 1. Criar um projeto

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/)
2. Clique em **Selecionar projeto** → **Novo Projeto**
3. Dê um nome (ex.: `ComprovaLattes`) e clique em **Criar**

### 2. Habilitar APIs

No painel do projeto, acesse **APIs e serviços** → **Biblioteca** e habilite:

- **Google Sheets API** (v4)
- **Google Drive API** (v3)

### 3. Configurar tela de consentimento OAuth

1. Vá em **APIs e serviços** → **Tela de consentimento OAuth**
2. Selecione **Externo** (ou Interno se tiver Google Workspace)
3. Preencha o nome do app e o e-mail de suporte
4. Adicione os escopos:
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/drive.file`
5. Adicione seu e-mail como **Usuário de teste** (modo de teste é suficiente para uso pessoal)
6. Salve

### 4. Criar credenciais OAuth 2.0

1. Vá em **APIs e serviços** → **Credenciais**
2. Clique em **Criar credenciais** → **ID do cliente OAuth**
3. Tipo: **Aplicativo da Web**
4. Em **Origens JavaScript autorizadas**, adicione:
   - `https://seuusuario.github.io`
5. Em **URIs de redirecionamento autorizados**, adicione:
   - `https://seuusuario.github.io/lattes_organizer/`
6. Clique em **Criar** e copie o **Client ID**

### 5. Configurar na aplicação

Abra a página de **Configurações** na aplicação (ou edite `js/config.js`) e insira:

- O **Client ID** copiado no passo anterior
- O **ID da planilha** Google Sheets (pode ser criado automaticamente pela app)

## Deploy no GitHub Pages

1. Faça fork ou clone deste repositório:
   ```bash
   git clone https://github.com/seuusuario/lattes_organizer.git
   ```

2. No repositório do GitHub, vá em **Settings** → **Pages**

3. Em **Source**, selecione a branch `main` e pasta `/ (root)`

4. Salve e aguarde o deploy. O site ficará disponível em:
   ```
   https://seuusuario.github.io/lattes_organizer/
   ```

5. Certifique-se de que a URL de deploy corresponde à **Origem JavaScript autorizada** configurada no Google Cloud Console.

## Guia de Uso

### Fluxo Principal

1. **Entrar com Google** — Autentique-se na tela inicial para autorizar acesso ao Sheets e Drive
2. **Importar XML Lattes** — Vá em "Importação" e selecione o arquivo XML exportado da Plataforma Lattes
3. **Upload de comprovantes** — Faça upload de PDFs ou imagens (JPG/PNG) dos seus certificados e documentos
4. **Revisar sugestões** — O sistema extrai texto dos comprovantes e sugere associações automáticas via fuzzy matching
5. **Vincular manualmente** — Para entradas sem sugestão aceita, vincule o comprovante correto manualmente
6. **Exportar** — Exporte a coleção organizada para o Google Drive ou como arquivo ZIP

### Dicas

- Ajuste o **threshold de confiança** nas Configurações para controlar a sensibilidade do matching
- Entradas que não precisam de comprovação podem ser marcadas como **ocultas**
- Reimporte o XML sempre que atualizar seu Lattes — entradas já vinculadas são preservadas

## Estrutura de Arquivos

```
├── index.html                 — Ponto de entrada com scripts CDN
├── css/
│   └── styles.css             — Estilos (custom properties, responsivo)
├── js/
│   ├── app.js                 — Bootstrap, inicialização do router e nav bar
│   ├── auth.js                — Autenticação OAuth2 (Google Identity Services)
│   ├── config.js              — Gerenciamento de configuração
│   ├── router.js              — Roteamento SPA por hash
│   ├── core/
│   │   ├── xml-parser.js      — Parsing do XML Lattes
│   │   ├── text-extractor.js  — Extração de texto (PDF.js + Tesseract.js)
│   │   ├── matcher.js         — Matching fuzzy (fuzzball.js)
│   │   ├── exporter.js        — Exportação para Drive/ZIP
│   │   ├── category-manager.js — Gerenciamento de categorias
│   │   ├── entry-manager.js   — CRUD de entradas e merge
│   │   ├── review-queue.js    — Fila de revisão (localStorage)
│   │   └── drive-init.js      — Inicialização de pastas no Drive
│   ├── services/
│   │   ├── sheets.js          — Google Sheets API v4
│   │   └── drive.js           — Google Drive API v3
│   ├── views/
│   │   ├── login.js           — Tela de login
│   │   ├── dashboard.js       — Painel principal
│   │   ├── entries.js         — Listagem de entradas
│   │   ├── import.js          — Importação de XML e comprovantes
│   │   ├── review.js          — Fila de revisão de matches
│   │   ├── hidden.js          — Entradas ocultas
│   │   └── settings.js        — Configurações
│   └── ui/
│       ├── toast.js           — Notificações toast
│       └── overlay.js         — Overlay com spinner
├── lib/                       — Fallbacks locais para CDNs
└── test/                      — Testes unitários e de propriedade
```

## Tecnologias

| Tecnologia | Uso |
|---|---|
| HTML/CSS/JS puro | Interface e lógica (sem framework) |
| Google Identity Services | Autenticação OAuth2 |
| Google Sheets API v4 | Persistência de dados |
| Google Drive API v3 | Armazenamento de comprovantes |
| PDF.js | Extração de texto de PDFs |
| Tesseract.js | OCR em imagens |
| fuzzball.js | Matching fuzzy (token_set_ratio) |
| JSZip | Exportação em ZIP |

## Licença

Este projeto é de uso pessoal/acadêmico.
