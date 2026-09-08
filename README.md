# Minhocas

Artilharia por turnos no estilo *Worms*: equipes de minhocas de capacete, uma
jogando por vez, com um arsenal de 14 armas e ferramentas — da bazuca à corda
ninja — num cenário que se destrói a cada tiro, até sobrar uma equipe em pé.

Mesma casca do Arqueiro: **HTML5 Canvas, ES modules, sem build, sem
dependências e sem um único arquivo de imagem ou de som.**

## Como jogar

Sirva a pasta do repositório (o jogo usa módulos ES):

```bash
python3 -m http.server 8000   # depois: http://localhost:8000
```

Dois jogadores no mesmo teclado. Cada um controla a minhoca da sua equipe
quando chega a vez dela.

| Ação | Tecla |
| --- | --- |
| Andar | ← → |
| Mirar | ↑ ↓ |
| Ajuste fino da mira | Shift + ↑ ↓ |
| Força do tiro | segure **Espaço** e solte |
| Pular | Enter |
| Cambalhota para trás | Backspace |
| Trocar de arma | `[` e `]` percorrem o arsenal |
| Pavio da granada | 1 a 5, com uma granada na mão |
| Corda ninja | Espaço prende e solta · ↑ ↓ encolhem/alongam |
| Jetpack | segure Espaço para subir · ← → de lado |
| Teleporte | Espaço aparece onde a mira aponta |
| Pausar | P |

### O arsenal

| Arma | Tipo | O que faz |
| --- | --- | --- |
| Bazuca | projétil | sofre vento |
| Morteiro | projétil | mais lento, estrago maior |
| Granada | granada | quica, pavio ajustável |
| Frag. em cacho | granada | explode e espalha 5 pedaços menores |
| Dinamite | soltável | larga no pé, pavio de 5 s |
| Mina | soltável | não explode ao tocar o chão — arma sozinha e detona por proximidade |
| Escopeta | hitscan | 2 tiros instantâneos, curto alcance |
| Rifle sniper | hitscan | 1 tiro instantâneo, longo alcance |
| Ovelha | dirigível | pousa e anda sozinha até explodir |
| Míssil guiado | dirigível | voo reto na mira, ignora vento e gravidade |
| Corda ninja | utilitário | pivôs empilhados — balança e prende de novo nas quinas |
| Jetpack | utilitário | voo controlado, combustível recarrega a cada turno |
| Teleporte | utilitário | aparece instantaneamente onde a mira aponta |
| Viga | soltável | larga no pé e vira degrau de terreno sólido |

Usar um utilitário **não passa a vez** — a minhoca continua sob seu controle
depois. Se o tempo do turno acabar com a corda ainda presa, ela solta
sozinha.

> **Ainda não dá para jogar no celular.** O layout se adapta a retrato e
> paisagem, mas os controles de toque são do marco 8 — hoje o jogo é de
> teclado. No celular dá para olhar; para jogar, teclado.

### As regras

- **45 segundos** por turno (ou 30, ou 60 — dá para escolher no menu). O
  relógio congela enquanto o tiro está no ar.
- Depois do tiro sobram **3 segundos para correr**. Aproveite.
- O **vento** entorta a bazuca e o morteiro. O resto do arsenal ignora vento.
- Cair de muito alto machuca. A **água mata na hora**.
- Uma minhoca que chega a zero **explode**, e a explosão dela pode derrubar
  as vizinhas. Mortes em cadeia são parte do jogo.
- Depois de **10 rodadas** entra a morte súbita: a água começa a subir a cada
  turno.

### Semente do mapa

Todo mapa nasce de uma semente. Digitar a mesma semente no menu gera
exatamente o mesmo terreno, em qualquer máquina — achou um mapa bom, ele cabe
numa mensagem de texto.

## Como funciona

**O terreno é uma máscara de bits**, não um polígono: um `Uint8Array` com um
byte por pixel (0 ar, 1 terra, 2 grama, 3 rocha indestrutível) a 20 px por
metro. Abrir cratera é pintar um círculo num array; colisão é ler um índice.
Túnel, arco e ilha saem de graça.

O desenho é feito em **blocos de 512 × 512**, e cada bloco guarda o retângulo
que precisa ser refeito: uma explosão suja ~130 × 130 px, não o bloco inteiro.
Medido no Chromium, o pior quadro com explosão fica em **6,7 ms** dos 16,7
disponíveis.

**A minhoca não é um corpo físico honesto.** Andar é dar passos de um pixel
tentando subir ou descer um degrau de até 32 cm; só o voo é integração de
verdade, com colisão testada no segmento percorrido (senão um foguete rápido
atravessaria uma parede fina entre dois quadros). A colisão usa cinco sondas —
pés, dois flancos em duas alturas e a cabeça.

**A corda ninja é pivôs empilhados**, não uma mola: o disparo acha o primeiro
ponto sólido no caminho e a minhoca fica presa a essa distância. Se o segmento
pivô→minhoca esbarra numa quina, o ponto de dobra vira um pivô novo e a corda
encolhe para o resto; quando o balanço reabre para o lado de onde veio, o pivô
do topo é removido. Tudo isso é uma função pura só sobre posição, velocidade e
a pilha de pivôs — dá para testar sem terreno de verdade nenhum.

**Nada usa `Math.random()`.** Todo sorteio passa por um gerador com semente, o
que dá mapas reproduzíveis, testes determinísticos e deixa a porta aberta para
replays e para multijogador de passo travado.

```
index.html                   página e canvas
css/style.css                casca e telas
js/engine/                   motor genérico: loop de passo fixo, câmera,
                             entrada, partículas, áudio, save, gerador com
                             semente, canvas em blocos
js/minhocas/mask.js          máscara do terreno          (puro, testado)
js/minhocas/terrain-gen.js   geração por semente         (puro, testado)
js/minhocas/terrain.js       mundo em metros + render em blocos
js/minhocas/ballistics.js    integração e colisão varrida (puro, testado)
js/minhocas/damage.js        dano e empurrão             (puro, testado)
js/minhocas/worm.js          estados e desenho da minhoca (movimento testado)
js/minhocas/rope.js          corda ninja: pivôs empilhados (puro, testado)
js/minhocas/turn.js          máquina de turnos           (puro, testado)
js/minhocas/weapons.js       a tabela de armas           (dados, testado)
js/minhocas/projectile.js    execução dos tipos de arma
js/minhocas/match.js         junta tudo: mundo, equipes, regras
js/minhocas/ui/              HUD no canvas, telas no DOM
```

## Testes

```bash
node --test        # ou: npm test
```

Cobrem o gerador com semente, as primitivas da máscara, a geração do mapa, a
balística (inclusive o projétil rápido que não pode atravessar parede nem
atravessar uma minhoca no ar), a curva de dano, a tabela de armas, o
movimento da minhoca, a corda ninja (empilhar e desempilhar pivô, balanço sem
esticar) e a máquina de turnos inteira — tudo sem DOM e sem navegador.

## O que ainda não existe

Falta o ataque aéreo, as caixas de paraquedas, a IA para jogar sozinho e os
controles de toque. O desenho de cada um está em
[`docs/PLANO-TRINCHEIRA.md`](docs/PLANO-TRINCHEIRA.md).
