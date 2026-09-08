# Trincheira — plano de um jogo de artilharia por turnos

Um jogo no estilo *Worms*: duas a quatro equipes de bichos em um cenário
destrutível, um turno de cada vez, vento, gravidade e um arsenal exagerado.
Mesmo terreno técnico do Arqueiro — **HTML5 Canvas, ES modules, sem build, sem
dependências, sem arquivos binários** — porque essa restrição já provou que
cabe um jogo inteiro dentro dela.

Este documento é o plano. Nada foi implementado ainda.

---

## 1. O que "máxima qualidade" quer dizer aqui

Sem uma definição, "qualidade máxima" vira desculpa para escopo infinito. Este
é o critério de pronto do projeto inteiro — cada marco é medido contra ele:

| Eixo | Meta objetiva |
| --- | --- |
| Desempenho | 60 fps estáveis em notebook de 2019 e em celular de médio porte; nenhuma explosão custando mais de 8 ms |
| Determinismo | mesma semente + mesma sequência de comandos = partida idêntica, bit a bit, entre máquinas |
| Sensação | verme responde no mesmo quadro do comando; corda ninja com o "peso" da original |
| Testes | todo módulo puro (terreno, balística, dano, turnos, IA, corda) coberto no `node --test` |
| Acessibilidade | jogável 100% no teclado; telas no DOM navegáveis por leitor de tela; `prefers-reduced-motion` respeitado; cores de equipe seguras para daltonismo |
| Mobile | toque de verdade (não mouse emulado), retrato e paisagem, sem travar em tela cheia |
| Peso | projeto todo abaixo de 500 KB, sem imagem nem áudio em arquivo |
| Manutenção | nenhum módulo passa de ~300 linhas; lógica de jogo separada de desenho |

**Não** está no escopo do "máximo": multijogador online, campanha com história,
editor de mapas com interface. Cada um desses vira um plano próprio depois — a
arquitetura abaixo deixa a porta aberta para os três.

---

## 2. Restrições herdadas do repositório

O Arqueiro já resolveu, e vamos reusar sem reescrever:

- `js/engine/loop.js` — passo fixo com acumulador, `alpha` para interpolação e
  `timeScale` para câmera lenta. Serve exatamente igual.
- `js/engine/camera.js` — metros → pixels, suavização exponencial estável em
  qualquer FPS, tremida de impacto. Precisa ganhar limites de mapa e um modo
  "seguir projétil".
- `js/engine/input.js` — ponteiro unificado mouse/toque + teclado com eventos de
  borda. Precisa ganhar multitoque e gamepad.
- `js/engine/particles.js` — pool fixo de 400 partículas, sem alocação por
  quadro. Vai subir para ~1500 e ganhar tipos (fumaça, detrito, faísca, água).
- `js/engine/audio.js` — síntese WebAudio, contexto criado no primeiro gesto.
  Ganha explosão, ricochete, respingo, passos.
- `js/engine/storage.js` — `localStorage` protegido com queda para memória.

O que **falta** no engine e entra no marco 0:

- `js/engine/rng.js` — gerador determinístico (mulberry32) com semente. A partir
  daqui, `Math.random()` fica **proibido em código de jogo** (só sobra para
  enfeite puramente visual). É o que compra determinismo, replays e testes.
- `js/engine/chunks.js` — canvas fatiado em blocos, com marcação de blocos sujos.
- `js/engine/pool.js` — pool genérico, extraído do de partículas.

---

## 3. As três decisões que definem o projeto

### 3.1 Terreno destrutível: máscara de bits, não polígonos

O terreno é um **`Uint8Array` de um byte por pixel** — 0 é ar, ≥1 é matéria (o
valor guarda o material: terra, grama, rocha indestrutível). É como o Worms
original faz, e ganha de polígonos em tudo que importa aqui:

| | Máscara de bits | Polígonos / Box2D |
| --- | --- | --- |
| Abrir cratera | pintar um círculo no array — O(r²), microssegundos | booleana de polígonos, casos degenerados, buracos dentro de buracos |
| Colisão | ler um índice do array — O(1) | consulta de fase larga + estreita |
| Túneis, arcos, ilhas | de graça | difícil |
| Custo | memória e um passo de render | CPU de geometria e bugs sutis |

**Resolução:** 20 px de terreno por metro — o mesmo `scale` padrão da câmera, de
modo que no zoom 1 um pixel de máscara é um pixel de tela. Mapa padrão de
200 m × 60 m = **4000 × 1200 = 4,8 MB** de máscara. Aceitável; um mapa grande
(300 × 80 m) fica em 9,6 MB e vira opção de qualidade, não padrão.

**Render em blocos, e não em um canvas gigante.** Um canvas de 4000 × 1200 passa
do limite de dimensão de textura de vários navegadores móveis (4096 px) e
desperdiça memória. O terreno é desenhado em **blocos de 512 × 512** (8 × 3 = 24
blocos no mapa padrão), cada um um `OffscreenCanvas` (com queda para `<canvas>`
solto onde não houver). Uma explosão marca como sujos só os blocos que toca — em
geral um ou dois — e apenas esses são repintados a partir da máscara.

**Pintura de um bloco** (o passo que precisa ser rápido): `ImageData` do bloco,
para cada pixel copia a textura de fundo (padrão procedural de terra, gerado uma
vez com ruído) quando a máscara é sólida, transparente quando é ar. A borda
ganha **grama**: um pixel sólido cujo vizinho de cima, até 4 px acima, é ar
recebe a cor de grama, com um degradê curto para baixo. É isso que dá o visual
de Worms — a casquinha verde que reaparece em cada cratera nova.

**Colisão contra a máscara** — três primitivas, todas puras e testáveis:

```js
solidAt(x, y)                    // um ponto
circleHits(x, y, r)              // amostragem em anel, para projéteis
raycast(x0, y0, x1, y1)          // DDA de Bresenham, devolve 1º pixel sólido
normalAt(x, y, r = 6)            // gradiente da vizinhança → normal da superfície
```

`normalAt` soma os vetores dos pixels sólidos num raio pequeno e normaliza o
resultado invertido. É o que permite ricochete de granada e o verme "escorregar"
numa rampa sem que exista nenhum polígono de rampa.

**Geração do mapa** — determinística a partir de uma semente:

1. Deslocamento do ponto médio (*midpoint displacement*) gera a linha do
   horizonte, com rugosidade caindo por nível.
2. Ruído de valor em duas oitavas abre cavernas abaixo da superfície, com
   limiar variável por profundidade (mais buraco no meio, sólido perto do chão).
3. Passo de limpeza: erosão + dilatação remove pixels soltos e pontes de 1 px.
4. Pinta rocha indestrutível nas bordas laterais e no leito da água.
5. Escolhe pontos de nascimento: superfícies planas com espaço livre acima,
   distribuídas para nenhuma equipe começar em vantagem óbvia.

A semente aparece no menu e pode ser colada — mapa bom vira algo que se
compartilha por texto.

**Ilhas flutuantes:** ficam no ar, como no Worms clássico. Detectar componentes
desconexos e fazê-los cair é bonito, mas é um *flood fill* de 4,8 M pixels a
cada explosão e muda o equilíbrio do jogo. Fica fora; se entrar depois, entra
como modificador de partida.

### 3.2 Movimento do verme: sonda de pixels, não corpo rígido

Um verme não é um corpo físico honesto — é uma cápsula de 0,8 m × 1,2 m que
segue regras de jogo. Cada estado tem sua própria lógica:

- **Andando** — a cada passo, tenta avançar 1 px na horizontal. Se colidir, sobe
  até 6 px procurando espaço livre (é o "degrau" que deixa subir rampa sem
  pular). Se não achar, para. Se abaixo houver ar, cai até 6 px (desce rampa
  colado no chão). Fora disso, vira queda livre.
- **Pulando** — impulso fixo, dois tipos (pulo curto para frente, cambalhota
  para trás), e a partir daí é balística pura.
- **Voando** — integração igual à do Arqueiro (Euler semi-implícito, gravidade,
  arrasto), com colisão por passo varrido contra a máscara: se o segmento do
  passo cruza matéria, recua ao último ponto livre.
- **Aterrissando** — dano de queda proporcional à velocidade vertical acima de
  um limiar, exatamente como no original: cair de alto dói.
- **Empurrado** — depois de uma explosão, entra em voo com o impulso recebido;
  esbarrões em parede tiram um pouco da velocidade, sem ricochete elástico.

Colisão do verme com a máscara é feita por **sonda de 5 pontos** (pés,
cabeça, dois flancos, centro), não por varredura completa da cápsula. É barato,
previsível, e nunca "gruda" numa quina.

### 3.3 Corda ninja: pivôs empilhados

É a mecânica que separa um clone morno de um jogo que as pessoas querem jogar de
novo, e é a mais difícil. A implementação clássica, e a que vamos usar:

- O disparo é um `raycast` até o primeiro pixel sólido. Esse é o **pivô 0**.
- O verme fica preso a uma distância `L` do pivô ativo. A cada passo: integra
  livremente; se ficou além de `L`, projeta a posição de volta para o círculo de
  raio `L` e **remove a componente radial da velocidade** (fica só a tangencial —
  é isso que produz o balanço).
- `L` encurta e alonga com ↑/↓.
- **Novo pivô:** se o segmento pivô→verme cruza terreno, o ponto de dobra vira
  um pivô novo, empilhado, e `L` passa a ser o resto da corda.
- **Remover pivô:** quando o ângulo do verme em relação ao pivô anterior reabre
  além do que a quina permitia, desempilha e devolve o comprimento.

Cada regra dessas é uma função pura sobre `(pivôs, posição, velocidade, L)` e
entra em teste com casos montados à mão. Sem isso, ajustar a corda vira
tentativa e erro no navegador.

---

## 4. Turnos: a máquina de estados

Todo o jogo é uma máquina de estados explícita, no espírito do
`js/game/level.js` que já existe. Nada de flags espalhadas.

```
PREPARANDO ─→ JOGANDO ─→ ARMA_ATIVA ─→ RESOLVENDO ─→ ASSENTANDO ─→ (próximo)
                 │            │             │
              tempo=0     tiro dado     dano, mortes,
                 └────────────┴─→ RECUANDO (3 s para correr) ─┘
```

- **PREPARANDO** — câmera vai até o verme da vez, caixa pode cair de paraquedas,
  vento é sorteado (com o `rng`, portanto reprodutível).
- **JOGANDO** — 45 s de relógio. Andar, pular, mirar, trocar de arma, usar
  utilitário. Usar corda/jetpack/teleporte **não** encerra o turno.
- **ARMA_ATIVA** — projétil no ar; a câmera passa a segui-lo. Relógio congela.
- **RECUANDO** — 3 s depois do disparo para o verme sair de perto. Clássico e
  essencial para o ritmo.
- **RESOLVENDO** — aplica dano em ordem determinística, dispara minas atingidas,
  processa reações em cadeia, mata quem chegou a 0, afoga quem passou da água.
- **ASSENTANDO** — espera *todo* corpo parar (velocidade abaixo do limiar por
  N passos) antes de passar a vez. Sem isso, o próximo turno começa com um verme
  ainda caindo, e o jogo parece quebrado.
- **Morte súbita** — depois de N rodadas: água sobe 1 px por turno, ou toda a
  vida cai para 1, conforme a regra escolhida na partida.

O relógio de turno, a ordem de resolução de dano e a condição de vitória são
funções puras — testáveis sem canvas, como `scoring.js` é hoje.

---

## 5. Arsenal, orientado a dados

Como `js/game/levels.js`: uma tabela, não vinte arquivos. Cada arma declara o que
é, e o motor sabe executar cada **tipo**.

```js
{
  id: 'bazuca',
  nome: 'Bazuca',
  tipo: 'projetil',        // projetil | granada | hitscan | soltavel | dirigivel | utilitario
  municao: Infinity,
  vento: true,             // sofre vento?
  raio: 2.4,               // raio da explosão, em metros
  dano: 45,                // dano no epicentro (cai linear até a borda)
  impulso: 11,             // empurrão no epicentro
  encerraTurno: true,
  disparos: 1,
  desbloqueio: 0,          // turno a partir do qual aparece
}
```

**Tipos de execução** (seis, e todo o arsenal cabe neles):

| Tipo | Comportamento | Exemplos |
| --- | --- | --- |
| `projetil` | balística + vento, explode no primeiro contato | bazuca, morteiro, granada de fósforo |
| `granada` | balística + ricochete usando `normalAt`, pavio de 1–5 s | granada, granada de fragmentação, banana |
| `hitscan` | `raycast` instantâneo, dano pontual, faz furo pequeno | escopeta (2 tiros), sniper, pistola |
| `soltavel` | fica onde é largado, pavio ou gatilho de proximidade | dinamite, mina |
| `dirigivel` | anda/voa sozinho pelo terreno até bater ou expirar | ovelha, míssil teleguiado |
| `utilitario` | não faz dano; muda o estado do verme ou do mapa | corda, jetpack, teleporte, viga, paraquedas |

**Arsenal alvo (16):** bazuca, morteiro, granada, granada de fragmentação,
escopeta, sniper, dinamite, mina, ovelha, ataque aéreo, maçarico, broca, viga de
construção, corda ninja, jetpack, teleporte. Mais uma arma secreta com pavio de
comédia — todo jogo do gênero tem a sua.

**Dano e empurrão** seguem a curva do original: linear do epicentro à borda da
explosão, `dano · (1 − d/R)`, com o impulso na direção do centro para fora e
maior quanto mais perto. É uma função pura de três linhas — e é a função que
define todo o equilíbrio do jogo, então ganha um arquivo de teste só dela.

**Caixas** caem de paraquedas em posição sorteada pelo `rng`: munição, vida,
ou armadilha. Aparecer no lugar certo na hora certa é metade da graça.

---

## 6. Inteligência artificial

Para jogar sozinho, e para preencher equipe em partida com número ímpar de
humanos. Três camadas:

1. **Solução de tiro.** Não existe fórmula fechada com arrasto e vento, então:
   simulação para frente (a mesma `simulate()` do Arqueiro, generalizada) dentro
   de uma **busca em duas fases** — varredura grossa de ângulo × potência (12 × 8
   amostras), depois bisseção refinando o melhor par. ~100 simulações de 300
   passos por decisão: menos de 2 ms.
2. **Linha de tiro.** `raycast` da boca da arma até o alvo. Se está bloqueado,
   tenta uma trajetória por cima; se nada passa, troca de arma (morteiro para
   arco alto, broca para cavar, ataque aéreo para ignorar o relevo).
3. **Personalidade e erro.** A dificuldade não é "mira melhor" e sim erro
   angular somado ao resultado: ±4° no fácil, ±1,2° no médio, ±0,15° no difícil.
   No difícil a IA também considera dano em cadeia, empurrar para a água (a
   jogada mais cruel do gênero) e se proteger antes do fim do turno.

A IA nunca lê o estado interno do jogo por atalhos: recebe o mesmo mundo que um
jogador vê e devolve **comandos de entrada**. Assim ela é gravável no replay e
testável — "nesta posição, com este vento, ela acerta o alvo em 90% das
sementes" é um teste automatizado de verdade.

---

## 7. Apresentação

Sem nenhum arquivo de imagem ou som, como no Arqueiro.

- **Céu** em degrau de gradientes por horário do mapa, com nuvens em três
  camadas de parallax e um sol com halo.
- **Terreno** com textura procedural de terra (ruído de valor colorido), camadas
  de estrato mais escuras conforme a profundidade, casca de grama nas bordas e
  linha de contorno mais clara — o que dá leitura imediata de onde dá para pisar.
- **Água** com duas senoides somadas, transparência, reflexo invertido e
  ondulado do que está acima, e espuma na linha de contato.
- **Vermes** desenhados em vetor: corpo em cápsula, olhos que seguem a mira,
  chapéu por equipe, animação de andar por deformação (agachar/esticar), sem
  sprite. Nome da equipe e barra de vida flutuando acima, com fonte do sistema.
- **Explosões:** clarão, onda de choque (um anel que distorce por escala), 40–80
  partículas de detrito com a cor do terreno atingido, fumaça que sobe e dissipa,
  tremida de câmera proporcional ao raio.
- **Câmera cinematográfica:** segue o projétil, corta para o alvo no impacto,
  câmera lenta de 0,35× nos últimos 300 ms de um tiro que mata (respeitando
  `prefers-reduced-motion`, que já é uma opção do menu).
- **Áudio sintetizado:** explosão (ruído filtrado em passa-baixa com envelope
  rápido + queda de tom), disparo, ricochete (tom curto ascendente), respingo,
  passos, tique do pavio, sirene da morte súbita.

---

## 8. Orçamento de desempenho

16,6 ms por quadro. O alvo de gasto:

| Etapa | Orçamento |
| --- | --- |
| Física (2 passos de 1/120 s) | 2,0 ms |
| Explosão (recorte + repintura de blocos sujos) | 8,0 ms, e só no quadro do impacto |
| Render de terreno (blit dos blocos visíveis) | 1,5 ms |
| Partículas | 1,5 ms |
| Vermes, HUD, água, céu | 3,0 ms |

Regras que sustentam isso: nenhuma alocação dentro do laço (pools para tudo);
`ImageData` reaproveitado por bloco; a máscara nunca é varrida inteira em tempo
de jogo; canvas com `devicePixelRatio` limitado a 2; e um teste de carga que
detona 30 explosões seguidas medindo o pior quadro.

---

## 9. Testes

O que entra no `node --test` (tudo sem DOM, como já é a regra do repositório):

| Arquivo | Cobre |
| --- | --- |
| `tests/rng.test.js` | mesma semente → mesma sequência; distribuição sã |
| `tests/mask.test.js` | `solidAt`, `circleHits`, `raycast`, `normalAt`, recorte de cratera nas bordas |
| `tests/terrain-gen.test.js` | mapa da semente X é idêntico; sem pixels soltos; pontos de nascimento válidos |
| `tests/ballistics.test.js` | integração, vento, colisão varrida (o projétil rápido não atravessa parede) |
| `tests/damage.test.js` | curva de dano, impulso, cadeia de minas, ordem de resolução |
| `tests/turn.test.js` | máquina de estados, relógio, recuo, assentamento, vitória, morte súbita |
| `tests/rope.test.js` | empilhar e desempilhar pivô, conservação de energia no balanço |
| `tests/worm-move.test.js` | degrau para cima e para baixo, bloqueio, dano de queda |
| `tests/ai.test.js` | acerta alvo estático em N sementes; respeita o erro da dificuldade |
| `tests/replay.test.js` | replay de partida gravada reproduz o placar final exato |

O `replay.test.js` é o mais valioso: uma partida completa gravada como semente +
lista de comandos, rodada de cabo a rabo sem render. Se um dia alguém quebrar a
física, esse teste avisa antes do jogador.

---

## 10. Estrutura de arquivos

O Arqueiro fica onde está. O jogo novo é autocontido, e a raiz vira um saguão
com os dois. O workflow do Pages publica a raiz inteira sem mudar uma linha.

```
index.html                   saguão: escolhe o jogo         (novo, pequeno)
arqueiro/                    o jogo atual, movido para cá   (sem mudar código)
trincheira/
  index.html
  css/style.css
js/engine/                   COMPARTILHADO: loop, câmera, entrada, partículas,
                             áudio, save + rng, chunks, pool           (novos)
js/trincheira/
  mask.js                    máscara do terreno              (puro, testado)
  terrain-gen.js             geração por semente             (puro, testado)
  terrain-render.js          blocos, textura, grama, sujeira
  ballistics.js              integração e colisão varrida    (puro, testado)
  damage.js                  curva de dano e impulso         (puro, testado)
  worm.js                    estados e movimento do verme
  rope.js                    corda ninja                     (puro, testado)
  weapons.js                 a tabela de armas               (dados)
  projectile.js              execução dos seis tipos
  turn.js                    máquina de estados da partida   (puro, testado)
  ai.js                      solução de tiro e decisão       (puro, testado)
  replay.js                  gravação e reprodução de comandos
  match.js                   junta tudo: mundo, equipes, regras
  ui/hud.js, ui/screens.js   HUD no canvas, telas no DOM
  main.js                    liga canvas, entrada, loop, telas
tests/                       um arquivo por módulo puro
docs/PLANO-TRINCHEIRA.md     este documento
```

Mover o Arqueiro para uma subpasta quebra o link atual do Pages (`/` passa a ser
o saguão). É uma mudança de um commit, mas é **irreversível para quem já salvou
o link** — vale confirmar antes. A alternativa sem risco: deixar o Arqueiro na
raiz e pôr o jogo novo em `/trincheira/`, com um link entre os dois.

---

## 11. Marcos

Cada marco termina em algo que dá para abrir no navegador. Nada de "três semanas
sem tela".

| # | Marco | Entrega | Critério de aceite |
| --- | --- | --- | --- |
| **M0** | Fundação | `rng.js`, `chunks.js`, `pool.js`, esqueleto do jogo, saguão | `node --test` verde; canvas abre com céu e nada mais |
| **M1** | **Terreno** | geração por semente, máscara, cratera, colisão, render em blocos | clicar abre cratera com grama na borda; 30 explosões seguidas sem quadro acima de 12 ms |
| **M2** | Verme | estados de movimento, andar, pular, cair, dano de queda, câmera | dá para passear pelo mapa inteiro; sobe rampa, não gruda em quina |
| **M3** | **Jogo** | turnos, mira, bazuca, dano, morte, água, vitória | **partida de 2 humanos no mesmo teclado, do início ao fim** |
| **M4** | Arsenal | tabela de armas, os seis tipos, caixas, munição, HUD de armas | 16 armas jogáveis; trocar arma nunca quebra o turno |
| **M5** | Mobilidade | corda ninja, jetpack, teleporte, viga | atravessar o mapa só de corda, sem tocar o chão |
| **M6** | Apresentação | água, parallax, partículas, câmera cinematográfica, áudio, telas | um vídeo de 30 s que se parece com um jogo pronto |
| **M7** | Solo | IA em três dificuldades, partida rápida, desafios | IA difícil ganha de um humano distraído |
| **M8** | Polimento | toque, gamepad, acessibilidade, replays, sementes, desempenho | passa a tabela inteira da seção 1 |

Um marco só fecha com seus testes escritos. M1 e M3 são os de risco — se algo
vai derrapar, é ali, e é por isso que estão cedo.

---

## 12. Riscos, e o que fazer com cada um

| Risco | Sinal | Resposta |
| --- | --- | --- |
| Máscara pesada demais no celular | travar ou fechar a aba em mapa grande | resolução de 12 px/m no perfil móvel (mesmo código, constante diferente) |
| Corda com sensação errada | "não é assim que a do Worms funciona" | ajustar em teste automatizado, com casos de balanço medidos, antes de ajustar no olho |
| Explosão engasgando | quadro de 30 ms no impacto | repintar bloco em fatias ao longo de 2–3 quadros, com a máscara já correta para a física |
| Arsenal virando escopo infinito | M4 sem prazo | os seis tipos de execução são fechados em M4; arma nova depois disso é só linha de tabela |
| Determinismo quebrando sem ninguém ver | replay de teste falha meses depois | `replay.test.js` roda em toda alteração, no CI que já existe |

---

## 13. O que preciso decidir com você antes do M0

1. **Nome.** "Trincheira" é o que usei aqui. Serve, ou prefere outro?
2. **Onde mora.** Mover o Arqueiro para `/arqueiro/` e criar um saguão na raiz
   (mais limpo, quebra o link atual), ou deixar tudo como está e pôr o jogo em
   `/trincheira/` (sem risco, raiz continua sendo o Arqueiro)?
3. **Ordem de entrega.** Ir direto até o M3 — a partida de dois jogadores no
   mesmo teclado, que já é um jogo — e só então decidir o resto? É o que eu
   recomendo: é o ponto em que dá para jogar e opinar com o jogo na mão.
4. **Online.** Fora do escopo neste plano. O determinismo do M0 é justamente o
   que deixa a porta aberta para passo travado por WebRTC depois — quer que eu
   já reserve esse caminho, ou é para ignorar de vez?

Sem resposta, o padrão que eu sigo: nome **Trincheira**, jogo em
`/trincheira/` sem mexer no Arqueiro, entrega até o **M3** primeiro, online fora
do escopo mas com o determinismo preservado.
