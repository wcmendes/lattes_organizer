# Requirements Document

## Introduction

O ComprovaLattes é uma aplicação web estática (HTML + CSS + JavaScript puro) hospedada no GitHub Pages, destinada a gerenciar e associar comprovantes acadêmicos às entradas do Currículo Lattes (CNPq). A aplicação utiliza Google Sheets como banco de dados, Google Drive para armazenamento de arquivos e realiza todo o processamento (parsing XML, OCR, fuzzy matching) diretamente no navegador, sem necessidade de backend. A interface é organizada em múltiplas telas/views com navegação clara entre elas.

## Glossary

- **Aplicação**: O sistema web estático ComprovaLattes hospedado no GitHub Pages
- **Entrada_Lattes**: Uma atividade acadêmica/profissional extraída do XML do Currículo Lattes (curso, evento, congresso, prêmio, etc.)
- **Comprovante**: Arquivo PDF, JPG ou PNG que comprova a realização de uma atividade acadêmica
- **Categoria**: Seção do XML Lattes que agrupa entradas por tipo (ex.: formação complementar, participação em evento)
- **Mapeamento**: Associação entre uma Entrada_Lattes e um Comprovante armazenado no Google Drive
- **Score_de_Confiança**: Valor numérico de 0 a 100 representando o grau de similaridade entre o texto extraído de um Comprovante e os dados de uma Entrada_Lattes
- **Threshold**: Valor mínimo configurável de Score_de_Confiança para que uma sugestão de match seja apresentada ao usuário (padrão: 50%)
- **Planilha**: Documento do Google Sheets utilizado como banco de dados da Aplicação
- **Pasta_Raiz**: Pasta no Google Drive onde os comprovantes são armazenados ("ComprovaLattes")
- **Auto_Match**: Processo automático de associação entre Comprovantes e Entradas_Lattes por meio de fuzzy matching client-side
- **Fuzzy_Matching**: Técnica de comparação de texto que calcula similaridade aproximada entre strings
- **Token_Set_Ratio**: Algoritmo de similaridade que compara tokens (palavras) entre duas strings ignorando ordem e duplicatas
- **Entrada_Oculta**: Entrada_Lattes que o usuário marcou como não necessária de comprovação, excluída de contagens e matching
- **Entrada_Removida**: Entrada_Lattes que existia em uma importação anterior mas não está presente na importação atual do XML
- **View**: Tela/página da aplicação acessível via navegação (SPA com hash routing)

## Requirements

### Requisito 1: Autenticação com Google OAuth2

**User Story:** Como usuário, eu quero fazer login com minha conta Google, para que eu possa acessar minhas planilhas e arquivos no Drive de forma segura diretamente do GitHub Pages.

#### Critérios de Aceitação

1. WHILE o usuário não estiver autenticado, THE Aplicação SHALL exibir um botão "Entrar com Google" na tela inicial como único ponto de acesso ao sistema
2. WHEN o usuário clicar no botão "Entrar com Google", THE Aplicação SHALL iniciar o fluxo OAuth2 implicit grant utilizando a Google Identity Services (GIS) library, solicitando os escopos de leitura/escrita do Google Sheets e gerenciamento de arquivos do Google Drive
3. WHEN a autenticação OAuth2 for concluída com sucesso, THE Aplicação SHALL armazenar o token de acesso no localStorage do navegador e redirecionar o usuário para a tela principal em no máximo 2 segundos após o recebimento do token
4. WHEN o usuário retornar à Aplicação com um token presente no localStorage, THE Aplicação SHALL verificar a validade do token consultando o endpoint de validação do Google e, se válido, restaurar a sessão automaticamente sem exigir novo login
5. IF o token armazenado estiver expirado ou a verificação de validade falhar ao carregar a Aplicação ou ao realizar qualquer chamada à API do Google, THEN THE Aplicação SHALL remover o token do localStorage e redirecionar o usuário para a tela inicial com o botão "Entrar com Google"
6. WHEN o usuário clicar no botão "Sair", THE Aplicação SHALL revogar o token, remover os dados do localStorage e redirecionar para a tela inicial
7. THE Aplicação SHALL utilizar exclusivamente o fluxo OAuth2 implicit grant compatível com sites estáticos hospedados no GitHub Pages, sem necessidade de servidor intermediário
8. IF o usuário recusar a concessão de permissões durante o fluxo OAuth2 ou fechar a janela de autenticação, THEN THE Aplicação SHALL permanecer na tela inicial exibindo o botão "Entrar com Google" e apresentar uma mensagem indicando que a autenticação é necessária para utilizar o sistema
9. IF a revogação do token falhar durante o processo de logout devido a erro de rede, THEN THE Aplicação SHALL ainda assim remover os dados do localStorage e redirecionar para a tela inicial, garantindo que a sessão local seja encerrada

---

### Requisito 2: Importação de XML Lattes

**User Story:** Como usuário, eu quero importar meu arquivo XML do Currículo Lattes, para que o sistema extraia automaticamente todas as minhas atividades acadêmicas e eu possa reimportar versões atualizadas sem perder meu trabalho.

#### Critérios de Aceitação

1. THE Aplicação SHALL exibir um botão "Importar XML" acessível a partir da view de gerenciamento
2. WHEN o usuário selecionar um arquivo XML, THE Aplicação SHALL validar que o arquivo possui extensão .xml e tamanho máximo de 20MB, e parsear o conteúdo usando DOMParser tratando a codificação ISO-8859-1
3. IF o arquivo selecionado não for um XML válido ou não contiver a estrutura esperada do Currículo Lattes, THEN THE Aplicação SHALL exibir uma mensagem de erro indicando que o arquivo é inválido e não prosseguir com a importação
4. WHEN o parsing for concluído, THE Aplicação SHALL extrair de cada entrada: título, instituição, ano, carga horária e seção/categoria, utilizando string vazia como valor padrão para atributos ausentes no XML
5. THE Aplicação SHALL descobrir todas as categorias dinamicamente a partir dos nomes das seções presentes no XML
6. WHEN novas categorias forem descobertas, THE Aplicação SHALL criá-las com estado inativo (toggle OFF) por padrão
7. WHEN as entradas forem extraídas, THE Aplicação SHALL salvar cada entrada como uma linha na aba "entradas" da Planilha
8. WHEN o XML for importado sobre dados existentes (reimportação), THE Aplicação SHALL identificar entradas existentes pela combinação única de título + instituição + ano + categoria, preservar todos os mapeamentos existentes, adicionar novas entradas e marcar como "removida" as entradas cuja combinação identificadora não esteja presente no XML atual
9. WHEN uma Entrada_Lattes for marcada como removida, THE Aplicação SHALL exibi-la com indicador visual diferenciado e oferecer ao usuário a opção de excluí-la permanentemente junto com seu comprovante associado
10. THE Aplicação SHALL converter os nomes de seção do XML (formato "FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO") para nomes legíveis em português com diacríticos apropriados (ex.: "Formação Complementar — Curso de Curta Duração")
11. WHILE o processamento de importação estiver em andamento, THE Aplicação SHALL exibir um overlay com spinner, timer de tempo decorrido e contador de entradas processadas sobre o total encontrado

---

### Requisito 3: Upload de Comprovantes

**User Story:** Como usuário, eu quero fazer upload de múltiplos comprovantes de uma vez, para que eles sejam armazenados no Drive e automaticamente associados às entradas correspondentes.

#### Critérios de Aceitação

1. THE Aplicação SHALL exibir um botão "Importar Comprovantes" que aceita até 20 arquivos simultâneos nos formatos PDF, JPG e PNG, com tamanho máximo de 10 MB por arquivo
2. WHEN arquivos forem selecionados, THE Aplicação SHALL fazer upload de cada arquivo para a pasta "ComprovaLattes/files/novos/" no Google Drive
3. WHEN o upload de um arquivo for concluído, THE Aplicação SHALL executar o Auto_Match individualmente para esse arquivo
4. WHILE o processamento de upload e matching estiver em andamento, THE Aplicação SHALL exibir uma barra de progresso com timer mostrando o nome do arquivo atual e o número processado do total (ex: "3 de 10")
5. IF o upload de um arquivo falhar, THEN THE Aplicação SHALL exibir um toast de erro com o nome do arquivo por 5 segundos e continuar processando os arquivos restantes
6. IF o Auto_Match de um arquivo não encontrar correspondência, THEN THE Aplicação SHALL marcar o arquivo como "não associado" e continuar processando os arquivos restantes
7. WHEN o processamento de todos os arquivos do lote for concluído, THE Aplicação SHALL exibir um resumo informando a quantidade de arquivos enviados com sucesso, a quantidade associada via Auto_Match e a quantidade com falha

---

### Requisito 4: Auto-Match por Fuzzy Matching

**User Story:** Como usuário, eu quero que o sistema associe automaticamente meus comprovantes às entradas do Lattes, para que eu não precise fazer cada associação manualmente.

#### Critérios de Aceitação

1. WHEN o Auto_Match for executado para um Comprovante PDF, THE Aplicação SHALL extrair o texto do arquivo usando PDF.js no navegador
2. WHEN o Auto_Match for executado para um Comprovante de imagem (JPG ou PNG), THE Aplicação SHALL extrair o texto usando Tesseract.js no navegador
3. WHEN o texto for extraído, THE Aplicação SHALL calcular o Score_de_Confiança comparando o texto com cada Entrada_Lattes ativa, visível e ainda não mapeada, usando a fórmula: título (peso 55%, Token_Set_Ratio) + instituição (peso 30%, Token_Set_Ratio) + ano (peso 10%, match exato com tolerância de ±1 ano) + carga horária (peso 5%, tolerância de ±20%), e selecionar a Entrada_Lattes com o maior Score_de_Confiança como candidata ao match
4. THE Aplicação SHALL considerar apenas Entradas_Lattes pertencentes a categorias ativas (toggle ON), não ocultas e sem mapeamento existente para o cálculo de match
5. WHEN o maior Score_de_Confiança para um Comprovante for maior ou igual a 99%, THE Aplicação SHALL aceitar o mapeamento automaticamente com a Entrada_Lattes de maior score sem exigir revisão do usuário; IF duas ou mais Entradas_Lattes empatarem com o maior score, THEN THE Aplicação SHALL adicionar o match à fila de Revisão em vez de aceitar automaticamente
6. WHEN o maior Score_de_Confiança para um Comprovante for menor que 99% e maior ou igual ao Threshold configurado, THE Aplicação SHALL adicionar o match à fila de Revisão apresentando a Entrada_Lattes de maior score como sugestão
7. WHEN o Score_de_Confiança de todos os matches para um Comprovante for menor que o Threshold, THE Aplicação SHALL manter o arquivo na pasta "files/novos/" sem sugerir associação
8. THE Aplicação SHALL utilizar o valor padrão de 50% para o Threshold quando nenhuma configuração personalizada existir
9. IF a extração de texto de um Comprovante falhar (PDF.js ou Tesseract.js retornar erro ou texto vazio), THEN THE Aplicação SHALL manter o arquivo na pasta "files/novos/", registrar o comprovante como não processado e exibir um toast de erro indicando o nome do arquivo e a natureza da falha

---

### Requisito 5: Tela de Revisão de Sugestões

**User Story:** Como usuário, eu quero revisar as sugestões de associação uma por vez em tela cheia, para que eu possa comparar visualmente o comprovante com os dados da entrada e decidir aceitar ou rejeitar.

#### Critérios de Aceitação

1. WHEN existirem sugestões pendentes de revisão, THE Aplicação SHALL exibir um overlay fullscreen cobrindo toda a interface
2. WHILE o overlay de revisão estiver ativo, THE Aplicação SHALL apresentar uma sugestão por vez com navegação "← Anterior" e "Pular →", onde "Pular" avança para a próxima sugestão sem decidir, mantendo a sugestão pulada na fila para revisão posterior; o botão "← Anterior" SHALL estar desabilitado quando a sugestão exibida for a primeira da fila
3. THE Aplicação SHALL exibir um contador "Sugestão X de Y" indicando a posição atual na fila
4. THE Aplicação SHALL apresentar um layout lado a lado com: coluna esquerda contendo dados da Entrada_Lattes (título, instituição, ano, carga horária, percentual de confiança) e coluna direita contendo preview do Comprovante (embed), trecho do texto extraído (máximo 500 caracteres, centralizado no trecho de maior similaridade) e palavras que geraram match destacadas com cor de fundo distinta
5. THE Aplicação SHALL exibir os botões "✓ Aceitar" (verde) e "✗ Rejeitar" (vermelho) para cada sugestão
6. WHEN o usuário clicar em "✓ Aceitar", THE Aplicação SHALL salvar o mapeamento na Planilha e mover o arquivo para a pasta da categoria correspondente no Google Drive
7. WHEN o usuário clicar em "✗ Rejeitar", THE Aplicação SHALL remover permanentemente a sugestão da fila de revisão e avançar para a próxima sugestão
8. WHEN o usuário clicar no botão "Desistir e voltar", THE Aplicação SHALL fechar o overlay preservando todas as sugestões não revisadas e puladas na fila
9. WHEN o usuário aceitar um mapeamento, THE Aplicação SHALL renomear o arquivo no formato "ANO_tipo_INSTITUICAO_Titulo.extensão" onde "tipo" corresponde ao slug da categoria da Entrada_Lattes
10. WHEN todas as sugestões da fila tiverem sido aceitas, rejeitadas ou puladas sem nenhuma pendente à frente, THE Aplicação SHALL fechar o overlay automaticamente e retornar à view anterior
11. IF a operação de salvar mapeamento, mover ou renomear arquivo no Google Drive falhar ao aceitar uma sugestão, THEN THE Aplicação SHALL exibir um toast de erro indicando a falha, manter a sugestão na posição atual da fila e não avançar para a próxima

---

### Requisito 6: Visibilidade de Itens (Ocultar Entradas e Categorias)

**User Story:** Como usuário, eu quero ocultar categorias inteiras ou entradas individuais que não preciso comprovar, para que eu possa focar apenas no que é relevante sem poluir minha lista.

#### Critérios de Aceitação

1. THE Aplicação SHALL exibir uma lista de todas as categorias descobertas com um toggle ON/OFF para cada uma
2. WHEN uma categoria for desativada (toggle OFF), THE Aplicação SHALL ocultar todas as entradas dessa categoria das listagens, excluí-las do cálculo de progresso e do Auto_Match, e atualizar os indicadores de progresso imediatamente após a ação
3. THE Aplicação SHALL exibir uma opção "Ocultar" para cada Entrada_Lattes individual que pertença a uma categoria ativa (ON)
4. WHEN o usuário ocultar uma Entrada_Lattes individual, THE Aplicação SHALL excluí-la das listagens, do cálculo de progresso e do Auto_Match, e atualizar os indicadores de progresso imediatamente após a ação
5. THE Aplicação SHALL fornecer uma view dedicada "Itens Ocultos" que lista separadamente as categorias ocultas e as entradas individualmente ocultas, exibindo para cada item uma opção de reativação
6. WHEN o usuário reativar uma Entrada_Lattes ou categoria a partir da view "Itens Ocultos", THE Aplicação SHALL restaurá-la às listagens visíveis, reincluí-la no cálculo de progresso e no Auto_Match, e persistir a alteração na Planilha
7. WHEN o estado de visibilidade de um item ou categoria mudar, THE Aplicação SHALL persistir a alteração na Planilha antes de confirmar a ação visualmente ao usuário
8. IF a persistência na Planilha falhar ao alterar o estado de visibilidade, THEN THE Aplicação SHALL reverter o toggle ao estado anterior e exibir mensagem de erro indicando que a alteração não pôde ser salva
9. WHEN novas categorias forem descobertas durante importação, THE Aplicação SHALL adicioná-las com estado inativo (OFF) por padrão
10. WHEN uma categoria for reativada (toggle ON), THE Aplicação SHALL restaurar à listagem apenas as entradas daquela categoria que não estejam individualmente ocultas, preservando o estado de ocultação individual de cada entrada

---

### Requisito 7: Tela de Entradas (Listagem e Associação Manual)

**User Story:** Como usuário, eu quero visualizar minhas entradas organizadas por categoria e poder associar comprovantes manualmente quando o auto-match não encontrar correspondência.

#### Critérios de Aceitação

1. THE Aplicação SHALL apresentar uma view dedicada para listagem de Entradas_Lattes agrupadas por categoria, exibindo apenas entradas pertencentes a categorias ativas (toggle ON) e não ocultas individualmente
2. THE Aplicação SHALL exibir para cada entrada: indicador de status (✓ mapeada / ✗ não mapeada / ⚠ removida), título, instituição, ano e nome do arquivo vinculado quando houver
3. THE Aplicação SHALL fornecer filtros por categoria, ano e status (mapeada/não mapeada/removida)
4. THE Aplicação SHALL fornecer busca textual case-insensitive por título ou instituição, filtrando a lista a partir de 2 caracteres digitados
5. WHEN o usuário selecionar uma entrada mapeada, THE Aplicação SHALL exibir o preview do Comprovante associado em um painel de detalhes
6. WHEN o usuário selecionar uma entrada sem comprovante, THE Aplicação SHALL listar os arquivos disponíveis na pasta "files/novos/" ordenados por nome com opções "Ver" e "Vincular"
7. WHEN o usuário clicar em "Vincular", THE Aplicação SHALL salvar o mapeamento na Planilha, mover o arquivo para a pasta da categoria e renomear no formato "ANO_tipo_INSTITUICAO_Titulo.extensão"
8. WHEN o usuário interagir com uma entrada mapeada (hover em desktop ou seleção em touch), THE Aplicação SHALL exibir um botão "Desvincular"
9. WHEN o usuário clicar em "Desvincular", THE Aplicação SHALL solicitar confirmação antes de prosseguir, e após confirmação, remover o mapeamento da Planilha e mover o arquivo de volta para a pasta "files/novos/"
10. IF a operação de vincular ou desvincular falhar (erro na Planilha ou no Google Drive), THEN THE Aplicação SHALL exibir um toast de erro indicando a falha e manter o estado anterior sem alterações parciais

---

### Requisito 8: Dashboard de Progresso

**User Story:** Como usuário, eu quero ver o progresso geral e por categoria das minhas associações, para que eu saiba quanto falta para completar a organização dos comprovantes.

#### Critérios de Aceitação

1. THE Aplicação SHALL exibir uma view de dashboard com barra de progresso global mostrando a porcentagem de Entradas_Lattes mapeadas sobre o total de entradas ativas e visíveis, acompanhada dos contadores absolutos no formato "X de Y mapeadas"
2. THE Aplicação SHALL exibir barras de progresso individuais para cada categoria ativa, cada uma mostrando o nome da categoria, a porcentagem de entradas mapeadas e os contadores absolutos no formato "X de Y"
3. THE Aplicação SHALL calcular o progresso considerando apenas entradas pertencentes a categorias ativas (ON) e não ocultas individualmente
4. WHEN o estado de visibilidade de uma categoria ou entrada mudar, THE Aplicação SHALL recalcular e atualizar todas as barras de progresso sem exigir recarga da página ou ação adicional do usuário
5. IF o total de entradas ativas e visíveis for zero (globalmente ou para uma categoria específica), THEN THE Aplicação SHALL exibir a barra de progresso correspondente com 0% e os contadores "0 de 0 mapeadas"

---

### Requisito 9: Exportação Organizada

**User Story:** Como usuário, eu quero exportar meus comprovantes organizados em pastas numeradas, para que eu possa utilizá-los em submissões acadêmicas com a estrutura exigida.

#### Critérios de Aceitação

1. THE Aplicação SHALL exibir um botão "Exportar" acessível a partir do dashboard ou menu de navegação
2. WHEN o usuário clicar em "Exportar", THE Aplicação SHALL criar uma subpasta "ComprovaLattes/exportacao/" no Google Drive e organizar cópias dos arquivos mapeados em subpastas numeradas conforme a categoria Lattes associada (ex.: "2.1 Formação Complementar/", "3.1 Participação em Eventos/"), substituindo o conteúdo anterior da pasta de exportação caso ela já exista
3. WHEN um arquivo for incluído na exportação, THE Aplicação SHALL renomeá-lo no formato "ANO_categoria_INSTITUICAO_Titulo.extensão", limitando o nome total do arquivo a 200 caracteres, substituindo caracteres especiais e acentos por equivalentes ASCII e removendo caracteres não permitidos em nomes de arquivo
4. WHERE a opção de download local estiver habilitada, THE Aplicação SHALL gerar um arquivo ZIP usando JSZip contendo a estrutura de pastas e arquivos renomeados
5. WHILE a exportação estiver em andamento, THE Aplicação SHALL exibir um overlay com spinner e indicador de progresso mostrando o número do arquivo atual sobre o total (ex.: "Exportando 3 de 15")
6. IF nenhum mapeamento existir no momento da exportação, THEN THE Aplicação SHALL exibir uma mensagem informando que não há comprovantes mapeados para exportar e não iniciar o processo de exportação
7. IF a cópia ou movimentação de um arquivo falhar durante a exportação, THEN THE Aplicação SHALL exibir um toast de erro com o nome do arquivo que falhou, continuar processando os arquivos restantes e ao final apresentar um resumo indicando quantos arquivos foram exportados com sucesso e quantos falharam

---

### Requisito 10: Configurações

**User Story:** Como usuário, eu quero ajustar as configurações do sistema, para que eu possa personalizar o comportamento de matching e definir onde os dados são armazenados.

#### Critérios de Aceitação

1. THE Aplicação SHALL exibir uma view de configurações acessível a partir do menu de navegação
2. THE Aplicação SHALL fornecer um slider de 0 a 100 (incremento de 1 unidade) para ajustar o Threshold de confiança do Auto_Match, exibindo o valor numérico atual ao lado do slider
3. THE Aplicação SHALL permitir informar o ID de uma planilha Google Sheets existente ou criar uma nova automaticamente com o nome padrão "ComprovaLattes" na raiz do Google Drive do usuário
4. THE Aplicação SHALL permitir informar o ID de uma pasta raiz no Google Drive ou criar uma nova automaticamente com o nome padrão "ComprovaLattes" na raiz do Google Drive do usuário
5. WHEN qualquer configuração for alterada, THE Aplicação SHALL persistir o valor no localStorage imediatamente e na aba "config" da Planilha em até 5 segundos, exibindo indicador visual de salvamento
6. WHEN a Aplicação for iniciada sem configuração prévia, THE Aplicação SHALL utilizar valores padrão (Threshold: 50%) e exibir um fluxo de setup inicial que oferece criação automática de planilha e pasta ou entrada manual dos IDs
7. IF o usuário informar um ID de planilha ou pasta que não existe ou ao qual não possui acesso, THEN THE Aplicação SHALL exibir mensagem de erro indicando que o recurso é inválido ou inacessível e manter o campo editável para correção
8. IF a persistência na aba "config" da Planilha falhar ou a criação automática de recurso falhar, THEN THE Aplicação SHALL exibir mensagem de erro indicando a falha, manter os valores no localStorage como fallback, e permitir que o usuário tente novamente
9. WHEN a Aplicação for iniciada e os valores no localStorage diferirem dos valores na aba "config" da Planilha, THE Aplicação SHALL utilizar os valores da Planilha como fonte autoritativa e atualizar o localStorage para refletir esses valores

---

### Requisito 11: Navegação e Estrutura de Views

**User Story:** Como usuário, eu quero navegar entre diferentes telas da aplicação, para que cada funcionalidade tenha seu espaço próprio e a interface não fique sobrecarregada.

#### Critérios de Aceitação

1. THE Aplicação SHALL implementar navegação via hash routing (SPA) com as seguintes views e rotas: Login (#login), Dashboard (#dashboard), Entradas (#entradas), Importação (#importacao), Revisão (#revisao), Itens Ocultos (#ocultos) e Configurações (#config)
2. THE Aplicação SHALL exibir um menu/barra de navegação persistente em todas as views autenticadas (Dashboard, Entradas, Importação, Revisão, Itens Ocultos e Configurações) com links para cada seção, destacando visualmente a view ativa correspondente à rota atual
3. WHEN o usuário navegar para uma view via menu ou link interno, THE Aplicação SHALL atualizar a URL hash sem recarregar a página
4. WHEN o usuário acessar uma URL hash de view autenticada diretamente, THE Aplicação SHALL verificar a autenticação e, se válida, carregar a view correspondente
5. IF o usuário acessar uma URL hash de view autenticada sem estar autenticado, THEN THE Aplicação SHALL redirecionar para a view Login (#login)
6. IF o usuário acessar uma URL hash que não corresponde a nenhuma view definida, THEN THE Aplicação SHALL redirecionar para a view Dashboard (#dashboard)
7. WHEN a autenticação for concluída com sucesso, THE Aplicação SHALL redirecionar o usuário para a view Dashboard (#dashboard) como rota padrão
8. THE Aplicação SHALL exibir o nome do usuário logado e botão "Sair" na barra de navegação em todas as views autenticadas

---

### Requisito 12: Interface e Experiência do Usuário

**User Story:** Como usuário, eu quero uma interface limpa, responsiva e em português, para que eu possa utilizar a aplicação confortavelmente em desktop e tablet.

#### Critérios de Aceitação

1. THE Aplicação SHALL apresentar toda a interface em português brasileiro (pt-BR), incluindo rótulos, mensagens de feedback e textos de orientação
2. THE Aplicação SHALL apresentar layout responsivo com suporte a viewports de no mínimo 768px (tablet) e 1024px (desktop), sem necessidade de rolagem horizontal em nenhuma dessas resoluções
3. THE Aplicação SHALL utilizar CSS custom properties para definir a paleta de cores, garantindo contraste mínimo de 4.5:1 entre texto e fundo conforme WCAG 2.1 nível AA
4. WHEN uma ação do usuário for concluída (sucesso, erro ou informação), THE Aplicação SHALL exibir um toast com a mensagem correspondente por no mínimo 4 segundos, permitindo fechamento manual antes do tempo
5. WHILE operações de importação, matching ou exportação estiverem em andamento, THE Aplicação SHALL exibir overlay bloqueante com spinner animado e timer indicando o tempo decorrido em segundos
6. THE Aplicação SHALL funcionar sem frameworks CSS, utilizando estilo próprio
7. THE Aplicação SHALL funcionar sem dependências de Node.js ou npm, carregando bibliotecas externas exclusivamente via CDN (PDF.js, fuzzball.js, JSZip, Tesseract.js)
8. IF o usuário redimensionar a janela para uma largura inferior a 768px, THEN THE Aplicação SHALL manter todo o conteúdo acessível via rolagem vertical sem perda de funcionalidade

---

### Requisito 13: Estrutura de Dados na Google Sheets

**User Story:** Como usuário, eu quero que meus dados estejam organizados em abas estruturadas na planilha, para que as informações sejam persistentes e consultáveis.

#### Critérios de Aceitação

1. THE Aplicação SHALL criar e manter a aba "entradas" com as colunas na linha 1 (header row): id, titulo, instituicao, ano, carga_horaria, categoria, status, oculta, arquivo_drive_id, arquivo_nome, confianca, data_mapeamento — onde "status" aceita os valores "pendente", "mapeada", "removida" ou "mantida_manual"; "oculta" aceita os valores TRUE ou FALSE; "confianca" armazena um inteiro de 0 a 100; e "data_mapeamento" armazena a data no formato ISO 8601 (YYYY-MM-DD)
2. THE Aplicação SHALL criar e manter a aba "categorias" com as colunas na linha 1 (header row): id, nome_xml, nome_display, ativa, pasta_drive_id — onde "ativa" aceita os valores TRUE ou FALSE
3. THE Aplicação SHALL criar e manter a aba "config" com as colunas na linha 1 (header row): chave, valor — onde cada "chave" deve ser única dentro da aba
4. WHEN a Planilha não existir no primeiro uso, THE Aplicação SHALL criar uma nova planilha com a estrutura completa de abas, colunas (header row na linha 1) e valores padrão na aba "config"
5. THE Aplicação SHALL manter a integridade referencial entre entradas e categorias garantindo que o campo "categoria" de cada entrada corresponda a um "id" existente na aba "categorias"
6. IF a Aplicação detectar que uma aba esperada está ausente ou com colunas faltantes ao abrir a Planilha, THEN THE Aplicação SHALL recriar a aba ausente ou adicionar as colunas faltantes preservando os dados existentes e exibir uma mensagem informando a correção realizada
7. IF uma entrada referenciar uma categoria inexistente na aba "categorias", THEN THE Aplicação SHALL criar automaticamente a categoria referenciada com estado inativo (FALSE) e sem pasta associada

---

### Requisito 14: Estrutura de Pastas no Google Drive

**User Story:** Como usuário, eu quero que meus comprovantes estejam organizados em pastas por categoria no Drive, para que eu possa localizá-los facilmente fora da aplicação também.

#### Critérios de Aceitação

1. WHEN a Aplicação for iniciada com autenticação válida, THE Aplicação SHALL verificar a existência da pasta raiz "ComprovaLattes" no Google Drive do usuário e criá-la caso não exista, assim como as subpastas "files/", "files/novos/" e "xml/"
2. THE Aplicação SHALL criar subpastas dentro de "files/" para cada categoria ativa utilizando o slug da categoria (ex.: "files/formacao-complementar-curso-de-curta-duracao/")
3. WHEN uma categoria for ativada (toggle ON) e sua subpasta não existir em "files/", THE Aplicação SHALL criar a subpasta correspondente utilizando o slug da categoria
4. WHEN o usuário importar um XML, THE Aplicação SHALL fazer upload do arquivo XML para a pasta "ComprovaLattes/xml/", utilizando o nome original do arquivo; se um arquivo com o mesmo nome já existir, THE Aplicação SHALL sobrescrevê-lo
5. WHEN um mapeamento for aceito, THE Aplicação SHALL mover o arquivo da pasta "files/novos/" para a pasta da categoria correspondente dentro de "files/"
6. WHEN um mapeamento for desvinculado, THE Aplicação SHALL mover o arquivo de volta para a pasta "files/novos/"
7. IF uma operação de mover ou fazer upload de arquivo falhar, THEN THE Aplicação SHALL exibir um toast de erro indicando o nome do arquivo e a operação que falhou, e SHALL manter o arquivo em sua localização atual sem alterar o mapeamento na Planilha

---

### Requisito 15: Documentação do Projeto

**User Story:** Como desenvolvedor/usuário, eu quero documentação clara em português e inglês, para que qualquer pessoa possa entender e contribuir com o projeto.

#### Critérios de Aceitação

1. THE Aplicação SHALL manter comentários em português brasileiro (pt-BR) em toda função pública, classe e módulo JavaScript, descrevendo o propósito e os parâmetros de entrada/saída de cada elemento
2. THE Aplicação SHALL disponibilizar a documentação README em português brasileiro (pt-BR) no arquivo README.md e em inglês (en) em um arquivo separado README.en.md, ambos na raiz do repositório
3. THE Aplicação SHALL incluir em cada versão do README as seguintes seções: descrição do projeto, pré-requisitos de ambiente, instruções passo a passo de configuração do Google Cloud Console (criação de projeto, ativação de API, configuração de credenciais OAuth2 e URIs de redirecionamento), instruções de deploy no GitHub Pages e guia de uso cobrindo o fluxo principal de upload e verificação de produções
4. THE Aplicação SHALL documentar a estrutura de arquivos e módulos JavaScript em uma seção dedicada do README, listando cada arquivo com uma descrição de até 2 frases sobre sua responsabilidade
5. WHEN o código-fonte de um módulo JavaScript for alterado, THE Aplicação SHALL manter os comentários de documentação desse módulo atualizados para refletir o comportamento corrente

---

### Requisito 16: Gestão de Entradas Removidas

**User Story:** Como usuário, eu quero ser informado quando uma entrada do meu Lattes foi removida em uma nova versão do XML, para que eu possa decidir se excluo a entrada e seu comprovante ou se mantenho para referência.

#### Critérios de Aceitação

1. WHEN uma reimportação detectar entradas ausentes no novo XML (comparando pelo campo "id" da aba "entradas" na Planilha), THE Aplicação SHALL marcá-las com status "removida" sem excluí-las automaticamente
2. THE Aplicação SHALL exibir entradas removidas com indicador visual diferenciado (ícone ⚠ e cor de fundo em tom de alerta) distinguível das entradas com status normal ou mapeado
3. THE Aplicação SHALL oferecer para cada entrada removida, na view de Entradas, as opções: "Excluir entrada e comprovante" ou "Manter mesmo assim"
4. WHEN o usuário escolher excluir uma entrada removida que possui comprovante associado, THE Aplicação SHALL remover a entrada da Planilha e deletar o arquivo do Google Drive
5. IF o usuário escolher excluir uma entrada removida que não possui comprovante associado, THEN THE Aplicação SHALL remover apenas a entrada da Planilha
6. WHEN o usuário escolher manter uma entrada removida, THE Aplicação SHALL alterar o status para "mantida_manual" e incluí-la nas listagens, no cálculo de progresso e no Auto_Match como qualquer entrada ativa e visível
7. IF a exclusão do arquivo no Google Drive falhar durante a remoção de uma entrada, THEN THE Aplicação SHALL exibir um toast de erro indicando a falha na exclusão do arquivo e manter a entrada na Planilha sem alteração de status
